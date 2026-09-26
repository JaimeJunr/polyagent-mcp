import type { AskJevParams, JevResult } from "./jev.js";
import type { DecisionRecord } from "./usage.js";
import { scrubSecrets } from "./scrub.js";

const FANOUT_PER_WORKER_CHARS = 6_000;
const FANOUT_TOTAL_CHARS = 24_000;
const SHADOW_PROMPT_CHARS = 12_000;
const JEV_DECISION_TIMEOUT_MS = 5_000;
const LEVELS = ["1", "2", "3", "4", "5"];

export type FanOutGateVerdict =
  | { accepted: true; fallback: false; choice: string; confidence: number; probability: number; cost: number | null }
  | { accepted: false; fallback: true; choice: string | null; confidence: number | null; probability: number | null; cost: number | null };

export function clipHeadTail(text: string, maxChars: number): string {
  const budget = Math.floor(maxChars);
  if (!Number.isFinite(budget) || budget < 1) return "";
  if (text.length <= budget) return text;
  let marker = `\n[... ${text.length - budget} chars omitted ...]\n`;
  while (true) {
    const retained = budget - marker.length;
    if (retained < 2) return budget === 1 ? "…" : `…${text.slice(1 - budget)}`;
    const omitted = text.length - retained;
    const nextMarker = `\n[... ${omitted} chars omitted ...]\n`;
    if (nextMarker === marker) {
      const headChars = Math.floor(retained / 4);
      return text.slice(0, headChars) + marker + text.slice(-retained + headChars);
    }
    marker = nextMarker;
  }
}

export function fanOutAgreementRequest(
  outputs: string[],
  limits: { perWorkerChars: number; totalChars: number } = {
    perWorkerChars: FANOUT_PER_WORKER_CHARS,
    totalChars: FANOUT_TOTAL_CHARS,
  },
): AskJevParams {
  if (outputs.length < 2) throw new Error("Fan-out agreement needs at least two successful outputs.");
  const headers = outputs.map((_, i) => `Worker ${i + 1}:\n`);
  const separatorsLength = 2 * (outputs.length - 1);
  const available = limits.totalChars - headers.reduce((sum, header) => sum + header.length, 0) - separatorsLength;
  const charsPerWorker = Math.min(limits.perWorkerChars, Math.floor(available / outputs.length));
  if (!Number.isFinite(charsPerWorker) || charsPerWorker < 1) {
    throw new Error("Fan-out agreement context is too small for all workers.");
  }
  return {
    state: outputs.map((output, i) => `${headers[i]}${clipHeadTail(scrubSecrets(output).text, charsPerWorker)}`).join("\n\n"),
    questions: {
      agreement: {
        type: "noul",
        instructions: "Do these worker outputs substantially agree on the answer or recommendation? Give a high probability only when their conclusions are materially consistent.",
      },
    },
  };
}

export function resolveFanOutGate(result: JevResult | Error, threshold: number): FanOutGateVerdict {
  const failure: FanOutGateVerdict = {
    accepted: false, fallback: true, choice: null, confidence: null, probability: null, cost: null,
  };
  if (result instanceof Error || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) return failure;
  const answer = result.answers?.agreement;
  if (!answer || answer.type !== "noul" || !Number.isFinite(answer.noul)
    || answer.noul < 0 || answer.noul > 1) return failure;
  const probability = answer.noul;
  const answered = {
    choice: probability >= 0.5 ? "agree" : "disagree",
    confidence: Math.max(probability, 1 - probability),
    probability,
    cost: result.usage?.cost ?? null,
  };
  return probability >= threshold
    ? { ...answered, accepted: true, fallback: false }
    : { ...answered, accepted: false, fallback: true };
}

export function fanOutAgreementText(workerText: string, sessionFooter: string, probability: number): string {
  return `[jev: workers agree (p=${probability.toFixed(2)}), arbiter skipped]\n\n${workerText}\n\nWorker sessions (pass to follow_up):\n${sessionFooter}`;
}

export function delegateShadowRequest(prompt: string): AskJevParams {
  return {
    state: scrubSecrets(prompt).text.slice(0, SHADOW_PROMPT_CHARS),
    questions: {
      level: {
        type: "choice",
        instructions: "Which difficulty level fits this task? Choose the lowest level likely to complete it well.",
        criteria: {
          "1": "Mechanical or very simple task; cheapest GPT-6 Luna tier.",
          "2": "Routine implementation or analysis; GPT-6 Sol high.",
          "3": "Complex implementation or reasoning; GPT-6 Sol max.",
          "4": "Hard debugging or cross-file impact needing frontier reasoning; expensive Claude Opus 5.5 high, sharing the Claude Code host subscription.",
          "5": "Frontier reasoning that cheaper levels cannot handle; Claude Opus 5.5 max, last resort.",
        },
      },
    },
  };
}

export function shadowDecision(result: JevResult | Error, requestedLevel: number, latencyMs: number): DecisionRecord {
  const answer = result instanceof Error ? undefined : result.answers?.level;
  const valid = answer?.type === "choice" && LEVELS.includes(answer.choice)
    && Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1;
  return {
    name: "delegate_level_shadow",
    candidates: [...LEVELS],
    choice: valid && answer?.type === "choice" ? answer.choice : null,
    confidence: valid && answer?.type === "choice" ? answer.confidence : null,
    accepted: false,
    fallback: false,
    latencyMs,
    cost: result instanceof Error ? null : result.usage?.cost ?? null,
    actual: String(requestedLevel),
  };
}

interface DecisionDeps {
  ask: (request: AskJevParams) => Promise<JevResult>;
  log: (decision: DecisionRecord) => void;
  now?: () => number;
  timeoutMs?: number;
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export async function askFanOutAgreement(
  outputs: string[],
  threshold: number,
  deps: DecisionDeps,
): Promise<FanOutGateVerdict> {
  const now = deps.now ?? Date.now;
  const started = now();
  const jev = Promise.resolve()
    .then(() => deps.ask(fanOutAgreementRequest(outputs)))
    .then((result) => result as JevResult | Error, (error: unknown) => asError(error) as JevResult | Error);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = deps.timeoutMs && deps.timeoutMs > 0 ? deps.timeoutMs : JEV_DECISION_TIMEOUT_MS;
  const result = await Promise.race([
    jev,
    new Promise<Error>((resolve) => {
      timer = setTimeout(() => resolve(new Error("Jev fan-out agreement timed out")), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  const verdict = resolveFanOutGate(result, threshold);
  try {
    deps.log({
      name: "fan_out_agreement",
      candidates: ["agree", "disagree"],
      choice: verdict.choice,
      confidence: verdict.confidence,
      accepted: verdict.accepted,
      fallback: verdict.fallback,
      latencyMs: now() - started,
      cost: verdict.cost,
    });
  } catch {
    // O log não pode bloquear o arbiter nem o retorno do worker.
  }
  return verdict;
}

export async function runFanOutConsensusGate<T>(
  successfulOutputs: string[],
  enabled: boolean,
  threshold: number,
  onAgreement: (verdict: Extract<FanOutGateVerdict, { accepted: true }>) => T | Promise<T>,
  arbiter: () => Promise<T>,
  deps: DecisionDeps,
): Promise<T> {
  if (!enabled || successfulOutputs.length < 2) return arbiter();
  const verdict = await askFanOutAgreement(successfulOutputs, threshold, deps);
  return verdict.accepted ? onAgreement(verdict) : arbiter();
}

export async function withDelegateShadow<T>(
  work: () => Promise<T>,
  prompt: string,
  requestedLevel: number,
  deps: DecisionDeps,
): Promise<T> {
  let worker: Promise<T>;
  try {
    worker = Promise.resolve(work());
  } catch (error) {
    worker = Promise.reject(error);
  }
  const now = deps.now ?? Date.now;
  const started = now();
  const jev = Promise.resolve()
    .then(() => deps.ask(delegateShadowRequest(prompt)))
    .then(
      (result) => ({ result: result as JevResult | Error, latencyMs: now() - started }),
      (error: unknown) => ({ result: asError(error) as JevResult | Error, latencyMs: now() - started }),
    );
  const workerOutcome = await worker.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = deps.timeoutMs && deps.timeoutMs > 0 ? deps.timeoutMs : JEV_DECISION_TIMEOUT_MS;
  const settled = await Promise.race([
    jev,
    new Promise<{ result: Error; latencyMs: number }>((resolve) => {
      timer = setTimeout(() => resolve({ result: new Error("Jev shadow timed out"), latencyMs: now() - started }), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  try {
    deps.log(shadowDecision(settled.result, requestedLevel, settled.latencyMs));
  } catch {
    // A observação shadow não pode alterar o resultado do worker.
  }
  if (!workerOutcome.ok) throw workerOutcome.error;
  return workerOutcome.value;
}
