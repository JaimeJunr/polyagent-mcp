import { describe, expect, it } from "vitest";
import * as usage from "../src/usage.js";
import * as cli from "../src/cli.js";
import type { UsageEntry } from "../src/usage.js";

const NOW = 10_000_000;
const WINDOW = 1_800_000;
const record = (outcome: UsageEntry["outcome"], age = 0, engine = "codex"): UsageEntry =>
  ({ ts: NOW - age, tool: "delegate", outChars: 0, engine, outcome });
const report = (records: UsageEntry[], now = NOW, quotaWindow = usage.QUOTA_WINDOW_MS, probeMs = WINDOW) =>
  usage.engineHealthReport(records, now, WINDOW, 300_000, quotaWindow, probeMs);

describe("quota recovery and health report", () => {
  it("clears quota older than the newest success even with unsorted logs", () => {
    expect(usage.computeEngineHealth([record("success"), record("quota", 1)], NOW)).toEqual({ codex: 1 });
  });

  it("uses the newest success across all history without clearing another engine", () => {
    const records = [record("success", WINDOW + 1), record("quota", WINDOW + 2), record("quota", 2, "claude")];
    expect(usage.computeEngineHealth(records, NOW)).toEqual({ claude: 0 });
    expect(report(records).codex).toEqual({ score: 1, cause: "ok", probe: false });
    expect(usage.computeEngineHealth([record("success", 1), record("quota")], NOW).codex).toBeCloseTo(0.5);
  });

  it("does not clear failures or timeouts after success", () => {
    for (const outcome of ["failure", "timeout"] as const) {
      expect(usage.computeEngineHealth([record(outcome, 1), record("success")], NOW).codex).toBeLessThan(0.6);
    }
  });

  it("opens a quota-only probe at the deadline and restarts it on another quota", () => {
    const records = [record("quota")];
    expect(report(records).codex).toEqual({ score: 0, cause: "quota", until: NOW + WINDOW, probe: false });
    expect(report(records, NOW + WINDOW - 1).codex.probe).toBe(false);
    expect(report(records, NOW + WINDOW).codex).toEqual({ score: 0, cause: "quota", until: NOW + WINDOW, probe: true });
    expect(report([...records, { ...record("quota"), ts: NOW + WINDOW }], NOW + WINDOW).codex.probe).toBe(false);
    expect(cli.resolveFastTier(() => true, false, report(records, NOW + WINDOW)).engine).toBe("codex");
  });

  it("keeps the original eligibility time once a quota probe is already open", () => {
    expect(report([record("quota", WINDOW + 60_000)]).codex)
      .toEqual({ score: 0, cause: "quota", until: NOW - 60_000, probe: true });
  });

  it("does not probe a quota block when failures alone still block", () => {
    const state = report([record("quota", WINDOW + 1), record("failure", 1)]).codex;
    expect(state.probe).toBe(false);
    expect(state.cause).toBe("failures");
    expect(state.until).toBe(NOW - 1 + WINDOW + 1);
  });

  it("reports the earlier quota expiry and preserves short-window expiry", () => {
    expect(report([record("quota")], NOW, 100).codex.until).toBe(NOW + 101);
    expect(report([record("timeout", 2)]).codex).toEqual({ score: 0, cause: "timeouts", until: NOW - 2 + WINDOW + 1, probe: false });
    expect(report([record("failure", WINDOW + 1)]).codex).toEqual({ score: 1, cause: "ok", probe: false });
  });

  it("reset clears only older records of its own engine and is order independent", () => {
    const reset = usage.buildHealthResetEntries(["codex"], NOW);
    const records = [record("quota", 1), record("timeout", 1), record("quota", 1, "claude"), ...reset];
    expect(usage.computeEngineHealth(records.reverse(), NOW)).toEqual({ claude: 0 });
    expect(report(records).codex).toEqual({ score: 1, cause: "ok", probe: false });
    expect(report([...records, { ...record("failure"), ts: NOW + 1 }], NOW + 1).codex.cause).toBe("failures");
  });

  it("uses the newest reset and preserves records at the same timestamp", () => {
    const resets = [record("reset", 10), record("reset", 1)];
    expect(usage.computeEngineHealth([resets[1], record("failure", 2), resets[0]], NOW)).toEqual({});
    expect(usage.computeEngineHealth([record("failure", 1), ...resets], NOW)).toEqual({ codex: 0 });
    expect(report([record("failure", 1_000), record("failure", 2_000)]).codex.until).toBe(NOW - 1_000 + WINDOW + 1);
  });

  it("does not count reset events as worker calls", () => {
    expect(usage.aggregate([record("success"), ...usage.buildHealthResetEntries(["codex"], NOW)]))
      .toEqual({ delegate: { calls: 1, totalOutChars: 0, avgOutChars: 0 } });
  });

  it("validates every reset engine before building records", () => {
    expect(() => usage.buildHealthResetEntries(["codex", "bogus"], NOW)).toThrow(/bogus.*cursor.*grok.*codex.*claude.*opencode.*kimi.*muse/);
    expect(usage.buildHealthResetEntries(["codex", "codex"], NOW)).toEqual([
      { ts: NOW, tool: "bridge_stats", outChars: 0, engine: "codex", outcome: "reset" },
    ]);
  });

  it("ignores future resets and successes and decision records", () => {
    const quota = record("quota");
    expect(report([quota, { ...record("success"), ts: NOW + 1 },
      { ...record("reset"), ts: NOW + 1 }, { ...record("success"), tool: "decide" }]).codex.score).toBe(0);
  });

  it("renders only logged engines with two-decimal scores and local eligibility", () => {
    const table = usage.renderEngineHealth(report([record("quota"), record("success", 0, "claude")]));
    expect(table).toContain(`codex | 0.00 | quota | ${usage.healthLocalTime(NOW + WINDOW)}`);
    expect(table).toContain("claude | 1.00 | ok | -");
    expect(table).not.toContain("grok");
  });

  it("renders an open quota probe as eligible now, not as a past time", () => {
    const table = usage.renderEngineHealth(report([record("quota", WINDOW + 60_000)]));
    expect(table).toContain("codex | 0.00 | quota | now (probe)");
  });
});

describe("health-aware routing visibility", () => {
  const state = () => report([record("quota")]);
  it("returns skipped causes from fast, read, filtered and delegate cascades", () => {
    const skipped = [{ engine: "codex", cause: "quota", until: NOW + WINDOW }];
    expect(cli.resolveFastTier(() => true, false, state()).skipped).toEqual(skipped);
    expect(cli.resolveReadTool("explore", {}, {}, () => true, false, state(), true).skipped).toEqual(skipped);
    expect(cli.resolveRunFiltered({}, {}, () => true, false, state(), true).skipped).toEqual(skipped);
    expect(cli.resolveDelegate("low", {}, () => true, true, state()).skipped).toEqual(skipped);
    expect(cli.resolveFastTier((e) => e !== "codex", false).skipped).toEqual([{ engine: "codex", cause: "missing" }]);
  });

  it("names quota, local deadline and reset command in all blocked resolver errors", () => {
    const eligible = usage.healthLocalTime(NOW + WINDOW);
    for (const run of [
      () => cli.resolveTier("low", (e) => e !== "claude", false, state()),
      () => cli.resolveFastTier((e) => e === "codex", false, state()),
      () => cli.resolveReadTool("web_lookup", {}, {}, (e) => e === "codex", false, state(), true),
    ]) {
      expect(run).toThrow("quota");
      expect(run).toThrow(eligible);
      expect(run).toThrow("bridge_stats reset_health");
    }
  });

  it("reports a blocked Cursor fallback even when the primary CLI is missing", () => {
    const run = () => cli.resolveTier("low", (e) => e === "cursor", true, report([record("quota", 0, "cursor")]));
    expect(run).toThrow("cursor (quota");
    expect(run).toThrow(usage.healthLocalTime(NOW + WINDOW));
    expect(run).toThrow("bridge_stats reset_health");
  });

  it("names failures and timeouts separately in blocked routing errors", () => {
    for (const [outcome, cause] of [["failure", "failures"], ["timeout", "timeouts"]] as const) {
      const state = report([record(outcome)]);
      const run = () => cli.resolveTier("low", (e) => e !== "claude", false, state);
      expect(run).toThrow(cause);
      expect(run).toThrow(usage.healthLocalTime(NOW + WINDOW + 1));
      expect(run).toThrow("bridge_stats reset_health");
    }
  });

  it("builds one switch line and omits it without skipped engines", () => {
    expect(cli.engineSwitchLine("claude", [])).toBe("");
    expect(cli.engineSwitchLine("claude", [{ engine: "codex", cause: "quota", until: NOW + WINDOW }]))
      .toBe(`[engine: claude — skipped codex (quota, eligible ${usage.healthLocalTime(NOW + WINDOW)})]`);
    const multiple = cli.engineSwitchLine("grok", [{ engine: "codex", cause: "missing" }, { engine: "claude", cause: "timeouts", until: NOW }]);
    expect(multiple).toBe(`[engine: grok — skipped codex (missing), claude (timeouts, eligible ${usage.healthLocalTime(NOW)})]`);
    expect(multiple.split("\n")).toHaveLength(1);
  });
});
