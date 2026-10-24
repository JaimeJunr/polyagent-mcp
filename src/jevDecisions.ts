import { LEVELS, type Level } from "./cli.js";
import type { AskJevParams, JevResult } from "./jev.js";
import type { DecisionRecord } from "./usage.js";
import { scrubSecrets } from "./scrub.js";

const FANOUT_PER_WORKER_CHARS = 6_000;
const FANOUT_TOTAL_CHARS = 24_000;
const SHADOW_PROMPT_CHARS = 12_000;
const JEV_DECISION_TIMEOUT_MS = 5_000;

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
          low: "Mechanical work and routine implementation; GPT-6 Luna max, $0.07/task AA quota proxy.",
          middle: "Implementation or reasoning beyond low; GPT-6.1 Sol medium, $0.21/task AA quota proxy. Low/middle cover most work.",
          high: "Hard debugging, cross-file impact or a costly verdict after cheaper levels fail; expensive Claude Opus 5.5 high, $1.82/task AA quota proxy, sharing the Claude Code host subscription.",
        },
      },
      ...CLARITY_QUESTIONS,
    },
  };
}

// Critérios do gate de prompt do vídeo do Jev (Crivo), restritos ao que falta a um worker que não
// vê o contexto do orquestrador. Shadow: só registra; o limiar de 0,5 é do código, não do Jev.
const CLARITY_QUESTIONS = {
  names_target: {
    type: "noul",
    instructions: "Does the task say where to work — which files, module, function, screen or component to change or inspect?",
  },
  defines_done: {
    type: "noul",
    instructions: "Does the task state how to know it is finished — an expected behavior, a test to pass, or an observable outcome?",
  },
  single_task: {
    type: "noul",
    instructions: "Is this one focused task, rather than several unrelated tasks mixed into one request?",
  },
} as const satisfies AskJevParams["questions"];

export const CLARITY_CRITERIA = Object.keys(CLARITY_QUESTIONS) as (keyof typeof CLARITY_QUESTIONS)[];
const CLARITY_MISSING_BELOW = 0.5;

export function clarityDecision(result: JevResult | Error, latencyMs: number, session?: string): DecisionRecord {
  const answers = result instanceof Error ? undefined : result.answers;
  const probabilities: Record<string, number> = {};
  for (const key of CLARITY_CRITERIA) {
    const answer = answers?.[key];
    if (answer?.type !== "noul" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) break;
    probabilities[key] = answer.noul;
  }
  const valid = Object.keys(probabilities).length === CLARITY_CRITERIA.length;
  const weakest = valid ? Math.min(...Object.values(probabilities)) : null;
  return {
    name: "delegate_prompt_clarity_shadow",
    candidates: ["clear", "unclear"],
    choice: weakest === null ? null : weakest >= CLARITY_MISSING_BELOW ? "clear" : "unclear",
    // Confiança no veredito: o critério mais fraco decide "clear"; em "unclear", quão ausente ele está.
    confidence: weakest === null ? null : weakest >= CLARITY_MISSING_BELOW ? weakest : 1 - weakest,
    accepted: false,
    fallback: false,
    latencyMs,
    cost: result instanceof Error ? null : result.usage?.cost ?? null,
    ...(valid ? { probabilities } : {}),
    ...(session ? { session } : {}),
  };
}

/** Lê o handle `session_id:` do footer de `format()` num resultado de tool MCP. */
export function footerSession(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    const text = (part as { text?: unknown } | null)?.text;
    const match = typeof text === "string" ? /session_id: (\S+)/.exec(text) : null;
    if (match) return match[1];
  }
  return undefined;
}

export function shadowDecision(result: JevResult | Error, requestedLevel: Level, latencyMs: number): DecisionRecord {
  const answer = result instanceof Error ? undefined : result.answers?.level;
  const valid = answer?.type === "choice" && LEVELS.some((level) => level === answer.choice)
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
    actual: requestedLevel,
  };
}

// Verificador do resultado do worker (research/2026-10-24-usos-modelo-decisao.md, ideia 1): ataca o
// verde vazio que o `evidenceNote` só pede ao worker. Shadow: só grava; o limiar de 0,5 é do código.
const VERIFY_PROMPT_CHARS = 3_000;
// Elephant 1 tem 16K tokens; ~12K chars de resultado deixa folga para prompt e perguntas.
const VERIFY_RESULT_CHARS = 12_000;
const VERIFY_QUESTIONS = {
  claims_success: {
    type: "noul",
    instructions: "Does the worker result claim success for the work it did — done, fixed, implemented, tests pass or check passed — regardless of whether that work matches the task?",
  },
  reports_denominator: {
    type: "noul",
    instructions: "Does the result state how many items its checks actually covered (tests run, files scanned, cases checked), so an empty or vacuous check would be visible?",
  },
  evidence_shown: {
    type: "noul",
    instructions: "Is the success claim backed by concrete evidence in the result itself — command output, test counts, file:line references or a diff — rather than a bare assertion?",
  },
  addresses_task: {
    type: "noul",
    instructions: "Does the result carry out or answer the specific task given to the worker — a finding of nothing (e.g. zero issues) still counts — rather than reporting work on a different task?",
  },
} as const satisfies AskJevParams["questions"];
const VERIFY_KEYS = Object.keys(VERIFY_QUESTIONS) as (keyof typeof VERIFY_QUESTIONS)[];

export function delegateVerifyRequest(prompt: string, resultText: string): AskJevParams {
  const task = clipHeadTail(scrubSecrets(prompt).text, VERIFY_PROMPT_CHARS);
  // Head+tail: o veredito do worker fica no fim, como no gate do fan_out.
  const result = clipHeadTail(scrubSecrets(resultText).text, VERIFY_RESULT_CHARS);
  return { state: `Task given to the worker:\n${task}\n\nWorker result:\n${result}`, questions: VERIFY_QUESTIONS };
}

export function verifyDecision(result: JevResult | Error, latencyMs: number, session?: string): DecisionRecord {
  const answers = result instanceof Error ? undefined : result.answers;
  const probabilities: Record<string, number> = {};
  for (const key of VERIFY_KEYS) {
    const answer = answers?.[key];
    if (answer?.type !== "noul" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) break;
    probabilities[key] = answer.noul;
  }
  const valid = Object.keys(probabilities).length === VERIFY_KEYS.length;
  let choice: string | null = null;
  let confidence: number | null = null;
  if (valid) {
    const support = Math.min(probabilities.evidence_shown, probabilities.addresses_task);
    if (probabilities.claims_success < 0.5) {
      choice = "no_claim";
      confidence = 1 - probabilities.claims_success;
    } else {
      choice = support >= 0.5 ? "supported" : "unsupported";
      confidence = support >= 0.5 ? support : 1 - support;
    }
  }
  return {
    name: "delegate_result_verify_shadow",
    candidates: ["supported", "unsupported", "no_claim"],
    choice,
    confidence,
    accepted: false,
    fallback: false,
    latencyMs,
    cost: result instanceof Error ? null : result.usage?.cost ?? null,
    ...(valid ? { probabilities } : {}),
    ...(session ? { session } : {}),
  };
}

/** Junta o texto de um resultado de tool MCP; `undefined` quando é erro ou não tem texto. */
function successText(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || (value as { isError?: unknown }).isError) return undefined;
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const text = content.map((part) => (part as { text?: unknown } | null)?.text)
    .filter((t): t is string => typeof t === "string").join("\n");
  return text || undefined;
}

interface DecisionDeps {
  ask: (request: AskJevParams) => Promise<JevResult>;
  log: (decision: DecisionRecord) => void;
  now?: () => number;
  timeoutMs?: number;
  sessionOf?: (workerValue: unknown) => string | undefined;
  /** Recebe a tarefa shadow que roda depois do retorno; testes usam para aguardar o log. */
  background?: (task: Promise<void>) => void;
}

export async function withDelegateVerify<T>(work: () => Promise<T>, prompt: string, deps: DecisionDeps): Promise<T> {
  const value = await work();
  const text = successText(value);
  if (text === undefined) return value;
  const now = deps.now ?? Date.now;
  const started = now();
  // Não aguardado: o verificador nunca atrasa o retorno do worker ao host.
  const task = Promise.resolve()
    .then(() => deps.ask(delegateVerifyRequest(prompt, text)))
    .then((result) => result as JevResult | Error, (error: unknown) => asError(error) as JevResult | Error)
    .then((result) => {
      try {
        deps.log(verifyDecision(result, now() - started, deps.sessionOf?.(value)));
      } catch {
        // A observação shadow não pode derrubar nada.
      }
    });
  deps.background?.(task);
  return value;
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
  requestedLevel: Level,
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
    const session = workerOutcome.ok ? deps.sessionOf?.(workerOutcome.value) : undefined;
    const level = shadowDecision(settled.result, requestedLevel, settled.latencyMs);
    deps.log(session ? { ...level, session } : level);
    deps.log(clarityDecision(settled.result, settled.latencyMs, session));
  } catch {
    // A observação shadow não pode alterar o resultado do worker.
  }
  if (!workerOutcome.ok) throw workerOutcome.error;
  return workerOutcome.value;
}
