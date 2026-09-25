import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveReadTool, quotaCandidates, quotaErrorMessage, type Engine } from "../src/cli.js";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const indexSrc = readFileSync(path.join(repoRoot, "src", "index.ts"), "utf8");

const READ_TOOLS = ["explore", "read_slice", "web_lookup"] as const;
const all: (e: Engine) => boolean = (e) => e !== "cursor";

describe("resolveReadTool — cascata das três tools de leitura", () => {
  it("com tudo saudável, mantém codex + gpt-6-luna + medium nas três", () => {
    for (const tool of READ_TOOLS) {
      expect(resolveReadTool(tool, {}, {}, all, false, {}, true)).toEqual({
        engine: "codex",
        model: "gpt-6-luna",
        effort: "medium",
      });
    }
  });

  it("codex sem cota (health 0) cai no claude haiku low", () => {
    for (const tool of READ_TOOLS) {
      expect(resolveReadTool(tool, {}, {}, all, false, { codex: 0 }, true)).toEqual({
        engine: "claude",
        model: "haiku",
        effort: "low",
      });
    }
  });

  it("codex ausente também cai no claude", () => {
    expect(resolveReadTool("explore", {}, {}, (e) => e !== "codex" && e !== "cursor", false, {}, true).engine)
      .toBe("claude");
  });

  it("explore e read_slice seguem até o opencode quando codex e claude estão fora", () => {
    for (const tool of ["explore", "read_slice"] as const) {
      expect(resolveReadTool(tool, {}, {}, all, false, { codex: 0, claude: 0 }, true)).toEqual({
        engine: "opencode",
        model: "openrouter/inception/mercury-2",
        effort: undefined,
      });
    }
  });

  it("web_lookup só aceita engine com web search: sem codex e claude, falha nomeando o motivo", () => {
    expect(() => resolveReadTool("web_lookup", {}, {}, all, false, { codex: 0, claude: 0 }, true))
      .toThrow(/web_lookup[\s\S]*web search/);
  });

  it("com o sandbox desligado só o codex serve; codex fora vira erro de read-only", () => {
    expect(resolveReadTool("explore", {}, {}, all, false, {}, false).engine).toBe("codex");
    expect(() => resolveReadTool("explore", {}, {}, all, false, { codex: 0 }, false)).toThrow(/read-only/);
  });

  it("engine explícita (parâmetro ou env) vence e não passa pela cascata", () => {
    expect(resolveReadTool("explore", { engine: "codex" }, {}, all, false, { codex: 0 }, true).engine)
      .toBe("codex");
    expect(resolveReadTool("read_slice", {}, { POLYAGENT_READ_SLICE_ENGINE: "grok" }, all, false, {}, true).engine)
      .toBe("grok");
  });

  it("modelo e effort explícitos vencem o da cascata", () => {
    expect(resolveReadTool("explore", { model: "sonnet", effort: "high" }, {}, all, false, { codex: 0 }, true))
      .toEqual({ engine: "claude", model: "sonnet", effort: "high" });
  });

  it("POLYAGENT_EXPLORE_MODEL/EFFORT seguem valendo quando a cascata escolhe o codex", () => {
    const env = { POLYAGENT_EXPLORE_MODEL: "gpt-6-sol", POLYAGENT_EXPLORE_EFFORT: "low" };
    expect(resolveReadTool("web_lookup", {}, env, all, false, {}, true))
      .toEqual({ engine: "codex", model: "gpt-6-sol", effort: "low" });
  });
});

describe("quotaCandidates — ignora engines unhealthy", () => {
  it("codex estourou e grok/claude estão fora: sugere o opencode direto", () => {
    const health = { grok: 0, claude: 0.1 };
    const candidates = quotaCandidates("explore", "codex", all, false, true, health);
    expect(candidates).toEqual(["opencode", "kimi", "muse"]);
    expect(quotaErrorMessage("quota_exhausted", "codex", "explore", candidates)).toMatch(/engine:"opencode"/);
    expect(quotaErrorMessage("quota_exhausted", "codex", "explore", candidates)).not.toMatch(/grok|claude/);
  });

  it("sem health, mantém o comportamento antigo (todas instaladas contam)", () => {
    expect(quotaCandidates("explore", "codex", all, false, true)).toEqual(["grok", "claude", "opencode", "kimi", "muse"]);
  });

  it("web_lookup: codex estourou, sugere claude; claude fora, não sobra ninguém", () => {
    expect(quotaCandidates("web_lookup", "codex", all, false, true, {})).toEqual(["claude"]);
    expect(quotaCandidates("web_lookup", "codex", all, false, true, { claude: 0 })).toEqual([]);
  });
});

describe("handlers de leitura", () => {
  it("as três de leitura resolvem pela cascata e passam health ao runCursor", () => {
    for (const tool of READ_TOOLS) {
      const block = indexSrc.match(new RegExp(`registerTool\\(\\s*"${tool}"[\\s\\S]*?\\n\\);\\n`))?.[0] ?? "";
      expect(block, tool).toMatch(new RegExp(`resolveReadTool\\(\\s*"${tool}"`));
      expect(block, tool).toMatch(/runCursor\(\{[^}]*\bhealth\b/);
    }
  });
});
