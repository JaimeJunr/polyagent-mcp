import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const indexSrc = readFileSync(path.join(repoRoot, "src", "index.ts"), "utf8");
const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

describe("tool surface (US-003)", () => {
  it("registra exatamente doze tools", () => {
    const calls = indexSrc.match(/server\.registerTool\(/g) ?? [];
    expect(calls).toHaveLength(12);
  });

  it("não registra mais as tools plan e build", () => {
    expect(indexSrc).not.toMatch(/registerTool\(\s*"plan"/);
    expect(indexSrc).not.toMatch(/registerTool\(\s*"build"/);
    expect(indexSrc).not.toMatch(/\bplanPrompt\b/);
    expect(indexSrc).not.toMatch(/\bbuildPrompt\b/);
  });

  it("as instructions do server não anunciam mais o two-phase plan → build", () => {
    expect(indexSrc).not.toMatch(/Two-phase work/);
    // o resto do roteamento continua intacto
    expect(indexSrc).toMatch(/self-contained implementation, commits, PRs/);
    expect(indexSrc).toMatch(/Worker tools return a session_id for follow_up; decide returns structured JSON\. Results can be graded with rate\./);
  });

  it("as instructions do server roteiam comparação e veredito arriscado para fan_out", () => {
    expect(indexSrc).toMatch(/comparing 2\+ approaches or cross-checking a risky verdict → fan_out \(mode consensus\)/);
  });

  it("as instructions separam o polyagent de um MCP server chamado codex", () => {
    expect(indexSrc).toMatch(/MCP server named \\"codex\\"/);
    expect(indexSrc).toMatch(/says nothing about polyagent/);
  });

  it("as instructions mandam delegar o resto quando a tarefa precisa de skills, subagents ou browser", () => {
    expect(indexSrc).toMatch(/not all-or-nothing/);
    expect(indexSrc).toMatch(/a skill with agent: \{ skill: 'plugin:name' \}/);
    expect(indexSrc).toMatch(/mounted read-only/);
    expect(indexSrc).toMatch(/only steps that need an MCP server or a browser stay with you/i);
    expect(indexSrc).not.toMatch(/paste what the worker needs/);
    expect(indexSrc).toMatch(/agent:.{0,3}<name>/);
  });

  it("instructions anunciam a escada AA atual antes dos schemas deferred", () => {
    expect(indexSrc).toContain(
      "levels: low=GPT-6 Luna max, middle=GPT-6.1 Sol medium, high=Claude Opus 5.5 high; AA quota proxies $0.07 → $0.21 (~3×) → $1.82 (~8.7×)",
    );
  });

  it("a descrição do param level manda passar o nome como string JSON entre aspas", () => {
    // host mandou {"level": middle} sem aspas várias vezes: JSON inválido, recusado antes de chegar ao server
    const desc = indexSrc.match(/level: z\.preprocess\(legacyLevel, z\.enum\(LEVELS\)\)\s*\.describe\("((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
    expect(desc).toContain('{\\"level\\": \\"<name>\\"}');
    for (const l of ["low", "middle", "high"]) expect(desc).toContain(`\\"${l}\\"`);
    expect(desc).toMatch(/quoted JSON string/);
  });

  it("a descrição do param agent ensina a passar uma skill por nome com arquivos RO", () => {
    const desc = indexSrc.match(/const agentDescription =\s*"([^"]*)"/)?.[1] ?? "";
    expect(desc).toContain("To hand over a skill, pass { skill: 'plugin:name' } (e.g. { skill: 'ivt-quality:security-audit' }): its SKILL.md becomes the persona and its folder (scripts/, references/) is mounted read-only in the worker sandbox.");
  });

  it("sincroniza o bloco do CLAUDE.md no boot, antes de conectar, sem quebrar o startup", () => {
    const sync = indexSrc.indexOf('syncClaudeMd(CLAUDE_MD_PATH, "boot"');
    expect(sync).toBeGreaterThan(-1);
    expect(indexSrc.slice(sync - 200, sync)).toMatch(/if \(CLAUDE_MD_BOOT_SYNC\)/);
    expect(sync).toBeLessThan(indexSrc.indexOf("await server.connect(transport)"));
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    expect(pkg.scripts["install-claude-md"]).toBe("node dist/installClaudeMd.js");
  });

  it("prompts.ts não exporta mais planPrompt/buildPrompt, mas mantém ExploreMode", async () => {
    const mod = await import("../src/prompts.js");
    expect("planPrompt" in mod).toBe(false);
    expect("buildPrompt" in mod).toBe(false);
    const promptsSrc = readFileSync(path.join(repoRoot, "src", "prompts.ts"), "utf8");
    expect(promptsSrc).toMatch(/export type ExploreMode = "plan" \| "ask";/);
  });

  function registeredToolBlock(name: string): string {
    const needle = `registerTool(\n  "${name}"`;
    const start = indexSrc.indexOf(needle);
    expect(start, name).toBeGreaterThan(-1);
    const from = start + "registerTool(".length;
    const next = indexSrc.indexOf("registerTool(", from);
    return next === -1 ? indexSrc.slice(start) : indexSrc.slice(start, next);
  }

  it("execution tools append evidenceNote; read tools do not", () => {
    for (const tool of ["delegate", "fast_delegate"]) {
      const block = registeredToolBlock(tool);
      expect(block).toMatch(/budgetNote\(/);
      expect(block).toMatch(/evidenceNote\(\)/);
    }
    for (const tool of ["explore", "read_slice", "run_filtered", "web_lookup"]) {
      expect(registeredToolBlock(tool)).not.toMatch(/evidenceNote\(\)/);
      expect(registeredToolBlock(tool)).not.toMatch(/budgetNote\(/);
    }
  });

  it("wires the optional Jev gate after fan_out workers settle and the shadow around delegate work", () => {
    const fanOut = registeredToolBlock("fan_out");
    expect(fanOut.indexOf("const settled = await Promise.allSettled(runs);")).toBeLessThan(
      fanOut.indexOf("runFanOutConsensusGate("),
    );
    expect(fanOut).toContain("JEV_FANOUT_ENABLED");
    expect(fanOut).toContain("fanOutAgreementText(first.res.text, footer");
    const delegate = registeredToolBlock("delegate");
    expect(delegate).toContain("JEV_SHADOW_ENABLED");
    expect(delegate).toContain("const verified = verifyingWorker(work, prompt);");
    expect(delegate).toContain("withDelegateShadow(verified, prompt, level");
    expect(registeredToolBlock("fast_delegate")).toContain("return verifyingWorker(() => formatRun(");
  });

  it("alwaysLoad inclui as cinco core, fast_delegate, fan_out e rate", () => {
    // A lista EXIGE fast_delegate e fan_out — se alguém tirar qualquer um daqui o teste falha.
    const alwaysLoad = [
      "delegate", "fast_delegate", "explore", "read_slice", "run_filtered", "web_lookup",
      "fan_out", "rate",
    ];
    for (const tool of alwaysLoad) {
      expect(registeredToolBlock(tool)).toMatch(/_meta:\s*\{\s*"anthropic\/alwaysLoad":\s*true\s*\}/);
    }
    for (const tool of ["generate_image", "follow_up", "bridge_stats", "decide"]) {
      expect(registeredToolBlock(tool)).not.toMatch(/_meta:\s*\{\s*"anthropic\/alwaysLoad":\s*true\s*\}/);
    }
  });

  it("README lista as doze tools reais, sem linhas de plan/build", () => {
    for (const tool of [
      "delegate", "fast_delegate", "explore", "read_slice", "run_filtered",
      "web_lookup", "fan_out", "generate_image", "follow_up", "bridge_stats", "decide",
      "rate",
    ]) {
      expect(readme).toMatch(new RegExp(`^\\| \`${tool}\` \\|`, "m"));
    }
    expect(readme).not.toMatch(/^\| `plan` \|/m);
    expect(readme).not.toMatch(/^\| `build` \|/m);
    expect(readme).not.toMatch(/plan\(task\) then build\(plan\)/);
  });

  it("delegate e README descrevem a escada AA atual", () => {
    const ladder = "$0.07 → $0.21 (~3×) → $1.82 (~8.7×)";
    const delegate = registeredToolBlock("delegate");
    expect(delegate).toContain(ladder);
    expect(delegate).toContain("middle=GPT-6.1 Sol medium (codex)");
    expect(readme.replace(/\s+/g, " ")).toContain(ladder);
    expect(readme).toContain("middle=GPT-6.1 Sol medium (codex)");
  });

  it("footer orienta a continuar e avaliar a sessão", () => {
    expect(indexSrc).toContain("session_id: ${sessionHandle} (pass to follow_up to continue; grade it with rate(session_id, score 1-5))");
  });
});

describe("deny (delegate/fast_delegate)", () => {
  function registeredToolBlock(name: string): string {
    const start = indexSrc.indexOf(`registerTool(\n  "${name}"`);
    expect(start, name).toBeGreaterThan(-1);
    const next = indexSrc.indexOf("registerTool(", start + "registerTool(".length);
    return next === -1 ? indexSrc.slice(start) : indexSrc.slice(start, next);
  }

  it.each(["delegate", "fast_delegate"])("%s expõe deny no próprio inputSchema e repassa ao worker", (tool) => {
    const block = registeredToolBlock(tool);
    expect(block).toMatch(/deny: denySchema\.optional\(\)/);
    expect(block).toMatch(/async \(\{[^)]*\bdeny\b[^)]*\}\)/);
    expect(block).toContain("deny,");
    expect(block).toContain("denyNote(deny)");
    expect(block).toContain("not a security boundary");
  });

  it("deny não vai no objeto routing compartilhado", () => {
    const routing = indexSrc.slice(indexSrc.indexOf("const routing = {"), indexSrc.indexOf("};", indexSrc.indexOf("const routing = {")));
    expect(routing).not.toMatch(/\bdeny\b/);
  });

  it("README documenta deny em delegate e fast_delegate", () => {
    for (const tool of ["delegate", "fast_delegate"]) {
      const row = readme.split("\n").find((line) => line.startsWith(`| \`${tool}\` |`)) ?? "";
      expect(row).toContain("`deny`");
    }
  });
});
