import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DecisionRecord } from "../src/usage.js";

const decision: DecisionRecord = {
  name: "delegate_level_shadow", candidates: ["1", "2", "3", "4", "5"],
  choice: "2", confidence: 0.8, accepted: false, fallback: false,
  latencyMs: 25, cost: 0.001, actual: "3",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("logDecision", () => {
  it("appends a readable JSONL decision with outcome success", async () => {
    const dir = mkdtempSync(join(tmpdir(), "polyagent-decision-"));
    try {
      const path = join(dir, "usage.jsonl");
      vi.stubEnv("POLYAGENT_LOG", path);
      vi.resetModules();
      const { logDecision, readUsage } = await import("../src/usage.js");
      logDecision(decision);
      expect(readUsage()).toMatchObject([{
        tool: "decide", engine: "jev", outChars: 0, outcome: "success", decision,
      }]);
      expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is a no-op without a log path and swallows filesystem errors", async () => {
    vi.stubEnv("POLYAGENT_LOG", "");
    vi.resetModules();
    const disabled = await import("../src/usage.js");
    expect(() => disabled.logDecision(decision)).not.toThrow();

    const dir = mkdtempSync(join(tmpdir(), "polyagent-decision-"));
    try {
      vi.stubEnv("POLYAGENT_LOG", dir);
      vi.resetModules();
      const broken = await import("../src/usage.js");
      expect(() => broken.logDecision(decision)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
