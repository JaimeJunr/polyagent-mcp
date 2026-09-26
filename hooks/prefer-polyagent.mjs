#!/usr/bin/env node
/**
 * PreToolUse hook — nudges the agent toward polyagent instead of the
 * token-expensive native tools, at the moment of the call (text alone in
 * CLAUDE.md loses to structural friction; a call-time reminder wins).
 *
 * Configure "Read|Grep|Glob|WebSearch|WebFetch|Bash|Edit|Write" no PreToolUse,
 * UserPromptSubmit para dicas por intenção, e entradas SessionStart/SubagentStart.
 * Veja o README.
 *
 * Design constraints:
 *  - Cheap: only emits a nudge when it actually pays off (large whole-file
 *    Read, native web call, or the first exploration tool of a session).
 *    Never fires on small/surgical reads.
 *  - Dedup por sessão cobre nudge/redirect de PreToolUse, usando session_id no tmp.
 *    UserPromptSubmit avalia cada prompt isoladamente e não usa dedup.
 *  - Preload once: the first qualifying nudge of a session also carries the
 *    one-time reminder to run ToolSearch, because these MCP tools are deferred
 *    and lose to the always-loaded native Read/Grep until their schemas load.
 *  - Fail-open: web e Read grande podem ser bloqueados só uma vez; os demais
 *    casos apenas injetam `additionalContext`.
 *  - Never breaks the tool: any error → print nothing, exit 0.
 *
 * Env:
 *  - POLYAGENT_HOOK_MIN_LINES: line threshold for the Read nudge (default 300).
 *  - POLYAGENT_HOOK_MODE: off | nudge | redirect (padrão redirect).
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PARSED_MIN_LINES = Number(process.env.POLYAGENT_HOOK_MIN_LINES);
const MIN_LINES = Number.isFinite(PARSED_MIN_LINES) && PARSED_MIN_LINES > 0 ? PARSED_MIN_LINES : 300;
const HOOK_MODE = (process.env.POLYAGENT_HOOK_MODE ?? "redirect").toLowerCase(); // off | nudge | redirect
const BIG_BYTES = 2 * 1024 * 1024; // acima disto não conta linhas — já é "grande"
const SKIP_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|gz|tar|wasm|mp4|mov|woff2?)$/i;

const PRELOAD_TEXT =
  "Core polyagent tools, including fan_out, are marked alwaysLoad on Claude Code 2.1.121+; older " +
  "hosts may defer them. If a required schema is missing, run ToolSearch(\"select:mcp__polyagent__delegate," +
  "mcp__polyagent__fast_delegate,mcp__polyagent__explore,mcp__polyagent__read_slice," +
  "mcp__polyagent__run_filtered,mcp__polyagent__web_lookup,mcp__polyagent__fan_out,mcp__polyagent__rate\"). " +
  "Secondary tools (generate_image, follow_up, bridge_stats, decide) may be deferred; load one with " +
  "ToolSearch when needed. For pure reading/locating (no edit ahead), prefer explore/read_slice over Grep/Read.";

const WEB_TEXT =
  "polyagent available: prefer web_lookup(query) over native web tools — the Cursor agent reads the " +
  "pages and returns summary+links instead of dumping raw results into your context. Skip only if you " +
  "need the raw HTML/DOM to parse.";

// Comandos que PRODUZEM artefato barato (commit/PR/ticket/branch) — grunt-work a offloadar
// pro delegate. Read-only investigativo (status/diff/log/checkout) fica de fora: o orquestrador
// precisa entender o estado, e o rtk já filtra o ruído desses mecanicamente.
const BASH_MUTATE_RE =
  /\b(git\s+commit|git\s+push|git\s+worktree\s+add|gh\s+pr\s+create|gh\s+issue\s+create|bkt\s+pr\s+create)\b/;

const BASH_MUTATE_TEXT =
  "polyagent available: writing commits/PRs/tickets/branches is cheap grunt-work — hand it to " +
  "delegate(prompt) (the Cursor worker runs git/gh/bkt with full tool access) instead of spending " +
  "expensive orchestrator tokens. You stay the orchestrator; Cursor does the mechanical work.";

// Edit/Write → o agente está prestes a IMPLEMENTAR ele mesmo. 1×/sessão, lembra que uma
// tarefa self-contained pode ir INTEIRA pro delegate(prompt, level) em vez de gastar tokens
// caros de orquestrador. Não desencoraja editar — só reposiciona: delegar execução é o default.
const EDIT_DELEGATE_TEXT =
  "polyagent available: if this edit is part of a self-contained task (a feature, a bugfix, a " +
  "mechanical change across files, or running/fixing a build), hand the WHOLE task to " +
  "delegate(prompt, level) — the Cursor worker has full read/edit/shell access in cwd and runs cheap " +
  "(level 1 = GPT-6 Luna max on codex; levels 2-5 escalate across codex/claude) — instead of implementing " +
  "it yourself on expensive orchestrator tokens. You stay the orchestrator and verify the result. " +
  "Keep editing inline only for a quick one-off you're already positioned for.";

const PROMPT_ROUTE_HINTS = {
  fan_out:
    "This request asks for independent opinions or a comparison — polyagent fan_out runs them in parallel and can reconcile them (mode consensus); skip it if the task turns out simple.",
  web_lookup:
    "This request asks for current library or model information — polyagent web_lookup can check recent docs, releases, versions, or pricing.",
  run_filtered:
    "This request asks to run checks and report only failures — polyagent run_filtered can execute tests or a build and filter output to errors.",
  explore:
    "This request asks where code is defined — polyagent explore can locate the relevant file or symbol; use read_slice for a specific section.",
};

const FAN_OUT_PROMPT_RE =
  /\b(?:independent\s+(?:second\s+)?opinions?|second\s+(?:independent\s+)?opinions?|segunda\s+opini[aã]o|opini[oõ]es\s+independentes)\b|\bcompar\w*\b.{0,70}\b(?:approaches?|options?|alternatives?|designs?|abordagens?|op[cç][oõ]es|alternativas?|propostas?)\b|\bqual\s+(?:é|e|seria)\s+(?:(?:o|a)\s+)?melhor\b|\b(?:pr[oó]s?\s+e\s+contr[ao]s?|pros?\s+and\s+cons?|trade[- ]?offs?|veredito\s+confi[aá]vel|reliable\s+verdict|cross[- ]?check(?:ing)?|crosscheck(?:ing)?)\b/i;

const WEB_LOOKUP_PROMPT_RE =
  /\b(?:latest|newest|most\s+recent|current)\s+(?:version|release)\b|\b(?:version|vers[aã]o)\s+(?:is\s+)?(?:latest|newest|most\s+recent|mais\s+recente|mais\s+nova|ultima)\b|\b(?:mais\s+recente|mais\s+nova|ultima)\s+vers[aã]o\b|\bchangelog\b|\brelease\s+notes\b|\bnotas?\s+de\s+vers[aã]o\b|\b(?:docs?|documentation|documenta[cç][aã]o)\s+(?:for|of|about|da|do|de|sobre)\b|\b[a-z0-9@/_-]+\s+(?:docs?|documentation)\b|\b(?:pricing|prices?|pre[cç]os?|custo|cost)\b.{0,80}\b(?:model|modelo|api)\b|\b(?:model|modelo|api)\b.{0,80}\b(?:pricing|prices?|pre[cç]os?|custo|cost)\b/i;

const RUN_CHECK_PROMPT_RE =
  /\b(?:run|execute|start|rod(?:ar|a|e)|execut(?:ar|a|e))\b.{0,140}\b(?:tests?|testes|suite|su[ií]te|build)\b/i;
const REPORT_FAILURES_PROMPT_RE =
  /\b(?:report|show|return|list|include|print|output|tell|mostre|mostra|retorne|reporte|liste|apresente|imprima|diga|diz|dizer|fale|fala)\b.{0,80}\b(?:only|just|apenas|somente|s[oó])(?![\p{L}]).{0,50}\b(?:failures?|failed|errors?|falhas?|falh(?:ou|aram|ando)|erros?)|\b(?:only|just|apenas|somente|s[oó])(?![\p{L}]).{0,50}\b(?:failures?|failed|errors?|falhas?|falh(?:ou|aram|ando)|erros?).{0,80}\b(?:report|show|return|list|include|print|output|tell|mostre|mostra|retorne|reporte|liste|apresente|imprima|diga|diz|dizer|fale|fala)\b/iu;

const EXPLORE_PROMPT_RE =
  /\bonde\s+(?:fica|est[aá]|[eé]\s+definid[oa]|o\s+projeto)\b|\bem\s+que\s+(?:arquivo|ficheiro)\b|\bwhere\s+(?:is|are|does|do)\b|\bwhich\s+(?:files?|paths?|modules?|directories)\b/i;

/** Roteia prompts que pedem um tipo claro de trabalho; não mantém estado por sessão. */
export function promptRouteContext(prompt) {
  if (typeof prompt !== "string" || prompt.trim() === "") return null;
  if (FAN_OUT_PROMPT_RE.test(prompt)) return PROMPT_ROUTE_HINTS.fan_out;
  if (WEB_LOOKUP_PROMPT_RE.test(prompt)) return PROMPT_ROUTE_HINTS.web_lookup;
  if (RUN_CHECK_PROMPT_RE.test(prompt) && REPORT_FAILURES_PROMPT_RE.test(prompt)) {
    return PROMPT_ROUTE_HINTS.run_filtered;
  }
  if (EXPLORE_PROMPT_RE.test(prompt)) return PROMPT_ROUTE_HINTS.explore;
  return null;
}

/**
 * Texto injetado no SessionStart. O preload de carona no PreToolUse só dispara quando
 * o modelo usa a tool Grep/Read/etc — mas nas sessões reais ele "vai de Bash grep",
 * que não casa com nenhum matcher, então o preload nunca chegava. Injetar no início
 * da sessão fecha esse buraco: o lembrete existe ANTES da primeira decisão de tool,
 * independente de o modelo usar Bash grep ou a tool nativa.
 * @example sessionStartContext() // → "polyagent MCP ... Run ToolSearch(...) ONCE ..."
 */
export function sessionStartContext() {
  return (
    "polyagent MCP (fleet of cheap/fast coding-agent workers) is available. Core tools are marked alwaysLoad on Claude " +
    "Code 2.1.121+; older hosts may defer them, so use " +
    'ToolSearch("select:mcp__polyagent__delegate,mcp__polyagent__fast_delegate,mcp__polyagent__explore,' +
    'mcp__polyagent__read_slice,mcp__polyagent__run_filtered,mcp__polyagent__web_lookup,' +
    'mcp__polyagent__fan_out,mcp__polyagent__rate") if a required schema is missing. ' +
    "Secondary tools may be deferred; load generate_image, follow_up, bridge_stats, or decide with " +
    'ToolSearch("select:mcp__polyagent__generate_image,mcp__polyagent__follow_up,' +
    'mcp__polyagent__bridge_stats,mcp__polyagent__decide") when needed. For PURE reading/locating/web with no edit ahead, ' +
    "prefer explore/read_slice/run_filtered/web_lookup over Read, Grep, or Bash grep. " +
    "You are the ORCHESTRATOR, not the implementer: delegate(prompt, level) is your DEFAULT for BOTH " +
    "execution AND judgment. Prefer fast_delegate(prompt) over delegate for simple or urgent work where speed matters more than picking a level. Level 1 (GPT-6 Luna max on codex) for mechanical work — features, bugfixes, multi-file " +
    "edits, commits, PRs, tickets, grunt-work, running/fixing builds. Levels 4 and 5 (Claude Opus 5.5 high, " +
    "Claude Opus 5.5 max) are EXPENSIVE — 5 costs ~3.3x level 4. Both spend the Claude Code host subscription; level 4 is 44% cheaper than before but now shares host quota. Both are a last resort for real " +
    "reasoning — code review with a verdict, cross-file impact analysis, hard debugging. The Cursor worker " +
    "runs with full read/edit/shell access in cwd. The win of delegating execution AND judgment is context " +
    "economy: the worker's file reading and raw output never enter your context, whatever the tier. Hand " +
    "execution (level 1, GPT-6 Luna max) and judgment (levels 4 and 5, Opus 5.5 high/Opus 5.5 max) to delegate, then review the result; edit " +
    "inline only for a quick one-off you're already positioned for. Only spawn a Task subagent when you " +
    "need a SPECIALIZED agent with its own toolset (e.g. Playwright/MCP-backed reviewers). " +
    "For locating/mapping code, call the bridge's explore(question) DIRECTLY instead of spawning the " +
    "native Explore subagent — the bridge runs on GPT-6 Luna (cheap) while a spawned " +
    "Explore would run on your expensive model."
  );
}

// ---- Contexto do SubagentStart: ensina os subagentes sobre polyagent ----

/** Marcador mantido para compatibilidade com consumidores externos. */
export const CURSOR_BRIDGE_MARKER = "<cursor_bridge_preference>";

const AGENT_PREF_BODY =
  "polyagent MCP is available to you (a subagent) — the cheap/fast Cursor worker. For PURE " +
  "reading/locating/web where you will NOT edit the file, prefer it over native Read/Grep/Glob/" +
  "WebSearch/WebFetch: explore(question,files?) to map or answer, read_slice(files,want) for one " +
  "section of a large file, run_filtered(command,want) to strip noisy build/test output, " +
  "web_lookup(query) for docs/errors/versions. Core tools, including fan_out, are marked alwaysLoad " +
  "on Claude Code 2.1.121+; if a required schema is missing on an older host, use ToolSearch with its " +
  "mcp__polyagent__ name. Secondary tools (generate_image, follow_up, bridge_stats, decide) may be " +
  'deferred; load one with ToolSearch("select:mcp__polyagent__generate_image,mcp__polyagent__follow_up,' +
  'mcp__polyagent__bridge_stats,mcp__polyagent__decide") when needed. If you WILL edit a file, native Read is correct. This complements the context-mode ' +
  "routing above — both keep raw output out of your context; when both fit, either is fine. " +
  "Prefer fast_delegate to delegate for simple/urgent work where speed matters more than picking a level.";

// Reforço só para o subagente Explore: ele foi spawnado no modelo caro do orquestrador
// (o Explore herda o modelo da sessão, capado em Opus), então empurra TODO o trabalho de
// leitura pro polyagent, que roda no GPT-6 Luna barato — o shell caro só orquestra.
const EXPLORE_EXTRA =
  " You are an Explore run spawned on the orchestrator's expensive model: do ALL file reading and " +
  "locating via explore(question)/read_slice(files,want), which run on GPT-6 Luna (cheap) " +
  "and keep dumps out of your context. Use native Read only for a file you are about to edit.";

/**
 * Monta o contexto injetado antes do primeiro turno do subagente, com reforço
 * adicional quando o tipo informado pelo SubagentStart é o Explore nativo.
 * @example subagentStartContext("Explore") // → preferência + reforço do Explore
 */
export function subagentStartContext(subagentType) {
  return AGENT_PREF_BODY + (subagentType === "Explore" ? EXPLORE_EXTRA : "");
}

/**
 * Decisão pura: dada a chamada de tool e o conjunto de nudges já disparados nesta
 * sessão, retorna o nudge a emitir ({ keys, text, redirect }) ou null. As dependências
 * de fs são injetáveis para testes.
 * @example decide({ tool_name: "WebSearch", tool_input: {}, seen: new Set() })
 */
export function decide(input, deps = {}) {
  const stat = deps.statSync ?? statSync;
  const read = deps.readFileSync ?? readFileSync;
  const minLines = deps.minLines ?? MIN_LINES;
  const seen = input?.seen instanceof Set ? input.seen : new Set();
  const base = baseDecision(input, { stat, read, minLines }, seen);
  if (!base) return null;
  // O primeiro nudge da sessão carrega junto o lembrete único de preload.
  if (base.key !== "preload" && !seen.has("preload")) {
    return {
      keys: [base.key, "preload"],
      text: `${base.text}\n\n${PRELOAD_TEXT}`,
      redirect: base.redirect === true,
    };
  }
  return { keys: [base.key], text: base.text, redirect: base.redirect === true };
}

/** Decisão base por tipo de tool, já respeitando o dedup (`seen`). */
function baseDecision(input, { stat, read, minLines }, seen) {
  const tool = input?.tool_name;
  const ti = input?.tool_input ?? {};

  if (tool === "WebSearch" || tool === "WebFetch") {
    return seen.has("web") ? null : { key: "web", text: WEB_TEXT, redirect: true };
  }

  // Bash de MUTAÇÃO (commit/PR/ticket/branch) → offload pro delegate, 1× por sessão.
  if (tool === "Bash") {
    const cmd = typeof ti.command === "string" ? ti.command : "";
    if (!BASH_MUTATE_RE.test(cmd)) return null;
    return seen.has("bash-mutate") ? null : { key: "bash-mutate", text: BASH_MUTATE_TEXT };
  }

  // Edit/Write/MultiEdit → o agente vai implementar ele mesmo. 1×/sessão: reposiciona
  // delegate(level) como executor padrão de tarefa self-contained. O dedup evita cutucar
  // toda edição — o orquestrador ainda edita inline quando faz sentido.
  if (tool === "Edit" || tool === "Write" || tool === "MultiEdit") {
    return seen.has("edit-delegate") ? null : { key: "edit-delegate", text: EDIT_DELEGATE_TEXT };
  }

  // Grep/Glob disparam muito — por isso só o lembrete de preload, 1× por sessão.
  if (tool === "Grep" || tool === "Glob") {
    return seen.has("preload") ? null : { key: "preload", text: PRELOAD_TEXT };
  }

  if (tool === "Read") {
    const file = ti.file_path;
    // Já cirúrgico (offset/limit), sem path, ou binário → nada a sugerir.
    if (!file || ti.limit != null || ti.offset != null || SKIP_EXT.test(file)) return null;
    let lines;
    try {
      const size = stat(file).size;
      lines = size > BIG_BYTES ? Infinity : read(file, "utf8").split("\n").length;
    } catch {
      return null; // arquivo inexistente/ilegível → deixa o Read nativo errar.
    }
    if (lines < minLines) return null;
    const key = `read:${file}`;
    if (seen.has(key)) return null;
    const shown = lines === Infinity ? "very large" : `${lines}-line`;
    return {
      key,
      redirect: true,
      text:
        `polyagent available: ${file} is a ${shown} file. If you will NOT Edit it, use ` +
        `read_slice(files, want) to load only the needed lines instead of Read (which puts the whole ` +
        `file in context, re-billed every turn). If you will Edit it, native Read is correct.`,
    };
  }

  return null;
}

// ---- I/O wrapper (só roda quando invocado como hook, não no import de teste) ----

function seenPath(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(tmpdir(), `polyagent-nudged-${safe}.json`);
}

function loadSeen(p) {
  try {
    return new Set(JSON.parse(readFileSync(p, "utf8")));
  } catch {
    return new Set();
  }
}

function saveSeen(p, set) {
  try {
    // mode 0600: estado por sessão em tmp compartilhado não deve ser legível/gravável
    // por outros usuários (evita que influenciem o dedup). Best-effort.
    writeFileSync(p, JSON.stringify([...set]), { mode: 0o600 });
  } catch {
    // best-effort: falha ao persistir só significa que o nudge pode repetir.
  }
}

function nudge(text) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text } }),
  );
}

const FAILOPEN_SUFFIX =
  " — If that polyagent tool isn't loaded yet, run the ToolSearch preload first; if you genuinely need this native tool's raw result, just call it again and it will be allowed (this redirect fires only once).";

function denyRedirect(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason + FAILOPEN_SUFFIX,
      },
    }),
  );
}

async function main() {
  let data;
  try {
    data = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0); // sem input parseável → não atrapalha
  }
  // off = no-op total: SessionStart/SubagentStart/PreToolUse não emitem nada.
  if (HOOK_MODE === "off") process.exit(0);
  if (data?.hook_event_name === "SubagentStart") {
    try {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SubagentStart",
            additionalContext: subagentStartContext(data?.agent_type),
          },
        }),
      );
    } catch {
      // Fail-open: uma falha no contexto nunca impede o início do subagente.
    }
    process.exit(0);
  }
  if (data?.hook_event_name === "UserPromptSubmit") {
    try {
      // Cada prompt é avaliado por conta própria; esse evento não usa o dedup da sessão.
      const additionalContext = promptRouteContext(data?.prompt);
      if (additionalContext) {
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext },
          }),
        );
      }
    } catch {
      // Fail-open: falha no roteamento nunca impede o envio do prompt.
    }
    process.exit(0);
  }
  const sessionId = typeof data?.session_id === "string" && data.session_id ? data.session_id : "default";
  const path = seenPath(sessionId);
  if (data?.hook_event_name === "SessionStart") {
    // Marca "preload" como visto para o piggyback do PreToolUse não repetir o lembrete.
    const seen = loadSeen(path);
    seen.add("preload");
    saveSeen(path, seen);
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: sessionStartContext() },
      }),
    );
    process.exit(0);
  }
  const seen = loadSeen(path);
  const res = decide({ tool_name: data?.tool_name, tool_input: data?.tool_input, seen });
  if (!res) process.exit(0);
  for (const k of res.keys) seen.add(k);
  saveSeen(path, seen);
  if (HOOK_MODE === "redirect" && res.redirect) denyRedirect(res.text);
  else nudge(res.text);
  process.exit(0);
}

const isMain = () => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
};

if (isMain()) main();
