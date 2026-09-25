import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Jev internal feature flags", () => {
  it("keeps both paths off and threshold at 0.85 by default", async () => {
    vi.stubEnv("POLYAGENT_JEV_FANOUT", "");
    vi.stubEnv("POLYAGENT_JEV_SHADOW", "");
    vi.stubEnv("POLYAGENT_JEV_FANOUT_THRESHOLD", "");
    vi.resetModules();
    const config = await import("../src/jev.js");
    expect(config.JEV_FANOUT_ENABLED).toBe(false);
    expect(config.JEV_SHADOW_ENABLED).toBe(false);
    expect(config.JEV_FANOUT_THRESHOLD).toBe(0.85);
  });

  it("accepts 1/true/on and a valid threshold; rejects invalid threshold", async () => {
    vi.stubEnv("POLYAGENT_JEV_FANOUT", "true");
    vi.stubEnv("POLYAGENT_JEV_SHADOW", "on");
    vi.stubEnv("POLYAGENT_JEV_FANOUT_THRESHOLD", "0.92");
    vi.resetModules();
    const enabled = await import("../src/jev.js");
    expect(enabled.JEV_FANOUT_ENABLED).toBe(true);
    expect(enabled.JEV_SHADOW_ENABLED).toBe(true);
    expect(enabled.JEV_FANOUT_THRESHOLD).toBe(0.92);

    vi.stubEnv("POLYAGENT_JEV_FANOUT", "1");
    vi.stubEnv("POLYAGENT_JEV_SHADOW", "1");
    vi.resetModules();
    const numeric = await import("../src/jev.js");
    expect(numeric.JEV_FANOUT_ENABLED).toBe(true);
    expect(numeric.JEV_SHADOW_ENABLED).toBe(true);

    vi.stubEnv("POLYAGENT_JEV_FANOUT_THRESHOLD", "invalid");
    vi.resetModules();
    const invalid = await import("../src/jev.js");
    expect(invalid.JEV_FANOUT_THRESHOLD).toBe(0.85);
  });
});
