import { afterEach, describe, expect, it, vi } from "vitest";

// Cada import simula o boot do servidor, sem ler configuração ou gravar log do usuário.
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("health configuration and reset persistence", () => {
  it("reads the probe interval once at module load and defaults to thirty minutes", async () => {
    vi.resetModules();
    vi.stubEnv("POLYAGENT_QUOTA_PROBE_MS", undefined);
    const defaults = await import("../src/usage.js");
    expect(defaults.QUOTA_PROBE_MS).toBe(1_800_000);
    vi.stubEnv("POLYAGENT_QUOTA_PROBE_MS", "120000");
    expect(defaults.QUOTA_PROBE_MS).toBe(1_800_000);
    vi.resetModules();
    const custom = await import("../src/usage.js");
    expect(custom.QUOTA_PROBE_MS).toBe(120_000);
    const health = custom.engineHealthReport([
      { ts: 1_000_000, tool: "delegate", engine: "codex", outcome: "quota", outChars: 0 },
    ], 1_120_000).codex;
    expect(health.probe).toBe(true);
    expect(health.until).toBe(1_120_000);
  });

  it("falls back to thirty minutes for all five invalid probe configurations", async () => {
    for (const raw of ["0", "-1", "NaN", "Infinity", ""]) {
      vi.resetModules();
      vi.stubEnv("POLYAGENT_QUOTA_PROBE_MS", raw);
      expect((await import("../src/usage.js")).QUOTA_PROBE_MS).toBe(1_800_000);
    }
  });

  it("rejects a nonempty reset when logging is off", async () => {
    vi.resetModules();
    vi.stubEnv("POLYAGENT_LOG", undefined);
    const usage = await import("../src/usage.js");
    expect(() => usage.logHealthResets(usage.buildHealthResetEntries(["codex"], 1)))
      .toThrow("reset_health requires POLYAGENT_LOG");
    expect(() => usage.logHealthResets([])).not.toThrow();
  });
});
