import { describe, it, expect } from "vitest";
import { parseCodexJsonl, parseCliJson, parseOpencodeJsonl, parseOutput } from "../src/cli.js";
import {
  aggregateWorkerUsage, renderWorkerUsage, buildUsageEntry, buildFormatRun, type UsageEntry,
} from "../src/usage.js";

describe("parseCodexJsonl: uso de tokens", () => {
  it("lê o evento turn.completed (input inclui cached, como no codex)", () => {
    const raw = [
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50, reasoning_output_tokens: 20 } }),
    ].join("\n");
    expect(parseCodexJsonl(raw).usage).toEqual({
      inputTokens: 1000, cachedInputTokens: 800, outputTokens: 50, reasoningTokens: 20, costUsd: null,
    });
  });

  it("soma vários turnos e devolve undefined sem evento de uso ou com campos inválidos", () => {
    const turn = (i: number) => JSON.stringify({ type: "turn.completed", usage: { input_tokens: i, cached_input_tokens: 0, output_tokens: 1 } });
    expect(parseCodexJsonl([turn(10), turn(5)].join("\n")).usage?.inputTokens).toBe(15);
    expect(parseCodexJsonl("só ruído").usage).toBeUndefined();
    expect(parseCodexJsonl(JSON.stringify({ type: "turn.completed", usage: "x" })).usage).toBeUndefined();
    expect(parseCodexJsonl(JSON.stringify({ type: "turn.completed", usage: { output_tokens: "7" } })).usage).toBeUndefined();
  });
});

describe("parseCliJson: uso de tokens (claude -p)", () => {
  it("soma input + cache_creation + cache_read e guarda o custo", () => {
    const raw = JSON.stringify({
      result: "ok", session_id: "s1", total_cost_usd: 0.0123,
      usage: { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000, output_tokens: 40 },
    });
    const res = parseCliJson(raw);
    expect(res.text).toBe("ok");
    expect(res.usage).toEqual({
      inputTokens: 3210, cachedInputTokens: 3000, outputTokens: 40, costUsd: 0.0123,
    });
  });

  it("não inventa: sem usage, texto cru ou usage malformado ficam sem uso", () => {
    expect(parseCliJson(JSON.stringify({ result: "ok" })).usage).toBeUndefined();
    expect(parseCliJson("texto cru").usage).toBeUndefined();
    expect(parseCliJson(JSON.stringify({ result: "ok", usage: [1, 2] })).usage).toBeUndefined();
    // custo sozinho ainda vale
    expect(parseCliJson(JSON.stringify({ result: "ok", total_cost_usd: 0.5 })).usage)
      .toEqual({ inputTokens: null, cachedInputTokens: null, outputTokens: null, costUsd: 0.5 });
  });
});

describe("parseOpencodeJsonl: uso de tokens", () => {
  it("soma step_finish.part.tokens e cost", () => {
    const step = (i: number) => JSON.stringify({ type: "step_finish", part: { type: "step-finish", cost: 0.001, tokens: { input: i, output: 5, reasoning: 0, cache: { read: 2, write: 1 } } } });
    const raw = [JSON.stringify({ type: "text", part: { type: "text", text: "oi" } }), step(10), step(20)].join("\n");
    expect(parseOpencodeJsonl(raw).usage).toEqual({
      inputTokens: 30 + 2 * 2 + 1 * 2, cachedInputTokens: 4, outputTokens: 10, reasoningTokens: 0, costUsd: 0.002,
    });
  });

  it("sem step_finish fica sem uso", () => {
    expect(parseOpencodeJsonl(JSON.stringify({ type: "text", part: { text: "oi" } })).usage).toBeUndefined();
  });
});

describe("parseOutput", () => {
  it("kimi e muse não confirmam uso: ficam undefined, nunca zero", () => {
    expect(parseOutput("kimi", JSON.stringify({ result: "x", usage: { input_tokens: 1 } })).usage).toBeUndefined();
    expect(parseOutput("muse", "{}").usage).toBeUndefined();
  });
});

const entry = (over: Partial<UsageEntry>): UsageEntry => ({ ts: 1, tool: "explore", outChars: 10, ...over });

describe("buildUsageEntry carrega workerUsage", () => {
  it("grava o campo quando presente e omite quando ausente", () => {
    const wu = { inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, costUsd: null };
    expect(buildUsageEntry("explore", 5, undefined, { engine: "codex", workerUsage: wu }).workerUsage).toEqual(wu);
    expect("workerUsage" in buildUsageEntry("explore", 5, undefined, { engine: "codex" })).toBe(false);
  });
});

describe("aggregateWorkerUsage / renderWorkerUsage", () => {
  const wu = (i: number, c: number, o: number, cost: number | null = null) => ({ inputTokens: i, cachedInputTokens: c, outputTokens: o, costUsd: cost });

  it("agrupa por tool|engine|nível e conta chamadas sem uso separadas", () => {
    const stats = aggregateWorkerUsage([
      entry({ engine: "codex", workerUsage: wu(100, 80, 10) }),
      entry({ engine: "codex", workerUsage: wu(50, 0, 5, 0.01) }),
      entry({ engine: "codex" }), // log antigo, sem o campo
      entry({ tool: "delegate", engine: "claude", requestedLevel: "high", workerUsage: wu(7, 3, 2, 0.5) }),
      entry({ tool: "rate", outChars: 0 }),
    ]);
    const explore = stats["explore|codex|-"];
    expect(explore).toMatchObject({ calls: 3, measured: 2, inputTokens: 150, cachedInputTokens: 80, outputTokens: 15, costUsd: 0.01 });
    expect(stats["delegate|claude|high"]).toMatchObject({ calls: 1, measured: 1, costUsd: 0.5 });
    expect(Object.keys(stats)).toHaveLength(2);
  });

  it("renderiza tabela e devolve string vazia sem nenhuma medição", () => {
    expect(renderWorkerUsage(aggregateWorkerUsage([entry({ engine: "codex" })]))).toBe("");
    const text = renderWorkerUsage(aggregateWorkerUsage([entry({ engine: "codex", workerUsage: wu(100, 80, 10) })]));
    expect(text).toContain("Worker tokens");
    expect(text).toContain("explore|codex|-");
  });
});

describe("buildFormatRun: uso do worker no log do format()", () => {
  const usage = { inputTokens: 100, cachedInputTokens: 80, outputTokens: 10, costUsd: null };

  it("fan_out: uso já gravado pelo worker não é gravado de novo no format() extra (sem dupla contagem)", () => {
    const worker = buildUsageEntry("fan_out", 0, undefined, { engine: "codex", outcome: "success", workerUsage: usage });
    const extra = buildUsageEntry("fan_out", 120, undefined, buildFormatRun({ engine: "codex", usage }, { engine: "codex", outcome: "success" }, "codex:s1", true));
    expect(extra.resultReceipt).toBe(true);
    expect(extra.workerUsage).toBeUndefined();
    const stats = aggregateWorkerUsage([worker, extra]);
    expect(Object.values(stats).reduce((n, s) => n + s.inputTokens, 0)).toBe(100);
  });

  it("chamada comum (delegate/explore) continua gravando o uso uma vez", () => {
    const run = buildFormatRun({ engine: "codex", usage }, { engine: "codex", outcome: "success" }, undefined);
    expect(run?.workerUsage).toEqual(usage);
  });

  it("follow_up sem run: engine vem de res.engine e o uso entra nos agregadores", () => {
    const entry = buildUsageEntry("follow_up", 50, undefined, buildFormatRun({ engine: "claude", usage }, undefined, "claude:s2"));
    expect(entry.engine).toBe("claude");
    expect(entry.sessionId).toBe("claude:s2");
    expect(aggregateWorkerUsage([entry])["follow_up|claude|-"]).toMatchObject({ calls: 1, measured: 1, inputTokens: 100 });
  });

  it("follow_up sem engine nem uso devolve só o handle, sem inventar campos", () => {
    expect(buildFormatRun({}, undefined, undefined)).toBeUndefined();
    expect(buildFormatRun({}, undefined, "x:1")).toEqual({ sessionId: "x:1" });
  });
});
