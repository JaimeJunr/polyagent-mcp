import { describe, expect, it } from "vitest";
import { askJev, type AskJevParams, type JevFetchInit, type JevHttpResponse } from "../src/jev.js";
import {
  askFanOutAgreement, CLARITY_CRITERIA, clarityDecision, delegateShadowRequest, fanOutAgreementRequest,
  fanOutAgreementText, footerSession, resolveFanOutGate, runFanOutConsensusGate, shadowDecision, withDelegateShadow,
  delegateVerifyRequest, verifyDecision, withDelegateVerify,
} from "../src/jevDecisions.js";
import type { DecisionRecord } from "../src/usage.js";

const noul = (value: number) => ({ type: "noul" as const, noul: value });
const toolResult = (text: string) => ({ content: [{ type: "text" as const, text }] });

class FakeJevFetch {
  readonly calls: { url: string; init: JevFetchInit }[] = [];

  constructor(private readonly response: JevHttpResponse | Promise<JevHttpResponse>) {}

  readonly fetch = async (url: string, init: JevFetchInit): Promise<JevHttpResponse> => {
    this.calls.push({ url, init });
    return this.response;
  };
}

const response = (answers: Record<string, unknown>, status = 200): JevHttpResponse => ({
  status,
  text: async () => "unavailable",
  json: async () => ({ answers, usage: { cost: 0.004 } }),
});

const askWith = (fake: FakeJevFetch) => (params: AskJevParams) =>
  askJev(params, { fetch: fake.fetch, key: "test-key" });

describe("fan_out Jev agreement", () => {
  it("keeps distinct conclusions at the end of long worker outputs", () => {
    const sharedHead = "s".repeat(8_500);
    const request = fanOutAgreementRequest([
      `${sharedHead}${"a".repeat(480)} FINAL: approve`,
      `${sharedHead}${"b".repeat(480)} FINAL: reject`,
    ]);
    expect(request.state).toContain("FINAL: approve");
    expect(request.state).toContain("FINAL: reject");
  });

  it("keeps each clipped worker within its budget and marks omitted text", () => {
    const outputs = ["a".repeat(9_000), "b".repeat(9_000), "c".repeat(9_000)];
    for (const limits of [
      { perWorkerChars: 6_000, totalChars: 12_000 },
      { perWorkerChars: 3_000, totalChars: 24_000 },
    ]) {
      const state = fanOutAgreementRequest(outputs, limits).state as string;
      const headers = outputs.map((_, i) => `Worker ${i + 1}:\n`);
      const budget = Math.min(limits.perWorkerChars,
        Math.floor((limits.totalChars - headers.join("").length - 2 * (outputs.length - 1)) / outputs.length));
      const workers = state.split("\n\n");
      expect(state.length).toBeLessThanOrEqual(limits.totalChars);
      expect(workers).toHaveLength(outputs.length);
      for (const [i, worker] of workers.entries()) {
        expect(worker.startsWith(headers[i])).toBe(true);
        const clipped = worker.slice(headers[i].length);
        expect(clipped.length).toBeLessThanOrEqual(budget);
        const marker = clipped.match(/\n\[\.\.\. (\d+) chars omitted \.\.\.\]\n/);
        expect(marker).not.toBeNull();
        expect(Number(marker![1])).toBe(outputs[i].length - clipped.length + marker![0].length);
      }
    }
    expect(fanOutAgreementRequest(["abcdef", "uvwxyz"], { perWorkerChars: 2, totalChars: 100 }).state)
      .toBe("Worker 1:\n…f\n\nWorker 2:\n…z");
  });

  it("passes short worker outputs unchanged without an elision marker", () => {
    const outputs = ["first conclusion", "second conclusion"];
    const state = fanOutAgreementRequest(outputs).state;
    expect(state).toBe("Worker 1:\nfirst conclusion\n\nWorker 2:\nsecond conclusion");
    expect(state).not.toContain("chars omitted");
  });

  it("builds a noul question with every output and bounded context", () => {
    const request = fanOutAgreementRequest(["a".repeat(10_000), "b".repeat(10_000), "c".repeat(10_000)], {
      perWorkerChars: 6_000,
      totalChars: 12_000,
    });
    expect(request.questions.agreement).toMatchObject({ type: "noul" });
    expect(request.state).toContain("Worker 1:");
    expect(request.state).toContain("Worker 2:");
    expect(request.state).toContain("Worker 3:");
    expect((request.state as string).length).toBeLessThanOrEqual(12_000);
    expect((request.state as string).match(/a/g)?.length).toBeLessThanOrEqual(6_000);
  });

  it("rejects fewer than two outputs instead of asking Jev for fake consensus", () => {
    expect(() => fanOutAgreementRequest(["only one"])).toThrow(/at least two/i);
  });

  it("redacts credential-shaped worker output before sending it to OpenRouter", () => {
    const secret = `sk-${"A".repeat(30)}`;
    const request = fanOutAgreementRequest([`answer ${secret}`, "same answer"]);
    expect(request.state).not.toContain(secret);
    expect(request.state).toContain("[REDACTED]");
  });

  it("accepts a high probability and records its cost", () => {
    const verdict = resolveFanOutGate({ answers: { agreement: { type: "noul", noul: 0.93 } }, usage: { cost: 0.004 } }, 0.85);
    expect(verdict).toMatchObject({ accepted: true, fallback: false, choice: "agree", confidence: 0.93, probability: 0.93, cost: 0.004 });
  });

  it("returns the first worker text with the agreement note and all worker session handles", () => {
    const text = fanOutAgreementText("first answer", "- codex (level low): codex:a\n- claude (level high): claude:b", 0.93);
    expect(text).toContain("[jev: workers agree (p=0.93), arbiter skipped]");
    expect(text).toContain("first answer");
    expect(text).toContain("Worker sessions (pass to follow_up):\n- codex (level low): codex:a\n- claude (level high): claude:b");
  });

  it("falls back on low probability, an error, or an invalid answer", () => {
    expect(resolveFanOutGate({ answers: { agreement: { type: "noul", noul: 0.8 } } }, 0.85))
      .toMatchObject({ accepted: false, fallback: true, choice: "agree", confidence: 0.8 });
    expect(resolveFanOutGate(new Error("missing key"), 0.85))
      .toMatchObject({ accepted: false, fallback: true, choice: null, confidence: null });
    expect(resolveFanOutGate({ answers: { agreement: { type: "noul", noul: NaN } } }, 0.85))
      .toMatchObject({ accepted: false, fallback: true, choice: null, confidence: null });
    expect(resolveFanOutGate({} as never, 0.85))
      .toMatchObject({ accepted: false, fallback: true, choice: null, confidence: null });
  });

  it("uses askJev with an injected fetch and logs an accepted gate", async () => {
    const fake = new FakeJevFetch(response({ agreement: { type: "noul", noul: 0.93 } }));
    const decisions: DecisionRecord[] = [];
    const verdict = await askFanOutAgreement(["same answer", "same recommendation"], 0.85, {
      ask: askWith(fake), log: (decision) => decisions.push(decision),
    });
    expect(verdict.accepted).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(JSON.parse(fake.calls[0].init.body).questions.agreement.type).toBe("noul");
    expect(decisions).toMatchObject([{ name: "fan_out_agreement", candidates: ["agree", "disagree"], choice: "agree", accepted: true, fallback: false, cost: 0.004 }]);
  });

  it("logs failure and returns fallback when askJev fails", async () => {
    const fake = new FakeJevFetch(response({}, 503));
    const decisions: DecisionRecord[] = [];
    const verdict = await askFanOutAgreement(["one", "two"], 0.85, {
      ask: askWith(fake), log: (decision) => decisions.push(decision),
    });
    expect(verdict.fallback).toBe(true);
    expect(decisions).toMatchObject([{ name: "fan_out_agreement", choice: null, confidence: null, accepted: false, fallback: true }]);
  });

  it("returns the first worker and skips the arbiter on accepted agreement", async () => {
    const fake = new FakeJevFetch(response({ agreement: { type: "noul", noul: 0.93 } }));
    const decisions: DecisionRecord[] = [];
    let arbiterCalls = 0;
    const result = await runFanOutConsensusGate(
      ["same", "same"], true, 0.85,
      (verdict) => `first worker: ${verdict.probability}`,
      async () => { arbiterCalls++; return "arbiter"; },
      { ask: askWith(fake), log: (decision) => decisions.push(decision) },
    );
    expect(result).toBe("first worker: 0.93");
    expect(arbiterCalls).toBe(0);
    expect(decisions).toHaveLength(1);
  });

  it("runs the arbiter on Jev failure and skips Jev when disabled or only one worker succeeded", async () => {
    const fake = new FakeJevFetch(response({}, 503));
    const decisions: DecisionRecord[] = [];
    let arbiterCalls = 0;
    const arbiter = async () => { arbiterCalls++; return "arbiter"; };
    const deps = { ask: askWith(fake), log: (decision: DecisionRecord) => decisions.push(decision) };
    expect(await runFanOutConsensusGate(["one", "two"], true, 0.85, () => "worker", arbiter, deps)).toBe("arbiter");
    expect(await runFanOutConsensusGate(["one", "two"], false, 0.85, () => "worker", arbiter, deps)).toBe("arbiter");
    expect(await runFanOutConsensusGate(["one"], true, 0.85, () => "worker", arbiter, deps)).toBe("arbiter");
    expect(arbiterCalls).toBe(3);
    expect(fake.calls).toHaveLength(1);
    expect(decisions).toHaveLength(1);
  });

  it("falls back to the arbiter when Jev remains pending", async () => {
    const fake = new FakeJevFetch(new Promise<JevHttpResponse>(() => {}));
    const decisions: DecisionRecord[] = [];
    const result = await runFanOutConsensusGate(
      ["one", "two"], true, 0.85, () => "worker", async () => "arbiter",
      { ask: askWith(fake), log: (decision) => decisions.push(decision), timeoutMs: 5 },
    );
    expect(result).toBe("arbiter");
    expect(decisions).toMatchObject([{ choice: null, accepted: false, fallback: true }]);
  });
});

describe("delegate Jev shadow", () => {
  it("offers three named levels and truncates the task prompt", () => {
    const request = delegateShadowRequest("x".repeat(20_000));
    expect(request.questions.level).toMatchObject({ type: "choice" });
    expect(Object.keys(request.questions.level.criteria ?? {})).toEqual(["low", "middle", "high"]);
    expect(request.questions.level.criteria?.middle).toContain("GPT-6.1 Sol medium");
    expect(request.questions.level.criteria?.high).toContain("Claude Opus 5.5 high");
    expect((request.state as string).length).toBeLessThanOrEqual(12_000);
  });

  it("redacts credential-shaped task text before shadow classification", () => {
    const secret = `sk-${"A".repeat(30)}`;
    const request = delegateShadowRequest(`fix ${secret}`);
    expect(request.state).not.toContain(secret);
    expect(request.state).toContain("[REDACTED]");
  });

  it("records a valid choice without changing the requested level", () => {
    const decision = shadowDecision({
      answers: { level: { type: "choice", choice: "middle", probabilities: { middle: 0.8 }, confidence: 0.8 } },
      usage: { cost: 0.002 },
    }, "high", 42);
    expect(decision).toMatchObject({ name: "delegate_level_shadow", candidates: ["low", "middle", "high"], choice: "middle", confidence: 0.8, actual: "high", accepted: false, fallback: false, latencyMs: 42, cost: 0.002 });
  });

  it("records null on failure or an invalid choice", () => {
    expect(shadowDecision(new Error("timeout"), "middle", 5000)).toMatchObject({ choice: null, confidence: null, actual: "middle", accepted: false, fallback: false });
    expect(shadowDecision({ answers: { level: { type: "choice", choice: "9", probabilities: {}, confidence: 0.5 } } }, "middle", 2).choice).toBeNull();
    expect(shadowDecision({} as never, "middle", 2).choice).toBeNull();
  });

  it("starts the worker before askJev, then logs the shadow result", async () => {
    const events: string[] = [];
    const fake = new FakeJevFetch(response({ level: { type: "choice", choice: "middle", probabilities: { middle: 0.8 }, confidence: 0.8 },
      names_target: noul(0.9), defines_done: noul(0.9), single_task: noul(0.9),
    }));
    const decisions: DecisionRecord[] = [];
    const result = await withDelegateShadow(
      async () => { events.push("worker"); return "worker result"; },
      "task", "high",
      { ask: async (params) => { events.push("jev"); return askWith(fake)(params); }, log: (decision) => decisions.push(decision) },
    );
    expect(events).toEqual(["worker", "jev"]);
    expect(result).toBe("worker result");
    expect(decisions).toMatchObject([{ choice: "middle", actual: "high", accepted: false, fallback: false }, { name: "delegate_prompt_clarity_shadow", choice: "clear" }]);
  });

  it("preserves a worker error when Jev fails", async () => {
    const fake = new FakeJevFetch(response({}, 503));
    const decisions: DecisionRecord[] = [];
    const workerError = new Error("worker failed");
    await expect(withDelegateShadow(
      async () => { throw workerError; }, "task", "middle",
      { ask: askWith(fake), log: (decision) => decisions.push(decision) },
    )).rejects.toBe(workerError);
    expect(decisions).toMatchObject([{ choice: null, actual: "middle" }, { name: "delegate_prompt_clarity_shadow", choice: null }]);
  });

  it("asks the three clarity criteria in the same request as the level", () => {
    const request = delegateShadowRequest("task");
    expect(Object.keys(request.questions)).toEqual(["level", ...CLARITY_CRITERIA]);
    for (const key of CLARITY_CRITERIA) expect(request.questions[key]).toMatchObject({ type: "noul" });
  });

  it("marks a prompt clear only when every criterion is at least 0.5", () => {
    const clear = clarityDecision({
      answers: { names_target: noul(0.9), defines_done: noul(0.5), single_task: noul(0.7) },
      usage: { cost: 0.001 },
    }, 30, "codex:abc");
    expect(clear).toMatchObject({
      name: "delegate_prompt_clarity_shadow", candidates: ["clear", "unclear"], choice: "clear", confidence: 0.5,
      accepted: false, fallback: false, latencyMs: 30, cost: 0.001, session: "codex:abc",
      probabilities: { names_target: 0.9, defines_done: 0.5, single_task: 0.7 },
    });
    const unclear = clarityDecision({
      answers: { names_target: noul(0.2), defines_done: noul(0.9), single_task: noul(0.8) },
    }, 30);
    expect(unclear).toMatchObject({ choice: "unclear", confidence: 0.8, probabilities: { names_target: 0.2 } });
  });

  it("records null clarity on failure or a missing criterion", () => {
    expect(clarityDecision(new Error("timeout"), 5000)).toMatchObject({ choice: null, confidence: null, cost: null });
    expect(clarityDecision({ answers: { names_target: noul(0.9), defines_done: noul(0.9) } }, 2).choice).toBeNull();
    expect(clarityDecision({ answers: { names_target: noul(1.4), defines_done: noul(0.9), single_task: noul(0.9) } }, 2).choice).toBeNull();
  });

  it("logs level and clarity from one Jev call, tagged with the worker session", async () => {
    const fake = new FakeJevFetch(response({
      level: { type: "choice", choice: "middle", probabilities: { middle: 0.8 }, confidence: 0.8 },
      names_target: noul(0.9), defines_done: noul(0.3), single_task: noul(0.9),
    }));
    const decisions: DecisionRecord[] = [];
    await withDelegateShadow(
      async () => toolResult("done\n\n---\nsession_id: codex:t-1 (pass to follow_up to continue; grade it with rate(session_id, score 1-5))"),
      "task", "middle",
      { ask: askWith(fake), log: (decision) => decisions.push(decision), sessionOf: footerSession },
    );
    expect(fake.calls).toHaveLength(1);
    expect(decisions).toMatchObject([
      { name: "delegate_level_shadow", choice: "middle", session: "codex:t-1" },
      { name: "delegate_prompt_clarity_shadow", choice: "unclear", session: "codex:t-1" },
    ]);
  });

  it("reads the session handle from the tool footer, or nothing", () => {
    expect(footerSession(toolResult("x\n---\nsession_id: claude:9f (pass to follow_up)"))).toBe("claude:9f");
    expect(footerSession(toolResult("no footer"))).toBeUndefined();
    expect(footerSession("plain")).toBeUndefined();
    expect(footerSession(null)).toBeUndefined();
  });

  it("caps a pending Jev request after worker completion", async () => {
    const fake = new FakeJevFetch(new Promise<JevHttpResponse>(() => {}));
    const decisions: DecisionRecord[] = [];
    const result = await withDelegateShadow(
      async () => "worker result", "task", "low",
      { ask: askWith(fake), log: (decision) => decisions.push(decision), timeoutMs: 5 },
    );
    expect(result).toBe("worker result");
    expect(decisions).toMatchObject([{ choice: null, actual: "low", accepted: false, fallback: false }, { name: "delegate_prompt_clarity_shadow", choice: null }]);
  });
});

describe("Jev rejects old numeric choices", () => {
  it.each(["1", "3", "5", "medium", "toString"])("rejects %s", (choice) => {
    expect(shadowDecision({ answers: { level: { type: "choice", choice, probabilities: {}, confidence: 0.8 } } }, "high", 1).choice).toBeNull();
  });
});

describe("delegate result verifier (shadow)", () => {
  const answers = (claims: number, denominator: number, evidence: number, addresses: number) => ({
    claims_success: noul(claims), reports_denominator: noul(denominator),
    evidence_shown: noul(evidence), addresses_task: noul(addresses),
  });
  const result = (a: Record<string, unknown>) => ({ answers: a, usage: { cost: 0 } }) as never;

  it("sends task and result, keeps the verdict at the end of a long result and scrubs secrets", () => {
    const request = delegateVerifyRequest(
      "Rename foo in src/a.ts",
      `${"x".repeat(30_000)} key sk-abcdefABCDEF0123456789xyz FINAL: 12 tests passed`,
    );
    const state = String(request.state);
    expect(state).toContain("Rename foo in src/a.ts");
    expect(state).toContain("FINAL: 12 tests passed");
    expect(state).not.toContain("sk-abcdefABCDEF0123456789xyz");
    expect(state.length).toBeLessThan(16_000);
    expect(Object.keys(request.questions).sort())
      .toEqual(["addresses_task", "claims_success", "evidence_shown", "reports_denominator"]);
  });

  it("labels a success claim with evidence as supported", () => {
    const record = verifyDecision(result(answers(0.95, 0.9, 0.9, 0.8)), 400, "codex:1");
    expect(record).toMatchObject({
      name: "delegate_result_verify_shadow", choice: "supported", confidence: 0.8,
      accepted: false, fallback: false, latencyMs: 400, cost: 0, session: "codex:1",
    });
    expect(record.probabilities).toEqual({
      claims_success: 0.95, reports_denominator: 0.9, evidence_shown: 0.9, addresses_task: 0.8,
    });
  });

  it("labels a success claim without evidence as unsupported (vacuous green)", () => {
    const record = verifyDecision(result(answers(0.9, 0.1, 0.2, 0.9)), 400);
    expect(record.choice).toBe("unsupported");
    expect(record.confidence).toBeCloseTo(0.8);
  });

  it("labels a result that does not claim success as no_claim", () => {
    expect(verifyDecision(result(answers(0.1, 0.5, 0.5, 0.5)), 1).choice).toBe("no_claim");
  });

  it("records null choice on Jev error or a missing answer", () => {
    expect(verifyDecision(new Error("down"), 5)).toMatchObject({ choice: null, confidence: null, cost: null });
    expect(verifyDecision(result({ claims_success: noul(0.9) }), 5).choice).toBeNull();
  });

  it("returns the worker result without waiting for the verifier, then logs with the session", async () => {
    const logs: DecisionRecord[] = [];
    const pending: Promise<unknown>[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const value = toolResult("done, 3 files changed\n---\nsession_id: codex:abc");
    const returned = await withDelegateVerify(async () => value, "task", {
      ask: async () => { await gate; return result(answers(0.9, 0.9, 0.9, 0.9)); },
      log: (decision) => logs.push(decision),
      sessionOf: footerSession,
      background: (task) => pending.push(task),
    });
    expect(returned).toBe(value);
    expect(logs).toEqual([]);
    release();
    await Promise.all(pending);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ choice: "supported", session: "codex:abc" });
  });

  it("skips the verifier when the worker fails or returns an error result", async () => {
    let asked = 0;
    const deps = { ask: async () => { asked++; return result({}); }, log: () => {}, background: () => {} };
    await expect(withDelegateVerify(async () => { throw new Error("boom"); }, "t", deps)).rejects.toThrow("boom");
    await withDelegateVerify(async () => ({ ...toolResult("failed"), isError: true }), "t", deps);
    expect(asked).toBe(0);
  });

  it("never throws into the tool when the verifier or the log fails", async () => {
    const pending: Promise<unknown>[] = [];
    const value = toolResult("ok");
    await expect(withDelegateVerify(async () => value, "t", {
      ask: async () => { throw new Error("jev down"); },
      log: () => { throw new Error("log down"); },
      background: (task) => pending.push(task),
    })).resolves.toBe(value);
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });
});
