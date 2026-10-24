import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/** Cria um executável fake dentro do PATH stubado. */
function install(name: string): string {
  const p = join(binDir, name);
  writeFileSync(p, "#!/bin/sh\n");
  chmodSync(p, 0o755);
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
  it("escreve o shim (0755) fora dos mounts do sandbox, binda o real e limpa no cleanup", () => {
    const gitBin = install("git");
    const built = buildSandboxSpec("/repo", "codex", false, [], [{ cmd: "git", args: ["push"] }]);
    try {
      const mine = built.spec.shims.filter((s) => s.target === gitBin);
      expect(mine).toHaveLength(1);
      const file = mine[0].file;
      expect(statSync(file).mode & 0o777).toBe(0o755);
      expect(readFileSync(file, "utf8")).toContain(`REAL='/run/polyagent-real/git'`);
      // o worker enxerga isoHome ($HOME) e tmpDir (/tmp) em RW: o shim não pode morar neles
      expect(file.startsWith(built.spec.isoHome)).toBe(false);
      expect(file.startsWith(built.spec.tmpDir)).toBe(false);
      expect(built.spec.realBins).toEqual([{ src: realpathSync(gitBin), dest: "/run/polyagent-real/git" }]);
      // todo shim aponta pro mesmo arquivo do comando
      expect(new Set(built.spec.shims.map((s) => s.file)).size).toBe(1);
      built.cleanup();
      expect(existsSync(file)).toBe(false);
    } finally {
      built.cleanup();
    }
  });

  it("pula comando inexistente (nada a bloquear) sem lançar", () => {
    const built = buildSandboxSpec("/repo", "codex", false, [], [{ cmd: "polyagent-fantasma-xyz", args: [] }]);
    try {
      expect(built.spec.shims).toEqual([]);
      expect(built.spec.realBins).toEqual([]);
    } finally {
      built.cleanup();
    }
  });

  it("sem deny, shims e realBins ficam vazios", () => {
    const built = buildSandboxSpec("/repo", "codex");
    try {
      expect(built.spec.shims).toEqual([]);
      expect(built.spec.realBins).toEqual([]);
    } finally {
      built.cleanup();
    }
  });
});

describe("runCursor com deny (sandbox ligado)", () => {
  it("passa os binds do shim ao bwrap, com o workspace por último", async () => {
    const bwrap = install("bwrap");
    const gitBin = install("git");
    const workspace = mkdtempSync(join(tmpdir(), "deny-ws-"));
    try {
      await runCursor({ prompt: "oi", engine: "claude", cwd: workspace, deny: ["git push"] });
      const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
      expect(cmd).toBe(bwrap);
      const binds = args.flatMap((a, i) => a === "--bind" || a === "--ro-bind" ? [args.slice(i, i + 3)] : []);
      const shimAt = binds.findIndex((b) => b[0] === "--ro-bind" && b[2] === gitBin);
      expect(shimAt).toBeGreaterThan(-1);
      expect(binds.some((b) => b[2] === "/run/polyagent-real/git" && b[1] === realpathSync(gitBin))).toBe(true);
      expect(binds[binds.length - 1]).toEqual(["--bind", workspace, workspace]);
      expect(shimAt).toBeLessThan(binds.length - 1);
      // depois do run, o dir dos shims some
      expect(existsSync(binds[shimAt][1])).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("rejeita deny inválido nomeando o valor recebido, sem spawnar", async () => {
    install("bwrap");
    await expect(runCursor({ prompt: "oi", engine: "claude", deny: ["/bin/rm"] }))
      .rejects.toThrow(/invalid deny entry.*received "\/bin\/rm"/);
    await expect(runCursor({ prompt: "oi", engine: "claude", deny: ["git push $X"] }))
      .rejects.toThrow(/received "git push \$X"/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("deny vazio ou ausente roda normalmente sem shims", async () => {
    install("bwrap");
    for (const deny of [undefined, []]) {
      spawnMock.mockClear();
      const res = await runCursor({ prompt: "oi", engine: "claude", deny });
      expect(res.text).toBe("ok");
      const args = spawnMock.mock.calls[0][1] as string[];
      expect(args.some((a) => a.includes("polyagent-real"))).toBe(false);
    }
  });
});
