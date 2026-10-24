import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { LEVELS, TIERS } from "./cli.js";

// Skill gerenciada, no mesmo molde do ai-memory: o bloco do CLAUDE.md fica sempre carregado e
// curto; a skill só entra quando a descrição casa com a tarefa, então carrega o "como usar bem"
// (prompt de worker, deny, follow_up, nota) que não cabe no contexto fixo. Gerada de TIERS para
// os níveis nunca divergirem do código.
export const SKILL_NAME = "polyagent";
export const SKILL_MARKER_PREFIX = "<!-- polyagent-mcp-managed: routing-skill";

// Claude Code lê ~/.claude/skills; Codex, OpenCode e demais clientes AGENTS-aware leem ~/.agents/skills.
export const SKILL_ROOTS: string[] = process.env.POLYAGENT_SKILL_ROOTS
  ? process.env.POLYAGENT_SKILL_ROOTS.split(":").filter(Boolean)
  : [join(homedir(), ".claude", "skills"), join(homedir(), ".agents", "skills")];
export const SKILL_BOOT_SYNC = !/^(off|0|false|no)$/i.test(process.env.POLYAGENT_SKILL ?? "");

export type SkillSyncMode = "boot" | "install" | "dry-run";
export type SkillSyncAction = "created" | "replaced" | "unchanged" | "skipped";

export interface SkillSyncResult {
  path: string;
  action: SkillSyncAction;
  reason?: string;
}

export interface SkillFs {
  read(path: string): string | undefined;
  write(path: string, text: string): void;
}

export const nodeSkillFs: SkillFs = {
  read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
  write: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
};

export function skillPath(root: string): string {
  return join(root, SKILL_NAME, "SKILL.md");
}

function tierLines(): string {
  return LEVELS
    .map((level) => {
      const { primary } = TIERS[level];
      return `- \`${level}=${primary.engine} ${primary.model} ${primary.effort ?? ""}`.trimEnd() + "`";
    })
    .join("\n");
}

export function renderPolyagentSkill(version: string): string {
  return `---
name: ${SKILL_NAME}
description: "Use whenever you are about to read, search or map code, run a command with noisy output, look something up on the web, hand off implementation (feature, bugfix, multi-file edit, build fix, commit, PR), compare two or more approaches, or get a costly verdict (review, root cause, migration) — even when polyagent is not named. Covers which polyagent tool fits, how to write a worker prompt that stands alone, picking a level, deny guardrails, handing over subagents and skills, follow_up and rating."
---
${SKILL_MARKER_PREFIX} v=${version} -->
<!-- Managed by polyagent-mcp: rewritten when the server starts. Remove this marker line to keep your own edits. -->

# polyagent

You are the orchestrator. polyagent runs the work on cheap headless CLIs (codex, claude, opencode) inside a
sandbox, and only the worker's conclusion enters your context. Your job is to route, brief and verify.

## Pick the tool

| You want to | Call |
| --- | --- |
| Map the repo, find where X lives, list call sites | \`explore(question)\` |
| A specific function or section of a known file | \`read_slice(files, want)\` |
| Run a build, test or log command and keep only the signal | \`run_filtered(command, want)\` |
| Docs, API reference, error message, current version | \`web_lookup(query)\` |
| Self-contained execution: code, edits, commits, PRs, fix a build | \`delegate(prompt, level)\` |
| Simple or urgent execution where speed beats picking a level | \`fast_delegate(prompt)\` |
| Choose between 2+ options, or a verdict costly to get wrong | \`fan_out(prompt, levels, mode: "consensus")\` |
| First acceptable answer across engines | \`fan_out(prompt, levels, mode: "race")\` |

Native Read stays for the file you are about to Edit. Steps that need an MCP server or a browser stay with you;
everything else in the same task can still be delegated.

## Write a worker prompt that stands alone

The worker sees nothing of this conversation. Every prompt says:

1. **Where:** the repo (\`cwd\`) and the files or area to touch.
2. **What:** one task, with the facts you already found (paths, error text, decisions). Never "as discussed".
3. **Done:** how to verify it, e.g. the exact test command, and what to report back.
4. **Limits:** what not to touch, and whether to commit.

Ask for the evidence denominator ("how many files did the check scan"), not just "it passed": an empty scan
also passes.

## Pick the level

${tierLines()}

AA quota proxies: $0.07 → $0.21 (~3×) → $1.82 (~8.7×). Start at the lowest level that can do it; low and
middle cover most implementation. Go to high only after a cheaper level failed, or for a frontier verdict
(hard debugging, cross-file impact, merge/no-merge). High shares the Claude Code subscription with you.

For \`fan_out\`, start with \`levels: ["low", "middle"]\`; add \`"high"\` only when they disagree or the verdict is costly.

## Guardrails

- \`deny\` on \`delegate\`/\`fast_delegate\` blocks commands inside the sandbox (exit 126):
  \`deny: ["git push", "git merge", "rm", "npx prisma migrate"]\`. Rules are a command plus the args that
  identify it. It catches commands on PATH, not scripts run by path (\`./manage.py\`) or indirect runs
  (\`npm run migrate\`). It is a guardrail against accidents, not a security boundary.
- \`explore\`, \`read_slice\` and \`web_lookup\` are read-only. \`delegate\`, \`fast_delegate\` and \`run_filtered\`
  have full access.

## Hand over subagents and skills

Workers do not load your subagents or skills on their own. Pass them through \`agent\`:

- subagent: \`agent: "<name>"\` (from \`.claude/agents\` or plugins);
- skill: \`agent: { skill: "<plugin:name>" }\`. Its SKILL.md becomes the persona and its folder is mounted read-only;
- inline persona: \`agent: { prompt: "..." }\`.

## After the result

- Verify before you report it done: check the diff, rerun the test, read the slice. A worker's "done" is a claim.
- Continue the same worker with \`follow_up(session_id, prompt)\` instead of resending context. When continuing
  \`explore\`/\`read_slice\`/\`web_lookup\`, pass \`mode: "ask"\` or the resumed run regains full access.
- Grade it with \`rate(session_id, score)\`: 5 correct and complete; 4 small gaps; 3 usable after fixes;
  2 mostly wrong; 1 wrong, harmful or hollow evidence. Rate the read tools too.

## When something fails

- An MCP server named \`codex\` failing says nothing about polyagent: it spawns the CLIs itself. Call the tool.
- A quota error names the engine or level that still has quota; use it. Rate limits mean wait, not switch.
- A timeout is a safety net (30 min by default): split the task instead of retrying it whole.
`;
}

/**
 * Sincroniza a skill numa raiz. Só sobrescreve arquivo com o marcador de posse, para nunca apagar
 * uma skill homônima escrita pelo usuário. `boot` só atualiza o que já foi instalado e nunca cria.
 */
export function syncSkill(root: string, mode: SkillSyncMode, text: string, fs: SkillFs): SkillSyncResult {
  const path = skillPath(root);
  const original = fs.read(path);
  if (original !== undefined && !original.includes(SKILL_MARKER_PREFIX)) {
    return { path, action: "skipped", reason: `same-name skill without the ${SKILL_MARKER_PREFIX} marker is user-owned` };
  }
  if (original === undefined && mode === "boot") return { path, action: "skipped", reason: "not installed" };
  if (original === text) return { path, action: "unchanged" };
  const action: SkillSyncAction = original === undefined ? "created" : "replaced";
  if (mode !== "dry-run") fs.write(path, text);
  return { path, action };
}
