import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const indexSrc = readFileSync(path.join(repoRoot, "src", "index.ts"), "utf8");
const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

describe("tool surface (US-003)", () => {
  it("registra exatamente onze tools", () => {
    const calls = indexSrc.match(/server\.registerTool\(/g) ?? [];
    expect(calls).toHaveLength(11);
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
    expect(indexSrc).toMatch(/Worker tools return a session_id for follow_up; decide returns structured JSON\./);
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

  it("alwaysLoad inclui as cinco core E o fast_delegate (não é mais deferred)", () => {
    // A lista EXIGE fast_delegate — se alguém o tirar daqui o teste falha, não apenas "tolera".
    const alwaysLoad = [
      "delegate", "fast_delegate", "explore", "read_slice", "run_filtered", "web_lookup",
    ];
    for (const tool of alwaysLoad) {
      expect(registeredToolBlock(tool)).toMatch(/_meta:\s*\{\s*"anthropic\/alwaysLoad":\s*true\s*\}/);
    }
    for (const tool of ["fan_out", "generate_image", "follow_up", "bridge_stats", "decide"]) {
      expect(registeredToolBlock(tool)).not.toMatch(/_meta:\s*\{\s*"anthropic\/alwaysLoad":\s*true\s*\}/);
    }
  });

  it("README lista as onze tools reais, sem linhas de plan/build", () => {
    for (const tool of [
      "delegate", "fast_delegate", "explore", "read_slice", "run_filtered",
      "web_lookup", "fan_out", "generate_image", "follow_up", "bridge_stats", "decide",
    ]) {
      expect(readme).toMatch(new RegExp(`^\\| \`${tool}\` \\|`, "m"));
    }
    expect(readme).not.toMatch(/^\| `plan` \|/m);
    expect(readme).not.toMatch(/^\| `build` \|/m);
    expect(readme).not.toMatch(/plan\(task\) then build\(plan\)/);
  });
});
