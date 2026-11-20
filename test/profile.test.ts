import { describe, expect, it } from "vitest";
import { alwaysLoadMeta, PROFILE_ALWAYS_LOAD, resolveProfile } from "../src/profile.js";

describe("resolveProfile", () => {
  it("usa full quando a variável não existe, como antes dos perfis", () => {
    expect(resolveProfile(undefined)).toBe("full");
    expect(resolveProfile("")).toBe("full");
  });

  it("aceita minimal e full sem diferenciar maiúsculas nem espaços", () => {
    expect(resolveProfile(" MINIMAL ")).toBe("minimal");
    expect(resolveProfile("Full")).toBe("full");
  });

  it("valor desconhecido cai em full em vez de esconder tools", () => {
    expect(resolveProfile("tiny")).toBe("full");
  });
});

describe("alwaysLoadMeta", () => {
  it("minimal carrega só delegate, explore e run_filtered", () => {
    expect([...PROFILE_ALWAYS_LOAD.minimal].sort()).toEqual(["delegate", "explore", "run_filtered"]);
    expect(alwaysLoadMeta("minimal", "delegate")).toEqual({ "anthropic/alwaysLoad": true });
    for (const tool of ["web_lookup", "fan_out", "rate", "read_slice"]) {
      expect(alwaysLoadMeta("minimal", tool)).toBeUndefined();
    }
  });

  it("full mantém as seis tools de sempre e deixa as secundárias deferidas", () => {
    for (const tool of ["delegate", "explore", "run_filtered", "web_lookup", "fan_out", "rate"]) {
      expect(alwaysLoadMeta("full", tool)).toEqual({ "anthropic/alwaysLoad": true });
    }
    for (const tool of ["read_slice", "generate_image", "follow_up", "bridge_stats", "decide"]) {
      expect(alwaysLoadMeta("full", tool)).toBeUndefined();
    }
  });
});
