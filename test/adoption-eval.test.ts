import { describe, expect, it } from "vitest";
// @ts-expect-error — script .mjs sem tipos
import { parseStream } from "../bench/adoption-eval.mjs";

function toolUse(name: string, input: Record<string, unknown>): string {
  return JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
}

describe("parseStream — como o host passou o agent ao worker", () => {
  it("registra name, inline e none para delegate e fast_delegate", () => {
    const stream = [
      toolUse("mcp__polyagent__delegate", { prompt: "x", level: 1, agent: "ivt-core:code-reviewer" }),
      toolUse("mcp__polyagent__fast_delegate", { prompt: "x", agent: { prompt: "skill body" } }),
      toolUse("mcp__polyagent__delegate", { prompt: "x", level: 1 }),
    ].join("\n");
    expect(parseStream(stream).agentArgs).toEqual(["name", "inline", "none"]);
  });

  it("ignora o agent de tools que não são delegate/fast_delegate", () => {
    const stream = [
      toolUse("Agent", { subagent_type: "ivt-core:code-reviewer", prompt: "x" }),
      toolUse("mcp__polyagent__explore", { question: "x" }),
    ].join("\n");
    expect(parseStream(stream).agentArgs).toEqual([]);
  });
});
