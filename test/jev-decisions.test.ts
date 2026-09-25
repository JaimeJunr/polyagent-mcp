import { describe, expect, it } from "vitest";
import { askJev, type AskJevParams, type JevFetchInit, type JevHttpResponse } from "../src/jev.js";
import {
  askFanOutAgreement, delegateShadowRequest, fanOutAgreementRequest, fanOutAgreementText, resolveFanOutGate,
  runFanOutConsensusGate, shadowDecision, withDelegateShadow,
} from "../src/jevDecisions.js";
import type { DecisionRecord } from "../src/usage.js";

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
    const text = fanOutAgreementText("first answer", "- codex (level 1): codex:a\n- claude (level 5): claude:b", 0.93);
    expect(text).toContain("[jev: workers agree (p=0.93), arbiter skipped]");
    expect(text).toContain("first answer");
    expect(text).toContain("Worker sessions (pass to follow_up):\n- codex (level 1): codex:a\n- claude (level 5): claude:b");
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
  it("offers five levels and truncates the task prompt", () => {
    const request = delegateShadowRequest("x".repeat(20_000));
    expect(request.questions.level).toMatchObject({ type: "choice" });
    expect(Object.keys(request.questions.level.criteria ?? {})).toEqual(["1", "2", "3", "4", "5"]);
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
      answers: { level: { type: "choice", choice: "2", probabilities: { "2": 0.8 }, confidence: 0.8 } },
      usage: { cost: 0.002 },
    }, 4, 42);
    expect(decision).toMatchObject({ name: "delegate_level_shadow", candidates: ["1", "2", "3", "4", "5"], choice: "2", confidence: 0.8, actual: "4", accepted: false, fallback: false, latencyMs: 42, cost: 0.002 });
  });

  it("records null on failure or an invalid choice", () => {
    expect(shadowDecision(new Error("timeout"), 3, 5000)).toMatchObject({ choice: null, confidence: null, actual: "3", accepted: false, fallback: false });
    expect(shadowDecision({ answers: { level: { type: "choice", choice: "9", probabilities: {}, confidence: 0.5 } } }, 3, 2).choice).toBeNull();
    expect(shadowDecision({} as never, 3, 2).choice).toBeNull();
  });

  it("starts the worker before askJev, then logs the shadow result", async () => {
    const events: string[] = [];
    const fake = new FakeJevFetch(response({ level: { type: "choice", choice: "2", probabilities: { "2": 0.8 }, confidence: 0.8 } }));
    const decisions: DecisionRecord[] = [];
    const result = await withDelegateShadow(
      async () => { events.push("worker"); return "worker result"; },
      "task", 4,
      { ask: async (params) => { events.push("jev"); return askWith(fake)(params); }, log: (decision) => decisions.push(decision) },
    );
    expect(events).toEqual(["worker", "jev"]);
    expect(result).toBe("worker result");
    expect(decisions).toMatchObject([{ choice: "2", actual: "4", accepted: false, fallback: false }]);
  });

  it("preserves a worker error when Jev fails", async () => {
    const fake = new FakeJevFetch(response({}, 503));
    const decisions: DecisionRecord[] = [];
    const workerError = new Error("worker failed");
    await expect(withDelegateShadow(
      async () => { throw workerError; }, "task", 3,
      { ask: askWith(fake), log: (decision) => decisions.push(decision) },
    )).rejects.toBe(workerError);
    expect(decisions).toMatchObject([{ choice: null, actual: "3" }]);
  });

  it("caps a pending Jev request after worker completion", async () => {
    const fake = new FakeJevFetch(new Promise<JevHttpResponse>(() => {}));
    const decisions: DecisionRecord[] = [];
    const result = await withDelegateShadow(
      async () => "worker result", "task", 1,
      { ask: askWith(fake), log: (decision) => decisions.push(decision), timeoutMs: 5 },
    );
    expect(result).toBe("worker result");
    expect(decisions).toMatchObject([{ choice: null, actual: "1", accepted: false, fallback: false }]);
  });
});
