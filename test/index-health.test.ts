import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunOpts } from "../src/cli.js";

const { registered, run } = vi.hoisted(() => ({
  registered: new Map<string, { config: any; handler: (args: any) => Promise<any> }>(),
  run: vi.fn(async (opts: RunOpts) => ({ text: "worker output", engine: opts.engine, sessionId: "worker-session" })),
}));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(name: string, config: any, handler: (args: any) => Promise<any>) {
      registered.set(name, { config, handler });
    }
    async connect() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class {} }));
vi.mock("../src/cli.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/cli.js")>(),
  runCursor: run, hasEngine: () => true, CURSOR_ENABLED: true, sandboxPreflight: () => {},
}));
const dir = mkdtempSync(join(tmpdir(), "polyagent-health-test-"));
const log = join(dir, "usage.jsonl");
vi.stubEnv("POLYAGENT_LOG", log);
for (const key of ["POLYAGENT_CLAUDE_MD", "POLYAGENT_SKILL", "POLYAGENT_JEV_SHADOW", "POLYAGENT_JEV_VERIFY", "POLYAGENT_JEV_FANOUT"]) vi.stubEnv(key, "off");
await import("../src/index.js");
const { readUsage, engineHealthReport } = await import("../src/usage.js");
const tool = (name: string) => registered.get(name)!;
const call = async (name: string, args = {}) => (await tool(name).handler(args)).content[0].text as string;

beforeEach(() => {
  run.mockClear();
  writeFileSync(log, JSON.stringify({ ts: Date.now() - 1000, tool: "delegate", engine: "codex", outcome: "quota", outChars: 0 }) + "\n");
});
afterAll(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe("health visibility through registered tool handlers", () => {
  it("keeps twelve tools and exposes reset_health as an optional string array", () => {
    expect(registered.size).toBe(12);
    const schema = tool("bridge_stats").config.inputSchema.reset_health;
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse(["codex"])).toEqual(["codex"]);
    expect(() => schema.parse("codex")).toThrow();
  });

  it("persists reset, preserves old log lines and immediately displays recovered health", async () => {
    const before = readFileSync(log, "utf8");
    expect(await call("bridge_stats")).toContain("codex | 0.00 | quota |");
    const text = await call("bridge_stats", { reset_health: ["codex"] });
    expect(readFileSync(log, "utf8").startsWith(before)).toBe(true);
    expect(readUsage().filter((r) => r.outcome === "reset")).toHaveLength(1);
    expect(text).toContain("codex | 1.00 | ok | -");
    expect(engineHealthReport(readUsage(), Date.now()).codex.score).toBe(1);
  });

  it("rejects an unknown reset atomically and names all seven valid engines", async () => {
    const before = readFileSync(log, "utf8");
    await expect(call("bridge_stats", { reset_health: ["codex", "bad-engine"] }))
      .rejects.toThrow(/bad-engine.*cursor.*grok.*codex.*claude.*opencode.*kimi.*muse/);
    expect(readFileSync(log, "utf8")).toBe(before);
  });

  it.each([
    ["delegate", { prompt: "task", level: "low" }],
    ["fast_delegate", { prompt: "task" }],
    ["explore", { question: "locate a symbol" }],
    ["read_slice", { files: ["src/cli.ts"], want: "resolveTier signature" }],
    ["run_filtered", { command: "true" }],
    ["web_lookup", { query: "documentation" }],
    ["fan_out", { prompt: "task", levels: ["low", "high"], mode: "race" }],
  ])("%s reports a skipped engine once before the session footer", async (name, args) => {
    const text = await call(name as string, args as any);
    expect(text.match(/\[engine:/g)).toHaveLength(1);
    expect(text).toContain("skipped codex (quota, eligible ");
    expect(text.indexOf("[engine:")).toBeLessThan(text.indexOf("session_id:"));
    expect(run.mock.calls.every(([opts]) => opts.engine !== "codex")).toBe(true);
  });

  it("fan_out consensus also avoids a blocked engine for its arbiter", async () => {
    const text = await call("fan_out", { prompt: "task", levels: ["low", "high"], mode: "consensus" });
    expect(run.mock.calls).toHaveLength(3);
    expect(run.mock.calls.every(([opts]) => opts.engine !== "codex")).toBe(true);
    expect(text.match(/\[engine:/g)).toHaveLength(1);
  });

  it("omits a switch line when the first engine is healthy", async () => {
    writeFileSync(log, "");
    expect(await call("fast_delegate", { prompt: "task" })).not.toContain("[engine:");
  });
});

const { QuotaError, TIERS, LEVELS } = await import("../src/cli.js");
describe("reserve retry through registered handlers", () => {
  beforeEach(() => { writeFileSync(log, ""); });

  it.each(LEVELS)("delegate %s logs primary quota and reserve success exactly once", async (level) => {
    const { primary, reserve } = TIERS[level];
    run.mockRejectedValueOnce(new QuotaError("quota_exhausted", primary.engine, "primary quota"));
    const text = await call("delegate", {
      prompt: "task", level, cwd: dir, agent: { prompt: "persona" }, deny: ["git push"],
      timeout_ms: 54321, model: "custom-primary", effort: "custom-effort",
    });
    expect(run.mock.calls).toHaveLength(2);
    const [first, second] = run.mock.calls.map(([opts]) => opts);
    expect(second).toEqual({ ...first, engine: reserve.engine, model: reserve.model, effort: reserve.effort });
    expect(text).toContain(`[note: ${primary.engine} quota exhausted — reran on reserve ${reserve.engine} ${reserve.model} ${reserve.effort}]`);
    expect(text).toContain(`session_id: ${reserve.engine}:worker-session`);
    expect(readUsage()).toMatchObject([
      { engine: primary.engine, model: "custom-primary", effort: "custom-effort", outcome: "quota", matchedRequest: true },
      { engine: reserve.engine, model: reserve.model, effort: reserve.effort, outcome: "success", matchedRequest: false },
    ]);
    expect(readUsage()).toHaveLength(2);
    expect(engineHealthReport(readUsage(), Date.now())[primary.engine].cause).toBe("quota");
  });

  it.each(["rate_limited", "other", "explicit"])("delegate does not retry %s and logs its single attempt", async (kind) => {
    const err = kind === "other" ? new Error("auth expired") : new QuotaError(kind === "rate_limited" ? "rate_limited" : "quota_exhausted", "codex", "primary failure");
    run.mockRejectedValueOnce(err);
    await expect(call("delegate", { prompt: "task", level: "low", ...(kind === "explicit" ? { engine: "codex" } : {}) })).rejects.toBe(err);
    expect(run.mock.calls).toHaveLength(1);
    expect(readUsage()).toHaveLength(1);
  });

  it("delegate logs both quota failures and preserves the reserve error", async () => {
    const reserveError = new QuotaError("quota_exhausted", "claude", "reserve quota");
    run.mockRejectedValueOnce(new QuotaError("quota_exhausted", "codex", "primary quota"))
      .mockRejectedValueOnce(reserveError);
    await expect(call("delegate", { prompt: "task", level: "low" })).rejects.toBe(reserveError);
    expect(reserveError.message).toMatch(/codex quota exhausted.*reserve claude failed/);
    expect(run.mock.calls).toHaveLength(2);
    expect(readUsage()).toMatchObject([
      { engine: "codex", outcome: "quota", matchedRequest: true },
      { engine: "claude", outcome: "quota", matchedRequest: false },
    ]);
    expect(readUsage()).toHaveLength(2);
  });

  it("fan_out retries each worker independently and logs four attempts without duplicates", async () => {
    run.mockImplementation(async (opts: RunOpts) => {
      if (opts.engine === "codex") throw new QuotaError("quota_exhausted", "codex", "primary quota");
      return { text: "worker output", engine: opts.engine, sessionId: "worker-session" };
    });
    try {
      const text = await call("fan_out", { prompt: "same task", levels: ["low", "middle"], mode: "race", cwd: dir });
      await vi.waitFor(() => expect(readUsage().filter((entry) => entry.outcome)).toHaveLength(4));
      expect(run.mock.calls).toHaveLength(4);
      const attempts = readUsage().filter((entry) => entry.outcome);
      expect(attempts.filter((entry) => entry.engine === "codex" && entry.outcome === "quota" && entry.matchedRequest)).toHaveLength(2);
      expect(attempts.filter((entry) => entry.engine === "claude" && entry.outcome === "success" && entry.matchedRequest === false)).toHaveLength(2);
      expect(attempts.filter((entry) => entry.engine === "claude").map((entry) => entry.effort).sort()).toEqual(["max", "xhigh"]);
      expect(text).toContain("quota exhausted — reran on reserve claude claude-haiku-5-5");
      expect(run.mock.calls.every(([opts]) => opts.prompt === "same task" && opts.cwd === dir && opts.tool === "fan_out")).toBe(true);
    } finally {
      run.mockImplementation(async (opts: RunOpts) => ({ text: "worker output", engine: opts.engine, sessionId: "worker-session" }));
    }
  });
});

describe("codex environment fallback usage through registered handlers", () => {
  const fallbackFrom = { engine: "codex" as const, cause: "read-only file system", stderr: "Read-only file system", durationMs: 7 };
  beforeEach(() => { writeFileSync(log, ""); });

  it.each([
    ["delegate", { prompt: "task", level: "low" }],
    ["web_lookup", { query: "documentation" }],
    ["follow_up", { session_id: "codex:old", question: "continue" }],
  ])("%s logs codex failure once without stealing the fallback session rating", async (name, args) => {
    run.mockResolvedValueOnce({ text: "ok", engine: "claude", sessionId: "retry-session", fallbackFrom } as any);
    expect(await call(name as string, args as any)).toContain("session_id: claude:retry-session");
    const entries = readUsage();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ engine: "codex", outcome: "failure", outChars: 0, error: "Read-only file system", durationMs: 7 });
    expect(entries[0]).not.toHaveProperty("sessionId");
    expect(entries[1]).toMatchObject({ engine: "claude", outcome: "success", sessionId: "claude:retry-session" });
    expect(entries[1]).not.toHaveProperty("model");
    expect(engineHealthReport(entries, Date.now()).codex).toMatchObject({ score: 0, cause: "failures" });
    expect(await call("bridge_stats")).toContain("codex | 0.00 | failures |");
    const { aggregate, ratingStats } = await import("../src/usage.js");
    expect(aggregate(entries)[name as string].calls).toBe(2);
    expect(ratingStats([...entries, { ts: Date.now(), tool: "rate", outChars: 0, ratedSessionId: "claude:retry-session", score: 5 }])[`claude|-|-|${name}`].calls).toBe(1);
  });

  it("logs both failures against their actual engines when the retry also fails", async () => {
    const error = Object.assign(new Error("claude agent exited 1: retry failed"), { engine: "claude", fallbackFrom });
    run.mockRejectedValueOnce(error);
    await expect(call("delegate", { prompt: "task", level: "low" })).rejects.toBe(error);
    expect(run.mock.calls).toHaveLength(1);
    expect(readUsage()).toMatchObject([
      { engine: "codex", outcome: "failure", error: "Read-only file system" },
      { engine: "claude", outcome: "failure" },
    ]);
    expect(readUsage()).toHaveLength(2);
  });

  it("fan_out logs each codex attempt once even when its result is formatted again", async () => {
    run.mockResolvedValueOnce({ text: "ok", engine: "grok", sessionId: "retry-session", fallbackFrom } as any);
    await call("fan_out", { prompt: "task", levels: ["low", "middle"], mode: "race" });
    await vi.waitFor(() => expect(readUsage().filter((e) => e.outcome)).toHaveLength(3));
    expect(run.mock.calls).toHaveLength(2);
    expect(readUsage().filter((e) => e.engine === "codex" && e.outcome === "failure")).toHaveLength(1);
  });
});
