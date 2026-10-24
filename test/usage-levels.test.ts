import { describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  readFileSync: disk.read,
}));
vi.stubEnv("POLYAGENT_LOG", "/virtual/usage.jsonl");
const { readUsage, aggregate, ratingStats, computeEngineHealth } = await import("../src/usage.js");
vi.unstubAllEnvs();

describe("reading old and named usage levels", () => {
  it.each([1, 3, 5, "low", "middle", "high"])("retains and aggregates requestedLevel %s", (requestedLevel) => {
    const entry = { ts: 100, tool: "delegate", outChars: 12, requestedLevel, matchedRequest: true,
      engine: "codex", model: "gpt-6-luna", effort: "max", sessionId: "codex:a", outcome: "success" };
    disk.read.mockReturnValue(JSON.stringify(entry) + '\n{bad json\n' + JSON.stringify({
      ts: 101, tool: "rate", outChars: 0, ratedSessionId: "codex:a", score: 5,
    }));
    const entries = readUsage();
    expect(entries).toHaveLength(2);
    expect(entries[0].requestedLevel).toBe(requestedLevel);
    expect(aggregate(entries).delegate).toEqual({ calls: 1, totalOutChars: 12, avgOutChars: 12 });
    expect(ratingStats(entries)["codex|gpt-6-luna|max|delegate"].avgScore).toBe(5);
    expect(computeEngineHealth(entries, 101)).toEqual({ codex: 1 });
  });

  it("preserves the neutral fast_delegate receipt alongside legacy records", () => {
    disk.read.mockReturnValue([
      { ts: 1, tool: "delegate", outChars: 10, requestedLevel: 4 },
      { ts: 2, tool: "fast_delegate", outChars: 20, requestedLevel: 0, matchedRequest: true },
    ].map((entry) => JSON.stringify(entry)).join("\n"));
    const entries = readUsage();
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ requestedLevel: 0, matchedRequest: true });
    expect(Object.keys(aggregate(entries))).toHaveLength(2);
  });
});
