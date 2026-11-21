import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

// Sandbox off: o spawn é fake, então bwrap/bind mounts não teriam o que isolar aqui.
process.env.POLYAGENT_SANDBOX = "off";
const codexHome = mkdtempSync(join(tmpdir(), "polyagent-rollout-"));
vi.stubEnv("CODEX_HOME", codexHome);
// a cota só é lida com o log ligado (sem log o snapshot seria descartado)
vi.stubEnv("POLYAGENT_LOG", join(codexHome, "usage.jsonl"));
const { runCursor, ProcessError } = await import("../src/cli.js");
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(codexHome, { recursive: true, force: true });
});

/** Child fake que emite stdout/stderr e fecha com o código pedido. */
function fakeChild(stdout: string, stderr: string, code: number) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", code);
  });
  return child;
}

describe("erro de processo", () => {
  beforeEach(() => spawnMock.mockReset());

  it("preserva stdout, stderr e exitCode quando ambos têm conteúdo", async () => {
    const stdout = JSON.stringify({ error: { type: "usage_limit", message: "quota exhausted" } });
    const stderr = "warning: something noisy\n";
    spawnMock.mockImplementation(() => fakeChild(stdout, stderr, 1));

    const error = await runCursor({ prompt: "x", engine: "claude" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProcessError);
    const processError = error as InstanceType<typeof ProcessError>;
    expect(processError.stdout).toBe(stdout);
    expect(processError.stderr).toBe(stderr);
    expect(processError.exitCode).toBe(1);
  });

  it("não regride a mensagem visível ao chamador", async () => {
    spawnMock.mockImplementation(() => fakeChild("ignored stdout", "boom\n", 2));

    const error = await runCursor({ prompt: "x", engine: "claude" }).catch((e: unknown) => e);

    expect((error as Error).message).toBe("claude agent exited 2: boom");
  });

  it("cai no stdout na mensagem quando o stderr está vazio", async () => {
    spawnMock.mockImplementation(() => fakeChild("stdout detail", "", 3));

    const error = await runCursor({ prompt: "x", engine: "claude" }).catch((e: unknown) => e);

    expect((error as Error).message).toBe("claude agent exited 3: stdout detail");
    expect((error as InstanceType<typeof ProcessError>).stdout).toBe("stdout detail");
  });

  it("mantém o fallback de engine do codex lendo o stderr", async () => {
    // PATH fake com só o `grok`: hasEngine varre o PATH real, então sem isso o teste dependeria
    // de quais CLIs estão instalados na máquina de quem roda a suíte.
    const binDir = mkdtempSync(join(tmpdir(), "polyagent-fallback-"));
    writeFileSync(join(binDir, "grok"), "", { mode: 0o755 });
    const originalPath = process.env.PATH;
    process.env.PATH = binDir;

    // 1ª chamada: codex falha com erro de ambiente. 2ª: o grok (shape {text, sessionId}) responde ok.
    spawnMock
      .mockImplementationOnce(() => fakeChild("", "Read-only file system\n", 1))
      .mockImplementationOnce(() => fakeChild(JSON.stringify({ text: "ok", sessionId: "s1" }), "", 0));

    const result = await runCursor({ prompt: "x", engine: "codex" })
      .finally(() => {
        process.env.PATH = originalPath;
        rmSync(binDir, { recursive: true, force: true });
      });

    expect(result.text).toContain("ok");
    expect(result.text).toContain("[note: codex unavailable");
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});

describe("cota lida depois de o worker fechar", () => {
  it.each([0, 1])("anexa a cota do Codex com código de saída %s", async (code) => {
    const thread = `019f7049-22af-79a2-aaaa-123456789ab${code}`;
    const day = new Date().toISOString().slice(0, 10);
    const dir = join(codexHome, "sessions", ...day.split("-"));
    mkdirSync(dir, { recursive: true });
    const rollout = join(dir, `rollout-${day}T00-00-00-${thread}.jsonl`);
    spawnMock.mockImplementationOnce(() => {
      const child = fakeChild(JSON.stringify({ type: "thread.started", thread_id: thread }), "boom", code);
      child.prependOnceListener("close", () => {
        writeFileSync(rollout, JSON.stringify({
          type: "event_msg",
          payload: { type: "token_count", rate_limits: { primary: { used_percent: 24 }, limit_id: "codex" } },
        }));
      });
      return child;
    });

    const result = await runCursor({ prompt: "x", engine: "codex" }).catch((error: unknown) => error);
    if (code !== 0) expect(result).toBeInstanceOf(ProcessError);
    expect(result).toMatchObject({ workerQuota: { usedPercent: 24, usedPercentFirst: 24, limitId: "codex" } });

    spawnMock.mockImplementationOnce(() => fakeChild(JSON.stringify({ result: "ok", session_id: thread }), "", 0));
    await expect(runCursor({ prompt: "x", engine: "claude" })).resolves.not.toHaveProperty("workerQuota");
  });
});
