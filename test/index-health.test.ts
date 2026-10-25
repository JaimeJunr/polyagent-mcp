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
