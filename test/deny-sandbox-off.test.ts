import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

// Sandbox DESLIGADO por escolha do operador: deny não tem onde ser aplicado.
process.env.POLYAGENT_SANDBOX = "off";
const { runCursor } = await import("../src/cli.js");

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

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => fakeChild());
});

describe("deny com sandbox desligado", () => {
  it("rejeita nomeando o motivo e não spawna o worker", async () => {
    await expect(runCursor({ prompt: "oi", engine: "claude", deny: ["git push"] }))
      .rejects.toThrow(/deny.*bwrap sandbox.*POLYAGENT_SANDBOX=off/s);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("sem deny continua rodando sem sandbox", async () => {
    const res = await runCursor({ prompt: "oi", engine: "claude" });
    expect(res.text).toBe("ok");
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][0]).not.toMatch(/bwrap$/);
  });

  it("deny vazio também roda (nada a bloquear)", async () => {
    const res = await runCursor({ prompt: "oi", engine: "claude", deny: [] });
    expect(res.text).toBe("ok");
  });
});
