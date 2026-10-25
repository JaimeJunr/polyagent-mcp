import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const HAS_BWRAP = (process.env.PATH ?? "").split(":").some((dir) => existsSync(join(dir, "bwrap")));

describe.skipIf(!HAS_BWRAP)("engine binary em bwrap real", () => {
  it("mantém subdiretório RW gravável dentro de workspace RO e bloqueia escrita no restante", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "sandbox-live-ro-"));
    const state = join(workspace, "state");
    mkdirSync(state);
    const { buildSandboxSpec, buildSandboxArgs } = await import("../src/cli.js");
    const built = buildSandboxSpec(workspace, "codex", true);
    try {
      const result = spawnSync("bwrap", [
        ...buildSandboxArgs({ ...built.spec, extraBinds: [state] }),
        "/bin/sh", "-c", 'printf state > state/allowed || exit 10; if (printf workspace > blocked); then exit 11; fi',
      ], { encoding: "utf8", timeout: 10_000 });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toMatch(/Read-only file system/);
      expect(readFileSync(join(state, "allowed"), "utf8")).toBe("state");
      expect(existsSync(join(workspace, "blocked"))).toBe(false);
    } finally {
      built.cleanup();
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it.each([false, true])("executa por nome um CLI fora dos binds padrão e reproduz execvp sem o bind da instalação (symlink=%s)", async (symlink) => {
    const installation = mkdtempSync(join(tmpdir(), "engine-live-install-"));
    const targetInstallation = mkdtempSync(join(tmpdir(), "engine-live-target-"));
    const workspace = mkdtempSync(join(tmpdir(), "engine-live-workspace-"));
    const name = "polyagent-fake-engine";
    const binary = join(installation, name);
    const target = symlink ? join(targetInstallation, name) : binary;
    if (symlink) symlinkSync(target, binary);
    writeFileSync(target, "#!/bin/sh\nprintf 'engine-visible\\n'\n", { mode: 0o755 });
    chmodSync(target, 0o755);
    vi.stubEnv("POLYAGENT_OPENCODE_BIN", name);
    vi.stubEnv("PATH", `${installation}:${process.env.PATH ?? "/usr/bin:/bin"}`);
    vi.resetModules();
    const { buildSandboxSpec, buildSandboxArgs } = await import("../src/cli.js");
    const built = buildSandboxSpec(workspace, "opencode");
    try {
      const run = (engineRoBinds: string[] | undefined) => spawnSync("bwrap", [
        ...buildSandboxArgs({ ...built.spec, engineRoBinds }), name,
      ], { encoding: "utf8", timeout: 10_000 });
      const without = run([]);
      expect(without.stderr).toContain(`bwrap: execvp ${name}: No such file or directory`);
      expect(without.status).not.toBe(0);
      const withBind = run(built.spec.engineRoBinds);
      expect(withBind.stderr).toBe("");
      expect(withBind.status).toBe(0);
      expect(withBind.stdout).toBe("engine-visible\n");
    } finally {
      built.cleanup();
      vi.unstubAllEnvs();
      vi.resetModules();
      rmSync(targetInstallation, { recursive: true, force: true });
      rmSync(installation, { recursive: true, force: true });
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
