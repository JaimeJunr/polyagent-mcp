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
    expect(delegate).toContain("withDelegateShadow(work, prompt, level");
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

  it("footer orienta a continuar e avaliar a sessão", () => {
    expect(indexSrc).toContain("session_id: ${sessionHandle} (pass to follow_up to continue; grade it with rate(session_id, score 1-5))");
  });
});
