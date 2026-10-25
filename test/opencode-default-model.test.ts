import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("usa mercury-2 quando modelo e env não são fornecidos", async () => {
  vi.stubEnv("POLYAGENT_OPENCODE_MODEL", undefined);
  vi.resetModules();
  const { OPENCODE_DEFAULT_MODEL, buildOpencodeArgs } = await import("../src/cli.js");
  expect(OPENCODE_DEFAULT_MODEL).toBe("openrouter/inception/mercury-2");
  expect(buildOpencodeArgs({ prompt: "x" })).toContain("openrouter/inception/mercury-2");
});

it("lê POLYAGENT_OPENCODE_MODEL uma vez e respeita modelo explícito", async () => {
  vi.stubEnv("POLYAGENT_OPENCODE_MODEL", "openrouter/test/model");
  vi.resetModules();
  const { OPENCODE_DEFAULT_MODEL, buildOpencodeArgs } = await import("../src/cli.js");
  vi.stubEnv("POLYAGENT_OPENCODE_MODEL", "other/changed");
  expect(OPENCODE_DEFAULT_MODEL).toBe("openrouter/test/model");
  expect(buildOpencodeArgs({ prompt: "x" })).toContain("openrouter/test/model");
  expect(buildOpencodeArgs({ prompt: "x", model: "google/explicit" })).toContain("google/explicit");
  expect(buildOpencodeArgs({ prompt: "x", model: "google/explicit" })).not.toContain("openrouter/test/model");
});
