#!/usr/bin/env node
import {
  CLAUDE_MD_PATH, nodeClaudeMdFs, PACKAGE_VERSION, renderPolyagentBlock, syncClaudeMd,
} from "./claudeMd.js";

// Instalação explícita do bloco gerenciado no CLAUDE.md global. `--dry-run` mostra o resultado sem gravar.
const dryRun = process.argv.includes("--dry-run");
const block = renderPolyagentBlock(PACKAGE_VERSION);
const result = syncClaudeMd(CLAUDE_MD_PATH, dryRun ? "dry-run" : "install", block, nodeClaudeMdFs);

console.log(`${CLAUDE_MD_PATH}: ${result.action}${result.legacyRemoved ? ", legacy <polyagent_preference> removed" : ""}`);
if (result.backupPath) console.log(`backup: ${result.backupPath}`);
if (dryRun) console.log(`\n${block}`);
