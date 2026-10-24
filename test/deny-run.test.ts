import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

// Sandbox LIGADO: o deny só existe dentro do bwrap.
delete process.env.POLYAGENT_SANDBOX;
const { runCursor, buildSandboxSpec } = await import("../src/cli.js");

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    child.stdout.emit("data", Buffer.from(JSON.stringify({ result: "ok", session_id: "s1" })));
    child.emit("close", 0);
  });
  return child;
}

let binDir: string;
const origPath = process.env.PATH;

/** Cria um executável fake no PATH stubado: "elf" começa com \x7fELF, "script" tem shebang. */
function install(name: string, kind: "elf" | "script" = "elf"): string {
  const p = join(binDir, name);
  writeFileSync(p, kind === "elf" ? Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from("fake")]) : "#!/bin/sh\n");
  chmodSync(p, 0o755);
  return p;
}

/** Symlink `name` → `target` dentro do PATH stubado. */
function link(name: string, target: string): string {
  const p = join(binDir, name);
  symlinkSync(target, p);
  return p;
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => fakeChild());
  binDir = mkdtempSync(join(tmpdir(), "deny-bin-"));
  process.env.PATH = binDir;
});

afterEach(() => {
  process.env.PATH = origPath;
  rmSync(binDir, { recursive: true, force: true });
});

describe("buildSandboxSpec com deny", () => {
  it("ELF regular: shim (0755) fora dos mounts, real realocado, dir dos shims no PATH, limpo no cleanup", () => {
    const bin = install("pa-elf");
    const built = buildSandboxSpec("/repo", "codex", false, [], [{ cmd: "pa-elf", args: ["push"] }]);
    try {
      const spec = built.spec;
      expect(spec.shims.map((s) => s.target)).toEqual([bin]);
      expect(spec.realBins).toEqual([{ src: realpathSync(bin), dest: "/run/polyagent-real/pa-elf" }]);
      // o worker enxerga isoHome ($HOME) e tmpDir (/tmp) em RW: os shims não podem morar neles
      const shimDir = spec.shimDir as string;
      expect(shimDir).toBeTruthy();
      expect(shimDir.startsWith(spec.isoHome) || shimDir.startsWith(spec.tmpDir)).toBe(false);
      const file = join(shimDir, "pa-elf");
      expect(spec.shims[0].file).toBe(file);
      expect(statSync(file).mode & 0o777).toBe(0o755);
      expect(readFileSync(file, "utf8")).toContain(`REAL='/run/polyagent-real/pa-elf'`);
      expect(spec.path).toBe(`/run/polyagent-shims:${binDir}`);
      built.cleanup();
      expect(existsSync(shimDir)).toBe(false);
    } finally {
      built.cleanup();
    }
  });

  it("symlink para ELF: sobrepõe o ELF resolvido, nunca o symlink (bwrap recusa symlink como destino)", () => {
    const elf = install("pa-py3.14");
    link("pa-py", "pa-py3.14");
    const built = buildSandboxSpec("/repo", "codex", false, [], [{ cmd: "pa-py", args: ["manage.py"] }]);
    try {
      expect(built.spec.shims.map((s) => s.target)).toEqual([realpathSync(elf)]);
      expect(built.spec.realBins).toEqual([{ src: realpathSync(elf), dest: "/run/polyagent-real/pa-py" }]);
    } finally {
      built.cleanup();
    }
  });

  it("symlink para script: nada sobreposto nem realocado; REAL é o path original; PATH shim cobre", () => {
    install("pa-cli.js", "script");
    const npx = link("pa-script", "pa-cli.js");
    const built = buildSandboxSpec("/repo", "codex", false, [], [{ cmd: "pa-script", args: ["prisma"] }]);
    try {
      expect(built.spec.shims).toEqual([]);
      expect(built.spec.realBins).toEqual([]);
      const shimDir = built.spec.shimDir as string;
      expect(readFileSync(join(shimDir, "pa-script"), "utf8")).toContain(`REAL='${npx}'`);
      expect(built.spec.path.startsWith("/run/polyagent-shims:")).toBe(true);
    } finally {
      built.cleanup();
    }
  });

  it("dois cmds com o mesmo realpath: overlay só do primeiro; o segundo usa o PATH shim e o real realocado", () => {
    const elf = install("pa-real");
    link("pa-a", "pa-real");
    link("pa-b", "pa-real");
    const built = buildSandboxSpec("/repo", "codex", false, [], [
      { cmd: "pa-a", args: ["x"] },
      { cmd: "pa-b", args: ["y"] },
    ]);
    try {
      const real = realpathSync(elf);
      expect(built.spec.shims.map((s) => [s.target, s.file.split("/").pop()])).toEqual([[real, "pa-a"]]);
      expect(built.spec.realBins).toEqual([
        { src: real, dest: "/run/polyagent-real/pa-a" },
        { src: real, dest: "/run/polyagent-real/pa-b" },
      ]);
      expect(readdirSync(built.spec.shimDir as string).sort()).toEqual(["pa-a", "pa-b"]);
    } finally {
      built.cleanup();
    }
  });

  it("pula comando inexistente (nada a bloquear) sem lançar, sem shimDir e com PATH intacto", () => {
    const built = buildSandboxSpec("/repo", "codex", false, [], [{ cmd: "polyagent-fantasma-xyz", args: [] }]);
    try {
      expect(built.spec.shims).toEqual([]);
      expect(built.spec.realBins).toEqual([]);
      expect(built.spec.shimDir).toBeNull();
      expect(built.spec.path).toBe(binDir);
    } finally {
      built.cleanup();
    }
  });

  it("sem deny, shims/realBins vazios, shimDir nulo e PATH intacto", () => {
    const built = buildSandboxSpec("/repo", "codex");
    try {
      expect(built.spec.shims).toEqual([]);
      expect(built.spec.realBins).toEqual([]);
      expect(built.spec.shimDir).toBeNull();
      expect(built.spec.path).toBe(binDir);
    } finally {
      built.cleanup();
    }
  });
});

describe("runCursor com deny (sandbox ligado)", () => {
  it("passa os binds do shim ao bwrap, com o workspace por último", async () => {
    const bwrap = install("bwrap", "script");
    const gitBin = install("pa-git");
    const workspace = mkdtempSync(join(tmpdir(), "deny-ws-"));
    try {
      await runCursor({ prompt: "oi", engine: "claude", cwd: workspace, deny: ["pa-git push"] });
      const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
      expect(cmd).toBe(bwrap);
      const binds = args.flatMap((a, i) => a === "--bind" || a === "--ro-bind" ? [args.slice(i, i + 3)] : []);
      const shimAt = binds.findIndex((b) => b[0] === "--ro-bind" && b[2] === gitBin);
      expect(shimAt).toBeGreaterThan(-1);
      expect(binds.some((b) => b[2] === "/run/polyagent-real/pa-git" && b[1] === realpathSync(gitBin))).toBe(true);
      expect(binds.some((b) => b[0] === "--ro-bind" && b[2] === "/run/polyagent-shims")).toBe(true);
      expect(args[args.indexOf("PATH") + 1]).toBe(`/run/polyagent-shims:${binDir}`);
      expect(binds[binds.length - 1]).toEqual(["--bind", workspace, workspace]);
      expect(shimAt).toBeLessThan(binds.length - 1);
      // depois do run, o dir dos shims some
      expect(existsSync(binds[shimAt][1])).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("rejeita deny inválido nomeando o valor recebido, sem spawnar", async () => {
    install("bwrap", "script");
    await expect(runCursor({ prompt: "oi", engine: "claude", deny: ["/bin/rm"] }))
      .rejects.toThrow(/invalid deny entry.*received "\/bin\/rm"/);
    await expect(runCursor({ prompt: "oi", engine: "claude", deny: ["git push $X"] }))
      .rejects.toThrow(/received "git push \$X"/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("deny vazio ou ausente roda normalmente sem shims", async () => {
    install("bwrap", "script");
    for (const deny of [undefined, []]) {
      spawnMock.mockClear();
      const res = await runCursor({ prompt: "oi", engine: "claude", deny });
      expect(res.text).toBe("ok");
      const args = spawnMock.mock.calls[0][1] as string[];
      expect(args.some((a) => a.includes("polyagent-real"))).toBe(false);
    }
  });
});
