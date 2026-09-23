import { describe, expect, it } from "vitest";
import {
  JEV_URL,
  askJev,
  buildJevRequest,
  parseJevResponse,
  resolveOpenRouterKey,
  type JevFetchInit,
  type JevHttpResponse,
  type JevQuestions,
} from "../src/jev.js";

class FakeFetch {
  readonly calls: { url: string; init: JevFetchInit }[] = [];

  constructor(private readonly response: JevHttpResponse) {}

  readonly fetch = async (url: string, init: JevFetchInit): Promise<JevHttpResponse> => {
    this.calls.push({ url, init });
    return this.response;
  };
}

const questions: JevQuestions = {
  irreversible: { type: "noul", instructions: "Is this action irreversible?" },
  verdict: {
    type: "choice",
    instructions: "Choose the correct verdict.",
    criteria: {
      approve: "The change is safe.",
      block: "The change must not proceed.",
    },
  },
};

describe("buildJevRequest", () => {
  it("builds the System One request body", () => {
    expect(buildJevRequest("state", questions, "typesafe/jev-1.13")).toEqual({
      model: "typesafe/jev-1.13",
      state: "state",
      questions,
    });
  });

  it("rejects an empty question set with the received value and expected shape", () => {
    expect(() => buildJevRequest("state", {} as JevQuestions, "model")).toThrow(/received \{\}/i);
    expect(() => buildJevRequest("state", {} as JevQuestions, "model")).toThrow(/at least one question/i);
  });

  it("rejects a choice without non-empty criteria", () => {
    const invalid = {
      review: { type: "choice", instructions: "Choose.", criteria: {} },
    } as JevQuestions;
    expect(() => buildJevRequest("state", invalid, "model")).toThrow(/received \{\}/i);
    expect(() => buildJevRequest("state", invalid, "model")).toThrow(/non-empty criteria/i);
  });
});

describe("parseJevResponse", () => {
  it("parses noul and choice answers", () => {
    const result = parseJevResponse({
      model: "typesafe/jev-1.13-20260917",
      answers: {
        irreversible: { type: "noul", noul: 0.75 },
        verdict: {
          type: "choice",
          choice: "approve",
          probabilities: { approve: 0.8, block: 0.2 },
          confidence: 0.7,
        },
      },
      usage: { input_tokens: 10, output_tokens: 5, cost: 0.00001 },
    }, questions);

    expect(result.answers.irreversible).toEqual({ type: "noul", noul: 0.75 });
    expect(result.answers.verdict).toEqual({
      type: "choice",
      choice: "approve",
      probabilities: { approve: 0.8, block: 0.2 },
      confidence: 0.7,
    });
    expect(result.model).toBe("typesafe/jev-1.13-20260917");
    expect(result.usage?.cost).toBe(0.00001);
  });

  it("rejects a response missing an asked answer", () => {
    expect(() => parseJevResponse({ answers: {} }, questions)).toThrow(/irreversible.*answer/i);
    expect(() => parseJevResponse({ answers: {} }, questions)).toThrow(/received undefined/i);
  });

  it("rejects a noul outside [0,1]", () => {
    expect(() => parseJevResponse({
      answers: {
        irreversible: { type: "noul", noul: 1.2 },
        verdict: { type: "choice", choice: "approve", probabilities: {}, confidence: 0.5 },
      },
    }, questions)).toThrow(/1\.2.*\[0,1\]/);
  });

  it("rejects a choice label outside that question's criteria", () => {
    expect(() => parseJevResponse({
      answers: {
        irreversible: { type: "noul", noul: 0.5 },
        verdict: { type: "choice", choice: "reject", probabilities: {}, confidence: 0.5 },
      },
    }, questions)).toThrow(/reject.*approve.*block/i);
  });
});

describe("resolveOpenRouterKey", () => {
  it("prefers OPENROUTER_API_KEY", () => {
    expect(resolveOpenRouterKey(
      { HOME: "/home/test", OPENROUTER_API_KEY: "env-key" },
      () => {
        throw new Error("must not read auth.json");
      },
    )).toBe("env-key");
  });

  it("falls back to opencode auth.json", () => {
    let pathRead = "";
    const key = resolveOpenRouterKey(
      { HOME: "/home/test" },
      (path) => {
        pathRead = path;
        return JSON.stringify({ openrouter: { key: "file-key" } });
      },
    );
    expect(key).toBe("file-key");
    expect(pathRead).toBe("/home/test/.local/share/opencode/auth.json");
  });

  it("explains both key options when neither is available", () => {
    expect(() => resolveOpenRouterKey(
      { HOME: "/home/test" },
      () => {
        throw new Error("ENOENT");
      },
    )).toThrow(/OPENROUTER_API_KEY/);
    expect(() => resolveOpenRouterKey(
      { HOME: "/home/test" },
      () => {
        throw new Error("ENOENT");
      },
    )).toThrow(/\.local\/share\/opencode\/auth\.json/);
  });
});

describe("askJev", () => {
  it("posts the request and parses a successful response", async () => {
    const fake = new FakeFetch({
      status: 200,
      text: async () => "unused",
      json: async () => ({
        model: "typesafe/jev-1.13-20260917",
        answers: {
          irreversible: { type: "noul", noul: 0.75 },
          verdict: {
            type: "choice",
            choice: "approve",
            probabilities: { approve: 0.8, block: 0.2 },
            confidence: 0.7,
          },
        },
        usage: { cost: 0.00001 },
      }),
    });

    const result = await askJev(
      { state: { change: "small" }, questions, model: "custom/model" },
      { fetch: fake.fetch, key: "secret-key" },
    );

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(JEV_URL);
    expect(fake.calls[0].init.method).toBe("POST");
    expect(fake.calls[0].init.headers.Authorization).toBe("Bearer secret-key");
    expect(JSON.parse(fake.calls[0].init.body)).toMatchObject({ model: "custom/model" });
    expect(result.answers.verdict).toMatchObject({ choice: "approve" });
  });

  it("rejects non-2xx responses with status and only the first 300 body chars", async () => {
    const body = "x".repeat(350);
    const fake = new FakeFetch({
      status: 429,
      text: async () => body,
      json: async () => ({}),
    });

    await expect(askJev(
      { state: "state", questions },
      { fetch: fake.fetch, key: "secret-key" },
    )).rejects.toThrow(`Jev request failed (429): ${"x".repeat(300)}`);
  });
});
