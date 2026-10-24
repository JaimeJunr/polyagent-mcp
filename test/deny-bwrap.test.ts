import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSandboxArgs, buildSandboxSpec, parseDenyRules } from "../src/cli.js";

// Teste vivo: spawna o bwrap de verdade. Os testes de `sh` não enxergam erros de mount (ex.: bind
// sobre symlink derrubava o sandbox inteiro). Só roda com bwrap no PATH; cada caso pula se o
// comando não existe no host.
const SYSTEM_DIRS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/local/bin"];
const onHost = (cmd: string): boolean =>
  [...(process.env.PATH ?? "").split(":"), ...SYSTEM_DIRS].some((dir) => dir.startsWith("/") && existsSync(join(dir, cmd)));
const HAS_BWRAP = onHost("bwrap");

const RULES = ["make db-up", "npx prisma migrate", "chmod", "python manage.py migrate", "git push"];

/** Caso: comando de shell, comando exigido no host, exit esperado. */
const CASES: Array<{ label: string; script: string; needs: string; exit: number }> = [
  { label: "make -j4 db-up bloqueado", script: "make -j4 db-up", needs: "make", exit: 126 },
  { label: "make --version passa", script: "make --version", needs: "make", exit: 0 },
  { label: "npx -y prisma migrate deploy bloqueado", script: "npx -y prisma migrate deploy", needs: "npx", exit: 126 },
  { label: "npx --version passa (script não foi realocado)", script: "npx --version", needs: "npx", exit: 0 },
  { label: "chmod +x f bloqueado", script: "chmod +x f", needs: "chmod", exit: 126 },
  { label: "/usr/bin/chmod +x f bloqueado (overlay do ELF)", script: "/usr/bin/chmod +x f", needs: "chmod", exit: 126 },
  { label: "python manage.py migrate bloqueado", script: "python manage.py migrate", needs: "python", exit: 126 },
  { label: "python -c print(1) passa", script: 'python -c "print(1)"', needs: "python", exit: 0 },
  { label: "git status passa", script: "git status", needs: "git", exit: 0 },
  { label: "git push bloqueado", script: "git push", needs: "git", exit: 126 },
];

describe.skipIf(!HAS_BWRAP)("deny em bwrap real", () => {
  let workspace: string;
  let spec: ReturnType<typeof buildSandboxSpec>;

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), "deny-live-ws-"));
    spawnSync("git", ["init", "-q", workspace]);
    spec = buildSandboxSpec(workspace, "codex", false, [], parseDenyRules(RULES));
  });

  afterAll(() => {
    spec?.cleanup();
    rmSync(workspace, { recursive: true, force: true });
  });

  const run = (script: string) => {
    const res = spawnSync("bwrap", [...buildSandboxArgs(spec.spec), "/bin/sh", "-c", script], { encoding: "utf8" });
    return { code: res.status, out: res.stdout, err: res.stderr };
  };

  it("o sandbox sobe sem erro de mount com todas as regras", () => {
    const r = run("true");
    expect(r.err).not.toMatch(/bwrap:/);
    expect(r.code).toBe(0);
  });

  for (const c of CASES) {
    it.skipIf(!onHost(c.needs))(c.label, () => {
      const r = run(c.script);
      expect(r.err, c.script).not.toMatch(/bwrap:/);
      expect([c.script, r.code]).toEqual([c.script, c.exit]);
      if (c.exit === 126) expect(r.err).toContain("is blocked in this sandbox (deny list)");
    });
  }
});
