import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findCodexRollout, parseCodexRateLimits } from "../src/cli.js";
import { buildFormatRun, buildUsageEntry } from "../src/usage.js";

const tokenCount = (rate_limits: unknown, type = "event_msg") =>
  JSON.stringify({ type, payload: { type: "token_count", rate_limits } });

const limits = (used_percent: number) => ({
  primary: { used_percent, window_minutes: 10080, resets_at: 1795311247 },
  secondary: null,
  plan_type: "prolite",
  limit_id: "codex",
});

const snapshot = {
  usedPercent: 24, usedPercentFirst: 19, windowMinutes: 10080,
  resetsAt: 1795311247, planType: "prolite", limitId: "codex", secondaryUsedPercent: 3,
};

describe("parseCodexRateLimits", () => {
  it("retorna a primeira porcentagem e o último snapshot em ordem de arquivo", () => {
    const raw = [
      tokenCount({ ...limits(19), primary: { used_percent: 19, window_minutes: 300, resets_at: 1795310000 } }),
      tokenCount(limits(21)),
      tokenCount({ ...limits(24), secondary: { used_percent: 3 } }),
    ].join("\n");
    expect(parseCodexRateLimits(raw)).toEqual(snapshot);
  });

  it("ignora linhas malformadas, sem rate_limits ou de outros eventos", () => {
    const raw = [
      "{invalid", "null", tokenCount(null), tokenCount(limits(99), "response_item"),
      tokenCount(limits(24)), tokenCount({ primary: { used_percent: "99" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "other", rate_limits: limits(98) } }),
    ].join("\n");
    expect(parseCodexRateLimits(raw)).toEqual({ ...snapshot, usedPercentFirst: 24, secondaryUsedPercent: null });
  });

  it("retorna null sem snapshots válidos", () => {
    expect(parseCodexRateLimits(["", "{", tokenCount(null), tokenCount({})].join("\n"))).toBeNull();
  });
});

describe("findCodexRollout", () => {
  const home = "/codex";
  const thread = "019f7049-22af-79a2-aaaa-123456789abc";
  const now = new Date("2026-11-01T00:01:00Z");
  const today = join(home, "sessions/2026/11/01");
  const yesterday = join(home, "sessions/2026/10/31");
  const dayBefore = join(home, "sessions/2026/10/30");
  const older = join(home, "sessions/2026/10/29");
  const file = `rollout-2026-10-31T23-59-00-${thread}.jsonl`;

  it("encontra o rollout de ontem mesmo se o diretório de hoje não existir", () => {
    const fakeFs = {
      readdirSync: vi.fn((path: string) => {
        if (path === today) throw new Error("ENOENT");
        return path === yesterday ? [`${file}.bak`, file] : [];
      }),
    };
    expect(findCodexRollout(thread, home, now, fakeFs)).toBe(join(yesterday, file));
    expect(fakeFs.readdirSync.mock.calls).toEqual([[today], [yesterday]]);
  });

  it("retorna null e lista apenas os três diretórios UTC recentes", () => {
    const fakeFs = { readdirSync: vi.fn((path: string) => path === older ? [file] : ["unrelated.jsonl"]) };
    expect(findCodexRollout(thread, home, now, fakeFs)).toBeNull();
    expect(fakeFs.readdirSync.mock.calls).toEqual([[today], [yesterday], [dayBefore]]);
  });
});

describe("workerQuota no uso do worker", () => {
  it("grava a cota na mesma entrada que workerUsage", () => {
    const usage = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2, costUsd: null };
    const res = { engine: "codex", usage, workerQuota: snapshot };
    const run = buildFormatRun(res, { engine: "codex" }, "codex:s1");
    expect(buildUsageEntry("delegate", 2, undefined, run)).toMatchObject({
      workerUsage: usage, workerQuota: snapshot,
    });
  });

  it("omite a cota sem snapshot e no recibo extra do fan_out", () => {
    const codex = { engine: "codex", workerQuota: snapshot };
    expect(buildFormatRun({ engine: "claude" }, undefined, "claude:s1")).not.toHaveProperty("workerQuota");
    expect(buildFormatRun(codex, undefined, "codex:s1", true)).not.toHaveProperty("workerQuota");
  });
});
