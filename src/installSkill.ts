#!/usr/bin/env node
import { PACKAGE_VERSION } from "./claudeMd.js";
import { nodeSkillFs, renderPolyagentSkill, SKILL_ROOTS, syncSkill } from "./skill.js";

// Instalação explícita da skill gerenciada em cada raiz (Claude Code e clientes AGENTS-aware).
// `--dry-run` mostra o resultado sem gravar.
const dryRun = process.argv.includes("--dry-run");
const skill = renderPolyagentSkill(PACKAGE_VERSION);

for (const root of SKILL_ROOTS) {
  const result = syncSkill(root, dryRun ? "dry-run" : "install", skill, nodeSkillFs);
  console.log(`${result.path}: ${result.action}${result.reason ? ` (${result.reason})` : ""}`);
}
if (dryRun) console.log(`\n${skill}`);
