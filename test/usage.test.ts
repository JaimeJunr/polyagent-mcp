import { describe, it, expect } from "vitest";
import {
  aggregate,
  buildRatingEntry,
  buildUsageEntry,
  classifyOutcome,
  computeEngineHealth,
  LATENCY_FLOOR,
  QUOTA_WINDOW_MS,
  ratingStats,
  renderRatingStats,
  type UsageEntry,
} from "../src/usage.js";
import { HEALTH_THRESHOLD, resolveFastTier, type Engine } from "../src/cli.js";
import { estimateCostPerTask } from "../src/costs.js";

describe("estimateCostPerTask", () => {
  it("looks up a published AA cost by engine, model, and effort", () => {
    expect(estimateCostPerTask("codex", "gpt-6-sol", "high")).toBe(0.37);
    expect(estimateCostPerTask("claude", "claude-opus-5-5", "max")).toBe(5.98);
  });

  it("uses the published extended-thinking cost for Haiku at any effort", () => {
    expect(estimateCostPerTask("claude", "claude-haiku-4-5-20251001", "low")).toBe(0.21);
    expect(estimateCostPerTask("claude", "claude-haiku-4-5-20251001", "high")).toBe(0.21);
    expect(estimateCostPerTask("claude", "haiku", "low")).toBe(0.21);
  });

  it("does not guess unknown models or missing efforts", () => {
    expect(estimateCostPerTask("codex", "gpt-6-sol", undefined)).toBeUndefined();
    expect(estimateCostPerTask("codex", "gpt-6-sol", "ultra")).toBeUndefined();
    expect(estimateCostPerTask("grok", "gpt-6-sol", "high")).toBeUndefined();
  });
});

describe("aggregate", () => {
  it("sums calls and returned chars per tool", () => {
    const entries: UsageEntry[] = [
      { ts: 1, tool: "read_slice", outChars: 100 },
      { ts: 2, tool: "read_slice", outChars: 300 },
      { ts: 3, tool: "explore", outChars: 50 },
    ];
    const stats = aggregate(entries);
    expect(stats.read_slice).toEqual({ calls: 2, totalOutChars: 400, avgOutChars: 200 });
    expect(stats.explore).toEqual({ calls: 1, totalOutChars: 50, avgOutChars: 50 });
  });

  it("returns empty object for no entries", () => {
    expect(aggregate([])).toEqual({});
  });
});

describe("buildUsageEntry (tier-integrity receipt)", () => {
  it("includes requestedLevel and matchedRequest=true for the normal tier match", () => {
    const entry = buildUsageEntry("delegate", 120, { requestedLevel: 1, matchedRequest: true });
    expect(entry.requestedLevel).toBe(1);
    expect(entry.matchedRequest).toBe(true);
    expect(entry.tool).toBe("delegate");
    expect(entry.outChars).toBe(120);
  });

  it("marks matchedRequest=false when the tier fell back (e.g. to cursor)", () => {
    const entry = buildUsageEntry("delegate", 120, { requestedLevel: 1, matchedRequest: false });
    expect(entry.requestedLevel).toBe(1);
    expect(entry.matchedRequest).toBe(false);
  });

  it("omits tier fields when no tier info is given (non-tiered tools like explore)", () => {
    const entry = buildUsageEntry("explore", 80);
    expect(entry).not.toHaveProperty("requestedLevel");
    expect(entry).not.toHaveProperty("matchedRequest");
  });

  it("includes engine, outcome and durationMs when given a run", () => {
    const entry = buildUsageEntry(
      "delegate",
      120,
      { requestedLevel: 1, matchedRequest: true },
      { engine: "codex", outcome: "success", durationMs: 42 },
    );
    expect(entry.engine).toBe("codex");
    expect(entry.outcome).toBe("success");
    expect(entry.durationMs).toBe(42);
    expect(entry.requestedLevel).toBe(1);
    expect(entry.matchedRequest).toBe(true);
  });

  it("omits run fields when no run is given", () => {
    const entry = buildUsageEntry("delegate", 120, { requestedLevel: 1, matchedRequest: true });
    expect(entry).not.toHaveProperty("engine");
    expect(entry).not.toHaveProperty("outcome");
    expect(entry).not.toHaveProperty("durationMs");
  });
});

describe("ratings", () => {
  it("builds a trimmed, capped rating entry", () => {
    const entry = buildRatingEntry("codex:abc", 5, `  ${"x".repeat(305)}  `, 123);
    expect(entry).toEqual({
      ts: 123,
      tool: "rate",
      outChars: 0,
      ratedSessionId: "codex:abc",
      score: 5,
      note: "x".repeat(300),
    });
  });

  it.each([0, 6, 2.5])("rejects score %s with the received value and range", (score) => {
    expect(() => buildRatingEntry("codex:abc", score, "", 123))
      .toThrow(new RegExp(`received.*${String(score)}.*1.*5`, "i"));
  });

  it("rejects an empty session handle", () => {
    expect(() => buildRatingEntry("  ", 3, "", 123)).toThrow(/sessionHandle.*empty/i);
  });

  it("joins ratings to the last session entry and computes grouped quality metrics from all calls", () => {
    const entries: UsageEntry[] = [
      { ts: 1, tool: "delegate", outChars: 1, sessionId: "codex:a", engine: "codex", model: "gpt-6-luna", effort: "low", outcome: "success", durationMs: 100 },
      { ts: 2, tool: "delegate", outChars: 1, sessionId: "codex:b", engine: "codex", model: "gpt-6-luna", effort: "low", outcome: "failure", durationMs: 300 },
      { ts: 3, tool: "delegate", outChars: 1, sessionId: "codex:c", engine: "codex", model: "gpt-6-luna", effort: "low", outcome: "success", durationMs: 200 },
      { ts: 4, tool: "explore", outChars: 1, sessionId: "codex:replace", engine: "codex", model: "old-model", effort: "high", outcome: "success", durationMs: 999 },
      { ts: 5, tool: "delegate", outChars: 1, sessionId: "codex:replace", engine: "codex", model: "gpt-6-sol", effort: "max", outcome: "failure", durationMs: 400 },
      { ts: 6, tool: "web_lookup", outChars: 1, sessionId: "no-meta", outcome: "success", durationMs: 50 },
      { ts: 7, tool: "rate", outChars: 0, ratedSessionId: "codex:a", score: 5, note: "good" },
      { ts: 8, tool: "rate", outChars: 0, ratedSessionId: "codex:b", score: 4, note: "fixes" },
      { ts: 9, tool: "rate", outChars: 0, ratedSessionId: "codex:replace", score: 3, note: "last wins" },
      { ts: 10, tool: "rate", outChars: 0, ratedSessionId: "no-meta", score: 2, note: "missing fields" },
      { ts: 11, tool: "rate", outChars: 0, ratedSessionId: "missing", score: 1, note: "unknown" },
    ];

    expect(ratingStats(entries)).toEqual({
      "codex|gpt-6-luna|low|delegate": {
        ratings: 2,
        avgScore: 4.5,
        calls: 3,
        successRate: 2 / 3,
        p50DurationMs: 200,
      },
      "codex|gpt-6-sol|max|delegate": {
        ratings: 1,
        avgScore: 3,
        calls: 1,
        successRate: 0,
        p50DurationMs: 400,
      },
      "-|-|-|web_lookup": {
        ratings: 1,
        avgScore: 2,
        calls: 1,
        successRate: 1,
        p50DurationMs: 50,
      },
      unknown: {
        ratings: 1,
        avgScore: 1,
        calls: 0,
        successRate: null,
        p50DurationMs: null,
      },
    });
  });

  it("renders a compact table sorted by rating count descending", () => {
    const rendered = renderRatingStats({
      unknown: { ratings: 1, avgScore: 1, calls: 0, successRate: null, p50DurationMs: null },
      "codex|gpt-6-luna|low|delegate": { ratings: 2, avgScore: 4.5, calls: 4, successRate: 0.75, p50DurationMs: 200 },
    });
    expect(rendered).toContain("| group | est $/task (AA) | ratings | avg score | calls | success rate | p50 durationMs |");
    expect(rendered.indexOf("codex\\|gpt-6-luna\\|low\\|delegate")).toBeLessThan(rendered.indexOf("unknown"));
    expect(rendered).toContain("| 75.0% |");
    // sem nenhuma execução com outcome, a taxa é desconhecida — "0.0%" leria como "sempre falha".
    expect(rendered).toContain("| codex\\|gpt-6-luna\\|low\\|delegate | $0.0045 | 2 | 4.5 | 4 | 75.0% | 200 |");
    expect(rendered).toContain("| unknown | - | 1 | 1.0 | 0 | - | - |");
    expect(rendered).toContain("| - |");
  });

  it("renders known and unknown costs from rated usage groups", () => {
    const entries: UsageEntry[] = [
      { ts: 1, tool: "delegate", outChars: 1, sessionId: "known", engine: "codex", model: "gpt-6-sol", effort: "high" },
      { ts: 2, tool: "delegate", outChars: 1, sessionId: "missing-effort", engine: "codex", model: "gpt-6-sol" },
      { ts: 3, tool: "delegate", outChars: 1, sessionId: "unknown", engine: "grok", model: "grok-4.5", effort: "low" },
      { ts: 4, tool: "rate", outChars: 0, ratedSessionId: "known", score: 5 },
      { ts: 5, tool: "rate", outChars: 0, ratedSessionId: "missing-effort", score: 4 },
      { ts: 6, tool: "rate", outChars: 0, ratedSessionId: "unknown", score: 3 },
    ];
    const rendered = renderRatingStats(ratingStats(entries));
    expect(rendered).toContain("| codex\\|gpt-6-sol\\|high\\|delegate | $0.37 |");
    expect(rendered).toContain("| codex\\|gpt-6-sol\\|-\\|delegate | - |");
    expect(rendered).toContain("| grok\\|grok-4.5\\|low\\|delegate | - |");
  });
});

describe("classifyOutcome", () => {
  it("detects timeout from runCursor's setTimeout reject message", () => {
    expect(classifyOutcome(new Error("codex agent timed out after 1800000ms: "))).toBe("timeout");
    expect(classifyOutcome(new Error("grok agent timed out after 5000ms: hung"))).toBe("timeout");
  });

  it("classifies non-timeout errors as failure", () => {
    expect(classifyOutcome(new Error("codex agent exited 1: boom"))).toBe("failure");
    expect(classifyOutcome(new Error("failed to spawn 'codex': ENOENT"))).toBe("failure");
    expect(classifyOutcome("string error")).toBe("failure");
    expect(classifyOutcome(null)).toBe("failure");
  });
});

describe("computeEngineHealth", () => {
  const NOW = 1_000_000;
  const WINDOW = 30 * 60 * 1000;

  it("scores a consistently-failing engine low and a healthy engine high", () => {
    const records: UsageEntry[] = [
      { ts: NOW - 1000, tool: "delegate", outChars: 10, engine: "grok", outcome: "success" },
      { ts: NOW - 2000, tool: "delegate", outChars: 10, engine: "grok", outcome: "success" },
      { ts: NOW - 3000, tool: "delegate", outChars: 10, engine: "grok", outcome: "success" },
      { ts: NOW - 1000, tool: "delegate", outChars: 10, engine: "codex", outcome: "failure" },
      { ts: NOW - 2000, tool: "delegate", outChars: 10, engine: "codex", outcome: "timeout" },
      { ts: NOW - 3000, tool: "delegate", outChars: 10, engine: "codex", outcome: "failure" },
    ];
    const health = computeEngineHealth(records, NOW, WINDOW);
    expect(health.grok).toBeGreaterThan(0.8);
    expect(health.codex).toBeLessThan(0.2);
    expect(health.grok).toBeGreaterThan(health.codex);
  });

  it("weights recent records more than old ones (decay within the window)", () => {
    // Um engine que falhou há muito tempo (perto da borda da janela) mas teve sucesso recente
    // deve pontuar melhor que um que falhou recentemente e teve sucesso há muito tempo.
    const recentlyRecovered: UsageEntry[] = [
      { ts: NOW - WINDOW + 1000, tool: "delegate", outChars: 10, engine: "codex", outcome: "failure" },
      { ts: NOW - 500, tool: "delegate", outChars: 10, engine: "codex", outcome: "success" },
    ];
    const recentlyBroken: UsageEntry[] = [
      { ts: NOW - WINDOW + 1000, tool: "delegate", outChars: 10, engine: "codex", outcome: "success" },
      { ts: NOW - 500, tool: "delegate", outChars: 10, engine: "codex", outcome: "failure" },
    ];
    const recovered = computeEngineHealth(recentlyRecovered, NOW, WINDOW).codex;
    const broken = computeEngineHealth(recentlyBroken, NOW, WINDOW).codex;
    expect(recovered).toBeGreaterThan(broken);
  });

  it("drops records older than the decay window", () => {
    const records: UsageEntry[] = [
      { ts: NOW - WINDOW - 1, tool: "delegate", outChars: 10, engine: "codex", outcome: "failure" },
    ];
    expect(computeEngineHealth(records, NOW, WINDOW)).toEqual({});
  });

  it("ignores records without an engine field", () => {
    const records: UsageEntry[] = [
      { ts: NOW - 1000, tool: "explore", outChars: 10, outcome: "success" },
    ];
    expect(computeEngineHealth(records, NOW, WINDOW)).toEqual({});
  });

  it("penalizes high latency even on success", () => {
    const fast: UsageEntry[] = [
      { ts: NOW - 1000, tool: "delegate", outChars: 10, engine: "codex", outcome: "success", durationMs: 1000 },
    ];
    const slow: UsageEntry[] = [
      { ts: NOW - 1000, tool: "delegate", outChars: 10, engine: "codex", outcome: "success", durationMs: 600_000 },
    ];
    expect(computeEngineHealth(fast, NOW, WINDOW).codex).toBeGreaterThan(
      computeEngineHealth(slow, NOW, WINDOW).codex,
    );
  });

  it("reduces the latency penalty when given a ceiling matching a larger time budget", () => {
    const records: UsageEntry[] = [
      { ts: NOW - 1000, tool: "delegate", outChars: 10, engine: "grok", outcome: "success", durationMs: 600_000 },
    ];
    const defaultCeiling = computeEngineHealth(records, NOW, WINDOW).grok;
    const largerCeiling = computeEngineHealth(records, NOW, WINDOW, 1_800_000).grok;
    expect(largerCeiling).toBeGreaterThan(defaultCeiling);
  });

  it("keeps a slow-but-successful run at or above HEALTH_THRESHOLD — the exact real-world case that was falsely unhealthy before the fix", () => {
    const records: UsageEntry[] = [
      { ts: NOW - 1000, tool: "delegate", outChars: 10, engine: "grok", outcome: "success", durationMs: 22 * 60_000 },
    ];
    expect(computeEngineHealth(records, NOW, WINDOW, 1_800_000).grok).toBeGreaterThanOrEqual(HEALTH_THRESHOLD);
  });

  it("LATENCY_FLOOR stays above HEALTH_THRESHOLD — invariant that keeps latency-only penalties from ever disabling an engine", () => {
    expect(LATENCY_FLOOR).toBeGreaterThan(HEALTH_THRESHOLD);
  });

  it("falls back to the default ceiling for a non-finite or non-positive latencyCeilMs", () => {
    const records: UsageEntry[] = [
      { ts: NOW - 1000, tool: "delegate", outChars: 10, engine: "codex", outcome: "success", durationMs: 1000 },
    ];
    const withDefault = computeEngineHealth(records, NOW, WINDOW).codex;
    expect(computeEngineHealth(records, NOW, WINDOW, NaN).codex).toBeCloseTo(withDefault);
    expect(computeEngineHealth(records, NOW, WINDOW, 0).codex).toBeCloseTo(withDefault);
    expect(computeEngineHealth(records, NOW, WINDOW, -1).codex).toBeCloseTo(withDefault);
  });

  it("treats a record without durationMs as full latency score regardless of ceiling", () => {
    const records: UsageEntry[] = [
      { ts: NOW - 1000, tool: "delegate", outChars: 10, engine: "codex", outcome: "success" },
    ];
    expect(computeEngineHealth(records, NOW, WINDOW, 1_800_000).codex).toBe(1);
  });

  it("returns empty object for no records", () => {
    expect(computeEngineHealth([], NOW, WINDOW)).toEqual({});
  });

  it("a quota record DROPS engine health (score 0 — not ignored, not 1)", () => {
    const records: UsageEntry[] = [
      { ts: NOW - 1000, tool: "delegate", outChars: 0, engine: "codex", outcome: "quota" },
    ];
    expect(computeEngineHealth(records, NOW, WINDOW).codex).toBe(0);
  });

  it("quota on one engine does not affect another engine's health", () => {
    const records: UsageEntry[] = [
      { ts: NOW - 1000, tool: "delegate", outChars: 0, engine: "codex", outcome: "quota" },
      { ts: NOW - 1000, tool: "delegate", outChars: 10, engine: "grok", outcome: "success" },
    ];
    const health = computeEngineHealth(records, NOW, WINDOW);
    expect(health.codex).toBe(0);
    expect(health.grok).toBe(1);
    expect(health).not.toHaveProperty("claude");
  });

  it("old quota weighs less than recent success — decay recovers health without its own expiry", () => {
    const recovered: UsageEntry[] = [
      { ts: NOW - WINDOW + 1000, tool: "delegate", outChars: 0, engine: "codex", outcome: "quota" },
      { ts: NOW - 500, tool: "delegate", outChars: 10, engine: "codex", outcome: "success" },
    ];
    const stillDown: UsageEntry[] = [
      { ts: NOW - WINDOW + 1000, tool: "delegate", outChars: 10, engine: "codex", outcome: "success" },
      { ts: NOW - 500, tool: "delegate", outChars: 0, engine: "codex", outcome: "quota" },
    ];
    const recoveredHealth = computeEngineHealth(recovered, NOW, WINDOW).codex;
    const downHealth = computeEngineHealth(stillDown, NOW, WINDOW).codex;
    expect(recoveredHealth).toBeGreaterThan(downHealth);
    expect(recoveredHealth).toBeGreaterThan(HEALTH_THRESHOLD);
    expect(downHealth).toBeLessThan(HEALTH_THRESHOLD);
  });

  it("resolveFastTier skips an engine whose health dropped below threshold because of quota", () => {
    const records: UsageEntry[] = [
      { ts: NOW - 1000, tool: "fast_delegate", outChars: 0, engine: "codex", outcome: "quota" },
    ];
    const health = computeEngineHealth(records, NOW, WINDOW);
    expect(health.codex).toBeLessThan(HEALTH_THRESHOLD);
    const all: (e: Engine) => boolean = () => true;
    // Regra atual: Claude é a segunda assinatura; OpenRouter só entra depois de Codex e Claude.
    expect(resolveFastTier(all, false, health)).toEqual({
      engine: "claude",
      model: "haiku",
      effort: "low",
    });
  });

  it("quota OUTSIDE the short window but INSIDE the long window still drops health — the measured host gap", () => {
    // 31 min: fora dos 30 min de failure/timeout, dentro das 6h de cota. Sem a janela longa
    // o registro some do mapa e a engine é tratada como saudável por omissão.
    const age = WINDOW + 60_000;
    const records: UsageEntry[] = [
      { ts: NOW - age, tool: "delegate", outChars: 0, engine: "codex", outcome: "quota" },
    ];
    expect(computeEngineHealth(records, NOW, WINDOW, 300_000, WINDOW)).toEqual({});
    expect(computeEngineHealth(records, NOW, WINDOW).codex).toBe(0);
  });

  it("failure outside the short window does NOT count — transient signal stays short", () => {
    const records: UsageEntry[] = [
      { ts: NOW - WINDOW - 60_000, tool: "delegate", outChars: 0, engine: "codex", outcome: "failure" },
    ];
    expect(computeEngineHealth(records, NOW, WINDOW)).toEqual({});
  });

  it("quota outside the LONG window no longer counts — recovery still exists", () => {
    const records: UsageEntry[] = [
      { ts: NOW - QUOTA_WINDOW_MS - 1, tool: "delegate", outChars: 0, engine: "codex", outcome: "quota" },
    ];
    expect(computeEngineHealth(records, NOW, WINDOW)).toEqual({});
  });

  it("stale quota (outside 30 min, inside 6h) makes resolveFastTier skip the exhausted engine", () => {
    // Cenário medido no host: cota de 2h atrás, janela de produção de 30 min. Sem a janela
    // longa o codex nem aparece no mapa e a cascata o escolhe de novo.
    const twoHours = 2 * 60 * 60 * 1000;
    const records: UsageEntry[] = [
      { ts: NOW - twoHours, tool: "fast_delegate", outChars: 0, engine: "codex", outcome: "quota" },
    ];
    const health = computeEngineHealth(records, NOW, WINDOW);
    expect(health).toHaveProperty("codex");
    expect(health.codex).toBe(0);
    expect(health.codex).toBeLessThan(HEALTH_THRESHOLD);
    const all: (e: Engine) => boolean = () => true;
    expect(resolveFastTier(all, false, health)).toEqual({
      engine: "claude",
      model: "haiku",
      effort: "low",
    });
  });
});
