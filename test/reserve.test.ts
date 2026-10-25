import { describe, expect, it, vi } from "vitest";
import { LEVELS, TIERS, QuotaError, resolveTier, runWithReserve, type RunOpts } from "../src/cli.js";

const reserves = {
  low: { engine: "claude", model: "claude-haiku-5-5", effort: "xhigh" },
  middle: { engine: "claude", model: "claude-haiku-5-5", effort: "max" },
  high: { engine: "codex", model: "gpt-6.1-sol", effort: "max" },
};

describe("level reserves", () => {
  it.each(LEVELS)("%s uses the approved reserve before Cursor when primary is missing", (level) => {
    expect(TIERS[level].reserve).toEqual(reserves[level]);
    expect(resolveTier(level, (e) => e !== TIERS[level].primary.engine, true)).toEqual({
      ...reserves[level], skipped: [{ engine: TIERS[level].primary.engine, cause: "missing" }],
    });
  });
  it.each(LEVELS)("%s preserves quota cause and deadline when primary is unhealthy", (level) => {
    const primary = TIERS[level].primary.engine;
    expect(resolveTier(level, () => true, false, {
      [primary]: { score: 0, cause: "quota", until: 12345, probe: false },
    })).toEqual({ ...reserves[level], skipped: [{ engine: primary, cause: "quota", until: 12345 }] });
  });
  it("uses Cursor only after both subscription engines are unavailable", () => {
    expect(resolveTier("low", () => true, true, { codex: 0, claude: 0 })).toEqual({
      engine: "cursor", model: TIERS.low.cursorModel,
      skipped: [{ engine: "codex", cause: "failures" }, { engine: "claude", cause: "failures" }],
    });
  });
  it("names missing primary and unhealthy reserve in the final error", () => {
    expect(() => resolveTier("low", (e) => e !== "codex", false, { claude: 0 }))
      .toThrow(/codex.*missing.*claude.*failures/);
  });
  it("rejects a missing Cursor even when it is enabled", () => {
    expect(() => resolveTier("low", () => false, true)).toThrow(/codex.*missing.*claude.*missing.*cursor.*missing/);
  });
});

describe("runWithReserve", () => {
  const opts = (level: typeof LEVELS[number]): RunOpts => ({
    prompt: "same task", ...TIERS[level].primary, cwd: "/project", agentPrompt: "persona",
    deny: ["git push"], roBinds: ["/skills/example"], timeoutMs: 1234, force: true, tool: "delegate",
  });
  it.each(LEVELS)("%s retries quota once on its reserve and preserves all other opts", async (level) => {
    const original = { ...opts(level), model: "custom-primary-model", effort: "custom-effort" };
    const run = vi.fn().mockRejectedValueOnce(new QuotaError("quota_exhausted", original.engine!, "quota"))
      .mockResolvedValueOnce("success");
    expect(await runWithReserve(level, original, run)).toBe("success");
    expect(run.mock.calls).toEqual([
      [original],
      [{ ...original, ...reserves[level] }, `[note: ${original.engine} quota exhausted — reran on reserve ${reserves[level].engine} ${reserves[level].model} ${reserves[level].effort}]`],
    ]);
    expect(original.model).toBe("custom-primary-model");
  });
  it.each(["rate_limited", "other", "wrong-engine"])("does not retry %s", async (kind) => {
    const err = kind === "other" ? new Error("auth expired")
      : new QuotaError(kind === "rate_limited" ? "rate_limited" : "quota_exhausted", kind === "wrong-engine" ? "grok" : "codex", "failure");
    const run = vi.fn().mockRejectedValue(err);
    await expect(runWithReserve("low", opts("low"), run)).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("does not retry an explicit engine even when it matches the primary", async () => {
    const err = new QuotaError("quota_exhausted", "codex", "quota");
    const run = vi.fn().mockRejectedValue(err);
    await expect(runWithReserve("low", opts("low"), run, true)).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("does not retry when resolution already selected the reserve", async () => {
    const err = new QuotaError("quota_exhausted", "claude", "quota");
    const run = vi.fn().mockRejectedValue(err);
    await expect(runWithReserve("low", { ...opts("low"), engine: "claude" }, run)).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it.each(["quota", "rate", "other"])("propagates reserve %s failure with both engines and no third run", async (kind) => {
    const err = kind === "other" ? new Error("reserve auth failed")
      : new QuotaError(kind === "rate" ? "rate_limited" : "quota_exhausted", "claude", "reserve failure");
    const run = vi.fn().mockRejectedValueOnce(new QuotaError("quota_exhausted", "codex", "quota"))
      .mockRejectedValueOnce(err);
    await expect(runWithReserve("low", opts("low"), run)).rejects.toBe(err);
    expect(err.message).toMatch(/codex quota exhausted.*reserve claude failed.*reserve/);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("leaves other tools outside the reserve policy", async () => {
    const err = new QuotaError("quota_exhausted", "codex", "quota");
    const run = vi.fn().mockRejectedValue(err);
    await expect(runWithReserve("low", { ...opts("low"), tool: "fast_delegate" }, run)).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
