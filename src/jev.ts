import { homedir } from "node:os";
import { join } from "node:path";

export const JEV_MODEL = process.env.POLYAGENT_JEV_MODEL || "typesafe/jev-1.13";
export const JEV_URL = process.env.POLYAGENT_JEV_URL || "https://openrouter.ai/api/v1/systemone";

export type JevState = string | Record<string, unknown>;

export interface JevNoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: Record<string, string>;
}

export interface JevChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria?: Record<string, string>;
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion;
export type JevQuestions = Record<string, JevQuestion>;

export interface JevRequest {
  model: string;
  state: JevState;
  questions: JevQuestions;
}

export interface JevNoulAnswer {
  type: "noul";
  noul: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer;
export type JevAnswers = Record<string, JevAnswer>;

export interface JevUsage {
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
}

export interface JevResult {
  answers: JevAnswers;
  model?: string;
  usage?: JevUsage;
}

export interface JevFetchInit {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface JevHttpResponse {
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type JevFetch = (url: string, init: JevFetchInit) => Promise<JevHttpResponse>;
export type JevReadFile = (path: string) => string;

export interface AskJevParams {
  state: JevState;
  questions: JevQuestions;
  model?: string;
}

export interface AskJevDeps {
  fetch: JevFetch;
  key: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function describe(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

function invalidRequest(received: unknown, expected: string): never {
  throw new Error(`Invalid Jev request: received ${describe(received)}; expected ${expected}.`);
}

function invalidResponse(question: string, received: unknown, expected: string): never {
  throw new Error(
    `Invalid Jev response for question "${question}": received ${describe(received)}; expected ${expected}.`,
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function validateQuestion(question: unknown): void {
  if (!isRecord(question) || (question.type !== "noul" && question.type !== "choice")
    || typeof question.instructions !== "string") {
    invalidRequest(question, "{ type: \"noul\"|\"choice\", instructions: string, criteria?: Record<string,string> }");
  }
  if (question.type === "choice"
    && (!isStringRecord(question.criteria) || Object.keys(question.criteria).length === 0)) {
    invalidRequest(question.criteria, "a non-empty criteria object for a choice question");
  }
  if (question.criteria !== undefined && !isStringRecord(question.criteria)) {
    invalidRequest(question.criteria, "criteria as Record<string,string>");
  }
}

export function buildJevRequest(state: JevState, questions: JevQuestions, model: string): JevRequest {
  if (!isRecord(questions) || Object.keys(questions).length === 0) {
    invalidRequest(questions, "at least one question in Record<string, Question>");
  }
  for (const question of Object.values(questions)) validateQuestion(question);
  return { model, state, questions };
}

function parseProbabilityMap(value: unknown, question: string): Record<string, number> {
  if (!isRecord(value)) {
    invalidResponse(question, value, "probabilities as Record<string, number>");
  }
  const probabilities: Record<string, number> = {};
  for (const [label, probability] of Object.entries(value)) {
    if (typeof probability !== "number" || !Number.isFinite(probability)) {
      invalidResponse(question, value, "probabilities as Record<string, number>");
    }
    probabilities[label] = probability;
  }
  return probabilities;
}

function parseAnswer(questionName: string, question: JevQuestion, received: unknown): JevAnswer {
  if (question.type === "noul") {
    if (!isRecord(received) || received.type !== "noul"
      || typeof received.noul !== "number" || !Number.isFinite(received.noul)
      || received.noul < 0 || received.noul > 1) {
      invalidResponse(questionName, received, "{ type: \"noul\", noul: number in [0,1] }");
    }
    return { type: "noul", noul: received.noul };
  }

  const criteria = question.criteria;
  if (!isStringRecord(criteria) || Object.keys(criteria).length === 0) {
    invalidResponse(questionName, criteria, "a non-empty criteria object for a choice question");
  }
  if (!isRecord(received) || received.type !== "choice" || typeof received.choice !== "string") {
    invalidResponse(questionName, received, "{ type: \"choice\", choice: one of the criteria keys, probabilities: Record<string, number>, confidence: number }");
  }
  if (!hasOwn(criteria, received.choice)) {
    invalidResponse(questionName, received.choice, `choice label ${JSON.stringify(Object.keys(criteria))}`);
  }
  const probabilities = parseProbabilityMap(received.probabilities, questionName);
  if (typeof received.confidence !== "number" || !Number.isFinite(received.confidence)) {
    invalidResponse(questionName, received.confidence, "confidence as a number");
  }
  return {
    type: "choice",
    choice: received.choice,
    probabilities,
    confidence: received.confidence,
  };
}

function parseUsage(value: unknown): JevUsage | undefined {
  if (!isRecord(value)) return undefined;
  const usage: JevUsage = {};
  for (const field of ["input_tokens", "output_tokens", "cost"] as const) {
    const item = value[field];
    if (typeof item === "number" && Number.isFinite(item)) usage[field] = item;
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}

export function parseJevResponse(json: unknown, questions: JevQuestions): JevResult {
  if (!isRecord(json) || !isRecord(json.answers)) {
    throw new Error(
      `Invalid Jev response: received ${describe(json)}; expected { answers: Record<string, Answer> }.`,
    );
  }

  const answers: JevAnswers = {};
  for (const [questionName, question] of Object.entries(questions)) {
    if (!hasOwn(json.answers, questionName)) {
      invalidResponse(questionName, undefined, "an answer for every asked question");
    }
    answers[questionName] = parseAnswer(questionName, question, json.answers[questionName]);
  }
  const usage = parseUsage(json.usage);

  return {
    answers,
    ...(typeof json.model === "string" ? { model: json.model } : {}),
    ...(usage ? { usage } : {}),
  };
}

export function resolveOpenRouterKey(
  env: Readonly<Record<string, string | undefined>>,
  readFile: JevReadFile,
): string {
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;

  const home = env.HOME || homedir();
  const authPath = join(home, ".local", "share", "opencode", "auth.json");
  try {
    const parsed: unknown = JSON.parse(readFile(authPath));
    if (isRecord(parsed) && isRecord(parsed.openrouter) && typeof parsed.openrouter.key === "string"
      && parsed.openrouter.key.length > 0) {
      return parsed.openrouter.key;
    }
  } catch {
    // A chave ausente, um arquivo inexistente ou JSON inválido têm a mesma instrução acionável.
  }

  throw new Error(
    "OpenRouter key missing: set OPENROUTER_API_KEY or add .openrouter.key to ~/.local/share/opencode/auth.json.",
  );
}

export async function askJev(params: AskJevParams, deps: AskJevDeps): Promise<JevResult> {
  const request = buildJevRequest(params.state, params.questions, params.model ?? JEV_MODEL);
  const response = await deps.fetch(JEV_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (response.status < 200 || response.status >= 300) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`Jev request failed (${response.status}): ${body}`);
  }
  return parseJevResponse(await response.json(), params.questions);
}
