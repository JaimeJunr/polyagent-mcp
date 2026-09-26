#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  runCursor, EXPLORE_MODEL, EXPLORE_EFFORT, IMAGE_MODEL, DEFAULT_TIMEOUT_MS, budgetNote, evidenceNote,
  formatSessionHandle, parseSessionHandle, hasEngine, resolveTier, resolveFastTier, FAST_CANDIDATES,
  resolveDelegate, isDefaultTierEngine, withTerseStyle,
  raceFirstSuccess, CURSOR_ENABLED, sandboxPreflight, resolveAuxTool, resolveRunFiltered,
  type CliResult, type Engine,
} from "./cli.js";
import { resolveAgent } from "./agents.js";
import {
  isFullFileRequest, readSlicePrompt, runFilteredPrompt, explorePrompt, webLookupPrompt,
  generateImagePrompt, generateImageGrokPrompt, fanOutArbiterPrompt,
  appendDelegateRiskHint,
  type FanOutWorkerOutput,
} from "./prompts.js";
import {
  USAGE_LOG, logDecision, logRating, logUsage, readUsage, aggregate, computeEngineHealth, classifyOutcome, QUOTA_WINDOW_MS,
  ratingStats, renderRatingStats,
  type TierReceipt, type UsageRun,
} from "./usage.js";
import { scrubSecrets } from "./scrub.js";
import {
  askJev, JEV_MODEL, JEV_FANOUT_ENABLED, JEV_FANOUT_THRESHOLD, JEV_SHADOW_ENABLED,
  resolveOpenRouterKey, type AskJevParams,
} from "./jev.js";
import { fanOutAgreementText, runFanOutConsensusGate, withDelegateShadow } from "./jevDecisions.js";

const server = new McpServer(
  { name: "polyagent-mcp", version: "0.5.0" },
  {
    instructions:
      "polyagent-mcp offloads work to cheap headless CLIs so you do not spend your own context. Routing: pure reading or locating a specific slice → read_slice; mapping or searching the codebase → explore; running a noisy command and keeping only the signal → run_filtered; web or docs lookup → web_lookup; self-contained implementation, commits, PRs, multi-file edits, or running and fixing a build → delegate (level 1-5). Prefer these tools over native Read, Grep, WebSearch, or Bash for pure reading, locating, web lookup, and grunt work; use native Read only when you are about to edit that file. Worker tools return a session_id for follow_up; decide returns structured JSON. Results can be graded with rate.",
  },
);

const PROCESS_ENV = process.env;
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function askInternalJev(params: AskJevParams) {
  const key = resolveOpenRouterKey(PROCESS_ENV, (path) => readFileSync(path, "utf8"));
  return askJev(params, { fetch: (url, init) => globalThis.fetch(url, init), key });
}

// Params de roteamento compartilhados.
const routing = {
  cwd: z.string().optional().describe("Absolute path to the project root. Defaults to the server's cwd."),
  model: z
    .string()
    .optional()
    .describe("Cursor model id (e.g. 'auto', 'composer-2.5', 'gpt-5.2'). Default 'auto' (cheapest)."),
  effort: z
    .string()
    .optional()
    .describe("Reasoning effort for parameterized models (e.g. 'low'|'high'). Ignored by 'auto'."),
};

// Persona especializada, resolvida no host por resolveAgent. Compartilhada por delegate/fast_delegate.
const agentSchema = z.union([
  z.string(),
  z.object({ prompt: z.string(), name: z.string().optional(), model: z.string().optional() }),
]);
const agentDescription =
  "Run the worker as a specialized agent/persona. A name (e.g. 'pit:issue-investigator' or 'code-reviewer') is resolved from .claude/agents (project + home) and ~/.claude/plugins — its system prompt is injected via each engine's channel (claude --append-system-prompt, grok --rules, codex developer_instructions, cursor/opencode/kimi/muse prompt prefix). Or pass an inline { prompt } to skip file lookup. Works on every level/engine, not just claude.";

/**
 * Formata o resultado do Cursor: passa o texto pelo egress scrubber (scrubSecrets) antes do footer
 * de session_id, loga os chars devolvidos ao contexto (custo real) e — quando algo foi redigido —
 * loga também um evento "blocked_exfil". `tier` (opcional) carrega o tier-integrity receipt de
 * quem chamou o resolver (delegate/fast_delegate); tools sem tier omitem.
 */
function format(
  tool: string,
  res: CliResult,
  tier?: TierReceipt,
  run?: UsageRun,
): { content: { type: "text"; text: string }[] } {
  const sessionHandle = res.engine && res.sessionId
    ? formatSessionHandle(res.engine, res.sessionId)
    : res.sessionId;
  const footer = res.sessionId
    ? `\n\n---\nsession_id: ${sessionHandle} (pass to follow_up to continue; grade it with rate(session_id, score 1-5))`
    : "";
  const { text: scrubbed, redacted } = scrubSecrets(res.text);
  const text = scrubbed + footer;
  const usageRun = sessionHandle ? { ...run, sessionId: sessionHandle } : run;
  logUsage(tool, text.length, tier, usageRun);
  if (redacted) logUsage("blocked_exfil", text.length);
  return { content: [{ type: "text", text }] };
}

/** Saúde atual das engines a partir do log. I/O + Date.now() ficam aqui — os resolvers permanecem puros. */
function currentEngineHealth(): Record<string, number> {
  // O teto acompanha o budget real: sucesso dentro do timeout não deve parecer engine quebrada só por latência.
  // Janela curta (30 min) pra failure/timeout; janela longa (QUOTA_WINDOW_MS) pra cota — ver usage.ts.
  return computeEngineHealth(readUsage(), Date.now(), 30 * 60 * 1000, DEFAULT_TIMEOUT_MS, QUOTA_WINDOW_MS);
}

/**
 * Roda o worker e anexa engine/outcome/durationMs no log — inclusive em falha/timeout, senão o
 * computeEngineHealth nunca vê os negativos. Rejeita de novo após logar.
 */
async function formatRun(
  tool: string,
  engine: Engine,
  work: () => Promise<CliResult>,
  receipt?: TierReceipt,
  metadata?: Pick<UsageRun, "model" | "effort">,
): Promise<{ content: { type: "text"; text: string }[] }> {
  const started = Date.now();
  try {
    const res = await work();
    return format(tool, res, receipt, {
      ...metadata,
      engine: res.engine ?? engine,
      outcome: "success",
      durationMs: Date.now() - started,
    });
  } catch (err) {
    logUsage(tool, 0, receipt, {
      ...metadata,
      engine,
      outcome: classifyOutcome(err),
      durationMs: Date.now() - started,
    });
    throw err;
  }
}

/** Registra cada worker do fan_out, inclusive os que não vencem a corrida. */
async function runFanOutWorker(
  prompt: string,
  cwd: string | undefined,
  level: number,
  tier: { engine: Engine; model?: string; effort?: string },
): Promise<{ level: number; tier: typeof tier; res: CliResult }> {
  const started = Date.now();
  const receipt = { requestedLevel: level, matchedRequest: isDefaultTierEngine(level, tier.engine) };
  try {
    const res = await runCursor({ prompt, cwd, engine: tier.engine, model: tier.model, effort: tier.effort, force: true, tool: "fan_out" });
    const sessionId = res.sessionId
      ? formatSessionHandle(res.engine ?? tier.engine, res.sessionId)
      : undefined;
    logUsage("fan_out", 0, receipt, {
      engine: res.engine ?? tier.engine,
      model: tier.model,
      effort: tier.effort,
      sessionId,
      outcome: "success",
      durationMs: Date.now() - started,
    });
    return { level, tier, res };
  } catch (err) {
    logUsage("fan_out", 0, receipt, {
      engine: tier.engine,
      model: tier.model,
      effort: tier.effort,
      outcome: classifyOutcome(err),
      durationMs: Date.now() - started,
    });
    throw err;
  }
}

server.registerTool(
  "delegate",
  {
    _meta: { "anthropic/alwaysLoad": true },
    description:
      "Delegate a task to a headless coding-agent CLI — the cheap/fast worker with full tool access (read, edit, shell) in cwd. As the orchestrator, offload grunt-work here instead of spending your own expensive tokens: commits, opening/updating PRs, writing tickets/comments, small mechanical or 2-line edits, running a build/test and fixing it, and routine implementation. The `level` (1-5) picks a DISTINCT model+effort pair by task difficulty, a cost-benefit ladder on the codex/claude subscriptions, with AA estimated $/task (quota proxies) $0.07 → $0.37 (~5x) → $1.06 (~3x) → $1.82 (~1.7x) → $5.98 (~3.3x): 1=GPT-6 Luna max (codex, cheapest), 2=GPT-6 Sol high (codex), 3=GPT-6 Sol max (codex), 4=Claude Opus 5.5 high (claude), 5=Claude Opus 5.5 max (claude). Pick the lowest level that can do the job. An explicit `engine` overrides the tier, including `opencode`, `kimi` or `muse` for explicit provider/subscription calls; when it differs from the level's primary engine, pass the model expected by that engine because the tier model and effort are not inherited. COST WARNING: levels 4 and 5 are EXPENSIVE. Level 4 (Claude Opus 5.5 high) is 44% cheaper than its previous tier, but now spends the same Claude subscription as a Claude Code host; levels 4-5 and that host share quota. Level 5 (Claude Opus 5.5 max) costs ~3.3x level 4. Both are last resorts. Do NOT reach for 4 or 5 because a task 'feels important': use them only when a cheaper level already failed or the task genuinely needs frontier reasoning (hard debugging, cross-file impact, a review verdict that must hold). Levels 1-3 handle almost everything, including most implementation. Give a complete, self-contained instruction — the worker does not see your context.",
    inputSchema: {
      prompt: z.string().describe("The complete task prompt for the worker agent."),
      level: z
        .number()
        .int()
        .min(1)
        .max(5)
        .describe("Task difficulty 1-5, each a distinct model+effort: 1=GPT-6 Luna max (codex), 2=GPT-6 Sol high (codex), 3=GPT-6 Sol max (codex), 4=Claude Opus 5.5 high (claude), 5=Claude Opus 5.5 max (claude). Use the lowest level that fits. COST: 4 is expensive ($1.82/task AA proxy) and 5 costs ~3.3x more ($5.98); both spend the Claude Code host subscription — reserve both for tasks a cheaper level cannot do, never as a default."),
      engine: z
        .string()
        .optional()
        .describe("Explicit engine override: 'codex', 'grok', 'claude', 'cursor', 'opencode', 'kimi' or 'muse'. It beats the level's primary engine. With 'opencode', model must use the provider/model format (e.g. 'google/gemini-3.8-flash'). If it differs from the level's primary engine, the tier model and effort are not inherited."),
      agent: agentSchema.optional().describe(agentDescription),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max wall-clock ms for this delegation. Default 1800000 (30 min). Raise for unusually long build-heavy tasks."),
      ...routing,
    },
  },
  // Sem override, o nível escolhe engine+modelo+effort (resolveTier); engine explícita passa por
  // resolveDelegate. force: no sandbox o $HOME isolado tira o "trusted" do cursor-agent e todo
  // shell é rejeitado sem --force; grok/codex/opencode auto-aprovam por args.
  // `model`/`effort` explícitos do chamador ainda sobrepõem o tier quando aplicável.
  async ({ prompt, level, engine: engineParam, agent, timeout_ms, cwd, model, effort }) => {
    const tier = resolveDelegate(
      level,
      { engine: engineParam, model, effort },
      hasEngine,
      CURSOR_ENABLED,
      currentEngineHealth(),
    );
    // Resolve o agent no host (fora do sandbox): a persona vira string injetada por engine. O `model`
    // do frontmatter é advisory — o `model` explícito e o do tier vencem.
    const resolved = agent ? resolveAgent(agent, cwd ?? process.cwd()) : undefined;
    const work = () => formatRun(
      "delegate",
      tier.engine,
      async () => {
        const res = await runCursor({
          prompt: prompt + budgetNote(timeout_ms ?? DEFAULT_TIMEOUT_MS) + evidenceNote(),
          cwd,
          engine: tier.engine,
          model: tier.model,
          effort: tier.effort,
          agentPrompt: withTerseStyle(resolved?.prompt),
          force: true,
          timeoutMs: timeout_ms,
          tool: "delegate",
        });
        return { ...res, text: appendDelegateRiskHint(res.text, level) };
      },
      { requestedLevel: level, matchedRequest: isDefaultTierEngine(level, tier.engine) },
      { model: tier.model, effort: tier.effort },
    );
    return JEV_SHADOW_ENABLED
      ? withDelegateShadow(work, prompt, level, { ask: askInternalJev, log: logDecision })
      : work();
  },
);

server.registerTool(
  "fast_delegate",
  {
    _meta: { "anthropic/alwaysLoad": true },
    description:
      "Delegate a task to whichever coding-agent CLI is currently the fastest AND healthy — no level to pick. COST: the first two candidates are subscriptions (codex GPT-6 Luna medium, then Claude Haiku low, both marginal-zero); pay-per-token OpenRouter (mercury-2) is the 3rd fallback, used only when codex and claude are missing, quota-exhausted or unhealthy. The accepted cost of the Claude candidate is the subscription also used by a Claude Code host orchestrator. Same full read/edit/shell access as delegate, same worker (does not see your context). Prefer this over delegate for simple or urgent work where speed matters more than picking a level; use delegate with an explicit level when you need a specific difficulty/quality tier.",
    inputSchema: {
      prompt: z.string().describe("The complete task prompt for the worker agent."),
      agent: agentSchema.optional().describe(agentDescription),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max wall-clock ms for this delegation. Default 1800000 (30 min). Raise for unusually long build-heavy tasks."),
      ...routing,
    },
  },
  // A ordem observada escolhe engine+modelo+effort; overrides explícitos continuam vencendo.
  async ({ prompt, agent, timeout_ms, cwd, model, effort }) => {
    const tier = resolveFastTier(hasEngine, CURSOR_ENABLED, currentEngineHealth());
    const selectedModel = model ?? tier.model;
    const selectedEffort = effort ?? tier.effort;
    const resolved = agent ? resolveAgent(agent, cwd ?? process.cwd()) : undefined;
    return formatRun(
      "fast_delegate",
      tier.engine,
      () => runCursor({
        prompt: prompt + budgetNote(timeout_ms ?? DEFAULT_TIMEOUT_MS) + evidenceNote(),
        cwd,
        engine: tier.engine,
        model: selectedModel,
        effort: selectedEffort,
        agentPrompt: withTerseStyle(resolved?.prompt),
        force: true,
        timeoutMs: timeout_ms,
        tool: "fast_delegate",
      }),
      // matchedRequest reflete se saiu uma engine nativa (FAST_CANDIDATES) ou o fallback pro cursor
      // — sem isso, o downgrade pro cursor ficava indistinguível de um roteamento nativo no log.
      { requestedLevel: 0, matchedRequest: FAST_CANDIDATES.some((c) => c.engine === tier.engine) },
      { model: selectedModel, effort: selectedEffort },
    );
  },
);

server.registerTool(
  "explore",
  {
    _meta: { "anthropic/alwaysLoad": true },
    description:
      `Read-only codebase exploration, the cheap Explore. Prefer this over spawning the Explore subagent for locating/mapping code: Codex uses ${EXPLORE_MODEL} with explicit ${EXPLORE_EFFORT} effort by default (override with POLYAGENT_EXPLORE_EFFORT), keeps file dumps out of your context, and returns only the conclusion plus concrete file:line references. Three modes: (a) \`question\` alone → broad fan-out search across the repo (follows naming conventions, checks multiple locations) returning file:line refs; (b) \`question\`+\`files\` → scoped answer about those files; (c) neither → a general project map. It LOCATES, it does not review/audit — use a Task subagent for judgment.`,
    inputSchema: {
      question: z
        .string()
        .optional()
        .describe("What you want to know. Alone: a fan-out search (e.g. 'where is X defined', 'all call sites of Y'). With `files`: a question about them. Omit entirely for a general map."),
      files: z
        .array(z.string())
        .optional()
        .describe("Optional file paths to scope the exploration to (relative to cwd or absolute)."),
      breadth: z
        .enum(["medium", "thorough"])
        .optional()
        .describe("How wide to sweep on a fan-out search (no `files`). 'thorough' chases every plausible location/naming convention. Default 'medium'."),
      engine: z
        .string()
        .optional()
        .describe("Engine override for this call: 'codex' (default), 'grok', 'claude', 'opencode', 'kimi', 'muse' or 'cursor'. Beats POLYAGENT_EXPLORE_ENGINE. Codex defaults to POLYAGENT_EXPLORE_MODEL + POLYAGENT_EXPLORE_EFFORT (medium); explore is read-only: a non-codex engine needs the sandbox on."),
      ...routing,
    },
  },
  async ({ question, files, breadth, cwd, model, effort, engine: engineParam }) => {
    const { prompt, mode } = explorePrompt(question, files, breadth);
    // read-only (mode) com modelo+effort explícitos no codex por default. O worker localiza/mapeia sem editar.
    const { engine, model: auxModel, effort: auxEffort } = resolveAuxTool("explore", { engine: engineParam, model, effort });
    return formatRun(
      "explore",
      engine,
      () => runCursor({ prompt, cwd, engine, model: auxModel, effort: auxEffort, mode, agentPrompt: withTerseStyle(), tool: "explore" }),
      undefined,
      { model: auxModel, effort: auxEffort },
    );
  },
);

server.registerTool(
  "read_slice",
  {
    _meta: { "anthropic/alwaysLoad": true },
    description:
      `Read-only surgical read: the worker reads the given file(s) and returns ONLY the code relevant to \`want\` (exact lines with file:line), never the whole file. On Codex, the default is ${EXPLORE_MODEL} with explicit ${EXPLORE_EFFORT} effort (override with POLYAGENT_EXPLORE_EFFORT). Full-file/verbatim dump requests are refused by design and enforced before the worker is spawned. Use instead of Read when you need a specific function/section from large files — the full file never enters your context.`,
    inputSchema: {
      files: z.array(z.string()).min(1).describe("File paths to read from (relative to cwd or absolute)."),
      engine: z
        .string()
        .optional()
        .describe("Engine override for this call: 'codex' (default), 'grok', 'claude', 'opencode', 'kimi', 'muse' or 'cursor'. Beats POLYAGENT_READ_SLICE_ENGINE. Codex defaults to POLYAGENT_EXPLORE_MODEL + POLYAGENT_EXPLORE_EFFORT (medium); read_slice is read-only: a non-codex engine needs the sandbox on."),
      want: z.string().describe("What to extract, e.g. 'the login handler and its imports'."),
      ...routing,
    },
  },
  async ({ files, want, cwd, model, effort, engine: engineParam }) => {
    if (isFullFileRequest(want)) {
      return format("read_slice_refused", {
        text: [
          "read_slice refuses full-file dumps by design.",
          "The cost is paid twice: once by the worker reading the whole file, and again by the caller receiving the whole dump — exactly the waste read_slice exists to avoid.",
          `Requested file(s): ${files.join(", ")}.`,
          "If this was a narrow request misclassified by the heuristic, retry with `want` naming the specific symbol or section.",
          "To locate or understand a specific part, use explore(question, files). Use native Read only when you are about to edit the file.",
        ].join(" "),
      });
    }
    const { engine, model: auxModel, effort: auxEffort } = resolveAuxTool("read_slice", { engine: engineParam, model, effort });
    return formatRun(
      "read_slice",
      engine,
      () => runCursor({ prompt: readSlicePrompt(files, want), cwd, engine, model: auxModel, effort: auxEffort, mode: "ask", agentPrompt: withTerseStyle(), tool: "read_slice" }),
      undefined,
      { model: auxModel, effort: auxEffort },
    );
  },
);

server.registerTool(
  "run_filtered",
  {
    _meta: { "anthropic/alwaysLoad": true },
    description:
      "Run a shell command via the coding-agent worker and get back ONLY the relevant lines/summary — semantic filtering of huge output (build/test/log). Complements mechanical filters: use when the noise needs judgment to strip. The default cascade is codex GPT-6 Luna medium, then Claude Haiku low (both subscriptions); OpenRouter mercury-2 is only reached when both are missing, quota-exhausted or unhealthy, so the pay-per-token cost is a late fallback. The full output stays on the worker's side.",
    inputSchema: {
      command: z.string().describe("The exact shell command to run."),
      engine: z
        .string()
        .optional()
        .describe("Engine override for this call: 'codex', 'grok', 'claude', 'opencode', 'kimi', 'muse' or 'cursor'. Beats POLYAGENT_RUN_FILTERED_ENGINE. When omitted, uses the same FAST_CANDIDATES cascade as fast_delegate (codex GPT-6 Luna medium, then Claude Haiku, then OpenRouter mercury-2). run_filtered accepts any engine."),
      want: z.string().optional().describe("What matters in the output, e.g. 'only failing tests'. Omit for meaningful-signal-only."),
      ...routing,
    },
  },
  async ({ command, want, cwd, model, effort, engine: engineParam }) => {
    // sem mode → bypass total: rodar o comando (que pode escrever) É o propósito do tool.
    // force mantém a paridade quando o fallback é cursor. O worker filtra o output por relevância.
    // Default = cascata do fast_delegate (resolveFastTier); param/env ainda vencem.
    const { engine, model: auxModel, effort: auxEffort } = resolveRunFiltered(
      { engine: engineParam, model, effort },
      process.env,
      hasEngine,
      CURSOR_ENABLED,
      currentEngineHealth(),
    );
    return formatRun(
      "run_filtered",
      engine,
      () => runCursor({ prompt: runFilteredPrompt(command, want), cwd, engine, model: auxModel, effort: auxEffort, force: true, agentPrompt: withTerseStyle(), tool: "run_filtered" }),
      undefined,
      { model: auxModel, effort: auxEffort },
    );
  },
);

server.registerTool(
  "web_lookup",
  {
    _meta: { "anthropic/alwaysLoad": true },
    description:
      `Delegate a web/documentation lookup to Codex/${EXPLORE_MODEL} with real web search and explicit ${EXPLORE_EFFORT} effort by default (override with POLYAGENT_EXPLORE_EFFORT): library docs, API references, error messages, current versions. Cheap way to fetch info newer than your training data.`,
    inputSchema: {
      query: z.string().describe("What to look up on the web."),
      engine: z
        .string()
        .optional()
        .describe("Engine override for this call: 'codex' (default), 'grok', 'claude' or 'cursor'. Beats POLYAGENT_WEB_LOOKUP_ENGINE. Codex defaults to POLYAGENT_EXPLORE_MODEL + POLYAGENT_EXPLORE_EFFORT (medium); web_lookup requires web search, which only codex has."),
      ...routing,
    },
  },
  async ({ query, cwd, model, effort, engine: engineParam }) => {
    // read-only (mode:'ask' → filesystem intocado) + web:true liga a busca web do codex
    // (-c tools.web_search=true). approval_policy=never evita pendurar em headless.
    const { engine, model: auxModel, effort: auxEffort } = resolveAuxTool("web_lookup", { engine: engineParam, model, effort });
    return formatRun(
      "web_lookup",
      engine,
      () => runCursor({ prompt: webLookupPrompt(query), cwd, engine, model: auxModel, effort: auxEffort, mode: "ask", web: true, agentPrompt: withTerseStyle(), tool: "web_lookup" }),
      undefined,
      { model: auxModel, effort: auxEffort },
    );
  },
);

server.registerTool(
  "fan_out",
  {
    // Schemas deferidos perdem adoção, o mesmo problema que levou fast_delegate a alwaysLoad.
    _meta: { "anthropic/alwaysLoad": true },
    description:
      "Use for independent second opinions, comparing 2+ approaches/designs/options/alternatives, cross-checking a risky verdict before acting (mode:'consensus'), or broad research that splits into independent parts. Do not use for simple lookups, single-file edits, or tightly coupled sequential work: it runs several workers and costs several times a single delegate. It returns a compact digest; mode:'race' returns the first success, while mode:'consensus' compares all outputs and returns agreement/disagreement plus worker session_ids for follow_up.",
    inputSchema: {
      prompt: z.string().describe("The task prompt sent identically to every worker."),
      levels: z
        .array(z.number().int().min(1).max(5))
        .min(2)
        .describe("Which delegate tiers (1-5) to fan out to, one worker per entry. Repeat a level (e.g. [1,1,1]) to sample the same model N times instead of diversifying engines."),
      mode: z
        .enum(["race", "consensus"])
        .default("race")
        .describe("'race': return the first successful worker's result, skip the rest. 'consensus': wait for all, then return an arbiter digest + all session_ids."),
      ...routing,
    },
  },
  async ({ prompt, levels, mode, cwd }) => {
    const tiers = levels.map((level) => ({ level, tier: resolveTier(level) }));
    const runs = tiers.map(({ level, tier }) =>
      runFanOutWorker(prompt, cwd, level, tier),
    );

    if (mode === "race") {
      const { res, level, tier } = await raceFirstSuccess(runs);
      return format(
        "fan_out",
        res,
        { requestedLevel: level, matchedRequest: isDefaultTierEngine(level, tier.engine) },
        { engine: res.engine ?? tier.engine, model: tier.model, effort: tier.effort },
      );
    }

    const settled = await Promise.allSettled(runs);
    const outputs: FanOutWorkerOutput[] = settled.map((s, i) =>
      s.status === "fulfilled"
        ? { engine: s.value.tier.engine, level: s.value.level, sessionId: s.value.res.sessionId, text: s.value.res.text }
        : { engine: tiers[i].tier.engine, level: tiers[i].level, text: String(s.reason), error: true },
    );
    const footer = outputs
      .map((o) => `- ${o.engine} (level ${o.level})${o.sessionId ? `: ${formatSessionHandle(o.engine as Engine, o.sessionId)}` : o.error ? ": FAILED" : ": no session_id"}`)
      .join("\n");
    const successful = settled.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
    const gateStarted = Date.now();
    return runFanOutConsensusGate(
      successful.map((worker) => worker.res.text),
      JEV_FANOUT_ENABLED,
      JEV_FANOUT_THRESHOLD,
      (verdict) => {
        const first = successful[0];
        return format(
          "fan_out",
          { ...first.res, text: fanOutAgreementText(first.res.text, footer, verdict.probability) },
          undefined,
          {
            engine: first.res.engine ?? first.tier.engine,
            model: first.tier.model,
            effort: first.tier.effort,
            outcome: "success",
            durationMs: Date.now() - gateStarted,
          },
        );
      },
      async () => {
        const arbiterStarted = Date.now();
        let arbiter: CliResult;
        try {
          arbiter = await runCursor({
            prompt: fanOutArbiterPrompt(outputs),
            cwd,
            engine: "codex",
            model: EXPLORE_MODEL,
            mode: "ask",
            agentPrompt: withTerseStyle(),
            tool: "fan_out",
          });
        } catch (err) {
          logUsage("fan_out", 0, undefined, {
            engine: "codex",
            model: EXPLORE_MODEL,
            outcome: classifyOutcome(err),
            durationMs: Date.now() - arbiterStarted,
          });
          throw err;
        }
        return format(
          "fan_out",
          { ...arbiter, text: `${arbiter.text}\n\nWorker sessions (pass to follow_up):\n${footer}` },
          undefined,
          {
            engine: arbiter.engine ?? "codex",
            model: EXPLORE_MODEL,
            outcome: "success",
            durationMs: Date.now() - arbiterStarted,
          },
        );
      },
      { ask: askInternalJev, log: logDecision },
    );
  },
);

server.registerTool(
  "generate_image",
  {
    description:
      "Generate or edit bitmap images via the keyless codex or grok CLI image tools. Returns ONLY the saved file path (never image bytes) to preserve context. out_path must be inside cwd (the sandbox only mounts cwd).",
    inputSchema: {
      description: z.string().describe("What image to generate, or — when input_images is set — how to edit them. Free-form natural language."),
      out_path: z.string().describe("Where to save the resulting PNG, relative to cwd (the sandbox only mounts cwd, so paths outside it fail)."),
      input_images: z
        .array(z.string())
        .optional()
        .describe("Optional source image file paths to EDIT (relative to cwd). Omit to generate a fresh image."),
      engine: z
        .enum(["codex", "grok"])
        .optional()
        .describe("Image engine: 'codex' (gpt-image-2, default) or 'grok' (grok-4.5-build via Grok subscription). Both keyless."),
      cwd: z.string().optional().describe("Absolute path to the project root. Defaults to the server's cwd."),
    },
  },
  async ({ description, out_path, input_images, engine, cwd }) => {
    const eng = engine ?? "codex";
    if (!hasEngine(eng)) {
      return {
        content: [{
          type: "text" as const,
          text: eng === "grok"
            ? "generate_image requires the grok CLI — install it and run `grok login`."
            : "generate_image requires the codex CLI (for image_gen / gpt-image-2). Install codex and log in.",
        }],
      };
    }
    const prompt = eng === "grok"
      ? generateImageGrokPrompt(description, out_path, input_images)
      : generateImagePrompt(description, out_path, input_images);
    if (eng === "grok") {
      return formatRun(
        "generate_image",
        "grok",
        () => runCursor({ prompt, cwd, engine: "grok", force: true, tool: "generate_image" }),
        undefined,
      );
    }
    return formatRun(
      "generate_image",
      "codex",
      () => runCursor({
        prompt,
        cwd,
        engine: "codex",
        model: IMAGE_MODEL,
        effort: "low",
        force: true,
        images: input_images,
        tool: "generate_image",
      }),
      undefined,
      { model: IMAGE_MODEL, effort: "low" },
    );
  },
);

server.registerTool(
  "follow_up",
  {
    description:
      "Continue a previous Cursor session by session_id (returned by every other tool). The prior context lives on Cursor's side, so you don't resend it. When continuing a read-only session (explore/read_slice/web_lookup), pass mode:'ask' to keep it read-only — otherwise the resumed run regains full tool access.",
    inputSchema: {
      session_id: z.string().describe("The session id returned by a previous polyagent-mcp call."),
      question: z.string().describe("The follow-up question."),
      mode: z
        .enum(["plan", "ask"])
        .optional()
        .describe("Read-only mode to keep on the resumed session. Use 'ask' when continuing an explore/read_slice/web_lookup. Omit to continue a delegate with full tool access."),
      ...routing,
    },
  },
  // force: mesma razão do delegate — ao continuar uma sessão que roda shell (delegate/run_filtered),
  // o sandbox rejeita todo comando sem --force. mode:'ask' (quando passado) mantém o filesystem read-only.
  async ({ session_id, question, mode, cwd, model, effort }) => {
    const { engine, id } = parseSessionHandle(session_id);
    return format(
      "follow_up",
      await runCursor({ prompt: question, engine, resume: id, mode, cwd, model, effort, force: true, agentPrompt: withTerseStyle(), tool: "follow_up" }),
    );
  },
);

server.registerTool(
  "bridge_stats",
  {
    description:
      "Report this bridge's usage: calls and chars returned to context per tool (the real cost), plus local rating benchmarks when available. Requires POLYAGENT_LOG to be set so calls are logged; otherwise reports that logging is off.",
    inputSchema: {
      export: z.boolean().optional().describe("Also export the ratings markdown to research/bench/<YYYY-MM-DD>-ratings.md."),
    },
  },
  async ({ export: exportRequested }) => {
    const entries = readUsage();
    const stats = aggregate(entries);
    const ratings = ratingStats(entries);
    const ratingGroups = Object.keys(ratings);
    const tools = Object.keys(stats);
    const sections: string[] = [];
    if (tools.length) {
      const lines = tools
        .sort((a, b) => stats[b].totalOutChars - stats[a].totalOutChars)
        .map((t) => `${t}: ${stats[t].calls} calls, ${stats[t].totalOutChars} chars returned (avg ${stats[t].avgOutChars})`);
      sections.push(lines.join("\n"));
    }
    if (ratingGroups.length) {
      const table = renderRatingStats(ratings);
      const ratingCount = Object.values(ratings).reduce((sum, stat) => sum + stat.ratings, 0);
      sections.push(`Ratings (${ratingCount})\n${table}`);
      if (exportRequested) {
        const date = new Date().toISOString().slice(0, 10);
        const exportPath = join(REPO_ROOT, "research", "bench", `${date}-ratings.md`);
        try {
          mkdirSync(dirname(exportPath), { recursive: true });
          writeFileSync(exportPath, `# Bridge ratings — ${date} (${ratingCount} ratings)\n\n${table}\n`, "utf8");
          sections.push(`Ratings exported to ${exportPath}`);
        } catch {
          sections.push(`Could not export ratings to ${exportPath}.`);
        }
      }
    }
    if (!sections.length) {
      return {
        content: [
          { type: "text" as const, text: "No usage logged. Set POLYAGENT_LOG=/path/to/log.jsonl to enable logging." },
        ],
      };
    }
    return { content: [{ type: "text" as const, text: sections.join("\n\n") }] };
  },
);

server.registerTool(
  "rate",
  {
    _meta: { "anthropic/alwaysLoad": true },
    description:
      "Rate after you reviewed the result; ratings stay local in POLYAGENT_LOG and feed bridge_stats. Anchored scale: 5 = correct and complete, no fixes needed; 4 = correct, small gaps; 3 = usable after fixes; 2 = mostly wrong or incomplete; 1 = wrong, harmful, or hollow evidence (claimed checks that proved nothing).",
    inputSchema: {
      session_id: z.string().describe("The session_id footer handle to grade, such as codex:abc."),
      score: z.number().int().min(1).max(5).describe("Integer score from 1 to 5 using the anchored scale in this tool description."),
      note: z.string().optional().describe("Optional private note; secrets are scrubbed and the note is capped at 300 characters."),
    },
  },
  async ({ session_id, score, note }) => {
    if (!USAGE_LOG) {
      return { content: [{ type: "text" as const, text: "Ratings need POLYAGENT_LOG to be set; no rating was stored." }] };
    }
    const scrubbedNote = scrubSecrets(note ?? "").text;
    const stored = logRating(session_id, score, scrubbedNote);
    if (!stored) {
      return { content: [{ type: "text" as const, text: "Rating was not stored. Check that POLYAGENT_LOG is writable." }] };
    }
    const found = readUsage().some((entry) => entry.tool !== "rate" && entry.sessionId === session_id);
    const text = found
      ? `Rating stored for ${session_id}.`
      : `Rating stored for ${session_id}; session was not found in POLYAGENT_LOG and will remain unrouted.`;
    return { content: [{ type: "text" as const, text }] };
  },
);

server.registerTool(
  "decide",
  {
    description:
      "Ask TypeSafe's Jev System One model for a structured decision: calibrated probabilities for noul questions or a typed label with probabilities for choice questions, not free-form text. Useful for gating risky tool calls, classification, or verifying a worker's claim. Cheap (~$0.04/M input tokens, output free), ~0.5s, pay-per-token through OpenRouter.",
    inputSchema: {
      state: z
        .union([z.string(), z.record(z.unknown())])
        .describe("Current decision state as text or a JSON object."),
      questions: z
        .record(z.object({
          type: z.enum(["noul", "choice"]),
          instructions: z.string(),
          criteria: z.record(z.string()).optional(),
        }))
        .describe("Named questions. A choice question must include at least one criteria label and description."),
      model: z.string().optional().describe(`Jev model override. Defaults to ${JEV_MODEL}.`),
    },
  },
  async ({ state, questions, model }) => {
    const started = Date.now();
    try {
      const result = await askInternalJev({ state, questions, model });
      const latencyMs = Date.now() - started;
      const text = JSON.stringify({
        answers: result.answers,
        model: result.model ?? model ?? JEV_MODEL,
        usage: { cost: result.usage?.cost ?? null },
        latency_ms: latencyMs,
      });
      logUsage("decide", text.length, undefined, {
        engine: "jev",
        outcome: "success",
        durationMs: latencyMs,
      });
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      logUsage("decide", 0, undefined, {
        engine: "jev",
        outcome: "failure",
        durationMs: Date.now() - started,
      });
      throw error;
    }
  },
);

// Falha cedo se o sandbox obrigatório não puder ser montado — melhor não subir do que subir degradado.
sandboxPreflight();

const transport = new StdioServerTransport();
await server.connect(transport);
