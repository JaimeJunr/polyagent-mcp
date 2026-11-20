# Making the agent use it (hooks, CLAUDE.md, skill)

**Managed `CLAUDE.md` block.** Run `npm run install-claude-md -- --dry-run` to preview, then
`npm run install-claude-md` (or `npx -p polyagent-mcp polyagent-mcp-install-claude-md`). It appends a
routing block to `~/.claude/CLAUDE.md` between `<!-- polyagent-mcp:begin … -->` and
`<!-- polyagent-mcp:end -->`, replaces an old hand-written `<polyagent_preference>` section, and saves
`CLAUDE.md.polyagent.bak`. From then on the server refreshes the block on each start (only when the
markers exist). Set `POLYAGENT_CLAUDE_MD=off` to stop that, or delete both markers.

**Managed `polyagent` skill.** Run `npm run install-skill -- --dry-run` to preview, then
`npm run install-skill` (or `npx -p polyagent-mcp polyagent-mcp-install-skill`). It writes
`polyagent/SKILL.md` into `~/.claude/skills` (Claude Code) and `~/.agents/skills` (Codex, OpenCode and
other AGENTS-aware clients); override the roots with `POLYAGENT_SKILL_ROOTS` (`:`-separated). The
`CLAUDE.md` block stays short because it loads every session; the skill loads only when the task matches
and carries the how-to: tool choice, a stand-alone worker prompt, levels, `deny`, handing over agents and
skills, `follow_up` and `rate`. Like ai-memory's skills, the file carries an ownership marker
(`<!-- polyagent-mcp-managed: routing-skill … -->`): a same-name skill without it is never overwritten,
and the server refreshes marked copies on each start. Set `POLYAGENT_SKILL=off` to stop that.

Registering the tools is not enough. Two structural forces push the agent back to
native tools: (1) the host rule "prefer the dedicated file/search tools", and (2) MCP
tools used to be **deferred** — the agent had to run a tool-search to load their schemas,
so always-loaded `Read`/`Grep`/`WebSearch` won by default. The server now publishes
**startup `instructions`** (routing boundary) and marks `delegate`, `explore`, `run_filtered`, `web_lookup`,
`fan_out`, and `rate` with
`_meta: { "anthropic/alwaysLoad": true }` (Claude Code ≥2.1.121) so their schemas load
eagerly. `fan_out` joined them after it was deferred and never got
called — the same adoption bug. The remaining secondary tools (`read_slice`, `generate_image`, `follow_up`,
`bridge_stats`, `decide`) stay deferred. Four fixes, strongest first:

**1. Call-time hook (recommended).** A `PreToolUse` hook that steers the agent toward
the bridge at the moment it reaches for a native tool — text in a config file loses under
pressure, a call-time reminder does not. This repo ships one at
[`hooks/prefer-polyagent.mjs`](../hooks/prefer-polyagent.mjs): it runs on `node`
(already required) and only fires where it pays. Default mode is **`nudge`**
(`POLYAGENT_HOOK_MODE=nudge`): emite `additionalContext` sem bloquear. Com `POLYAGENT_HOOK_MODE=redirect`,
WebSearch/WebFetch, Read grande e Bash de busca de código recebem `permissionDecision: "deny"` uma vez
e a ferramenta do bridge é indicada. Configure no `settings.json` do host Claude Code:

> **Breaking change (US-007):** The hook file was renamed from
> `hooks/prefer-cursor-bridge.mjs` to `hooks/prefer-polyagent.mjs`. Update any host
> `settings.json` entry that points to the old path.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node /abs/path/to/polyagent-mcp/hooks/prefer-polyagent.mjs", "timeout": 5 }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read|Grep|Glob|WebSearch|WebFetch|Bash|Edit|Write|MultiEdit|Agent|Task",
        "hooks": [
          { "type": "command", "command": "node /abs/path/to/polyagent-mcp/hooks/prefer-polyagent.mjs", "timeout": 5 }
        ]
      }
    ]
  }
}
```

`UserPromptSubmit` runs on every submitted prompt. That event has no matcher field; the hook's
`promptRouteContext()` detects routing cues and stays silent when none match. This path is
intentionally not deduplicated: each prompt is judged on its own.

For `PreToolUse`, each nudge/redirect fires **at most once per session** (deduplicated in a tmp
file keyed by `session_id`), because a repeated fire is worse than none: the agent learns
to ignore it *and* every fire costs tokens. Dedup keys are saved **before** emitting so
redirect is one-shot and fail-open (a second identical call is allowed through).

> - **`Read`** whole-file (no offset/limit) over `POLYAGENT_HOOK_MIN_LINES` lines →
>   **redirect** (default) or nudge toward `read_slice` (once per file). Partial reads are left alone.
> - **`WebSearch`/`WebFetch`** → **redirect** (default) or nudge toward `web_lookup` (once).
> - **`Grep`/`Glob`** → emits the one-time **preload** reminder to run the `ToolSearch` for any
>   still-deferred bridge tools (nudge only — never redirected). The dedup collapses them to a
>   single fire.
> - **`Bash`** com busca de código no primeiro segmento da pipeline (`grep`/`rg`/`egrep`/`fgrep`/
>   `ag`/`ack`/`find` ou `git grep`, após `rtk` ou atribuições de ambiente) → redirect uma vez para
>   `explore`/`read_slice`; em `nudge`, apenas `additionalContext`. Cada `&&` inicia nova pipeline.
>   `npm test | grep FAIL` e `ps aux | grep x` não disparam. Comandos que também gravam artefatos
>   não são redirecionados. O nudge existente de `git commit`/`push`, `git worktree add`,
>   `gh pr create`, `gh issue create`, `bkt pr create` tem prioridade.
> - **`Agent`/`Task`** → nudge uma vez por sessão para `delegate` com
>   `agent: "<subagent name>"`. A ferramenta nativa fica para etapas que exigem MCP servers ou
>   browser. Helpers `claude-code-guide` e
>   `statusline-setup` são isentos.
> - **`Skill`** não é tratada pelo hook desde 2026-10-25: o deny fazia o host empurrar até skills
>   básicas para um worker, embora usar a tool nativa seja válido. `delegate` ainda aceita
>   `agent: { skill: "plugin:name" }` quando o chamador escolhe esse handoff; o hook não o sugere.
> - **`Edit`/`Write`/`MultiEdit`** → once per session, reminds that a *self-contained* task
>   (feature, bugfix, mechanical multi-file change, build fix) can go **whole** to `delegate(prompt, level)`
>   — the selected worker edits with full access — instead of the orchestrator implementing
>   it on expensive tokens. It never blocks the edit (nudge only); the once-per-session dedup means
>   the orchestrator still edits inline freely (the nudge repositions execution, it doesn't police every edit).
> - The **first** qualifying fire of the session (whichever tool triggers it) also carries
>   that preload reminder, so secondary schemas get loaded even in a Read-only or web-only session.
> - Redirect deny reasons end with a fail-open suffix: if the bridge tool isn't loaded yet, run
>   ToolSearch first; if the native tool is genuinely needed, call it again and it will be allowed
>   (critical under headless `-p` so the agent never hard-stalls).

Set `POLYAGENT_HOOK_MODE=redirect` for the old blocking behavior, or `off` to disable.
To reset the dedup and see the fires again, start a new session (or delete
`polyagent-nudged-<session_id>.json` from your OS temp dir — `os.tmpdir()`,
e.g. `/tmp` on Linux, not necessarily `$TMPDIR`).

### Preloading at session start (`SessionStart`)

O `PreToolUse` cobre buscas via `Bash`, mas o hook de `SessionStart` injeta o preload
**antes da primeira decisão de ferramenta**, independentemente de como o agente busca.

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /abs/path/to/polyagent-mcp/hooks/prefer-polyagent.mjs", "timeout": 5 }] }
    ]
  }
}
```

On `SessionStart` the hook emits the `ToolSearch` preload as `additionalContext` and pre-marks
`preload` as seen in the session's dedup file, so the PreToolUse piggyback never repeats it.

### Reaching subagents too (`SubagentStart`)

The nudges above only steer the **main loop**. Spawned subagents never see them,
so wire the same hook for `SubagentStart` as well:

```json
{
  "hooks": {
    "SubagentStart": [
      {
        "hooks": [
          { "type": "command", "command": "node /abs/path/to/polyagent-mcp/hooks/prefer-polyagent.mjs" }
        ]
      }
    ]
  }
}
```

On `SubagentStart` the hook injects a compact polyagent preference into every
spawned subagent via `additionalContext` (`subagentStartContext(agent_type)`).
When `agent_type` is `Explore` it appends an extra line: that Explore run was spawned on the
orchestrator's expensive model (Explore inherits the session model, capped at Opus), so it should
route **all** reading through `explore`/`read_slice` (which run on GPT-6 Luna) and
keep the expensive shell to orchestration only.

> **Coexisting with context-mode.** The bridge and context-mode use separate channels
> (context-mode may still do its own thing; this hook only emits `additionalContext`),
> so they coexist cleanly — no `updatedInput` race, no delay, no import of
> context-mode's routing.

**2. Load deferred tools when needed.** `delegate`, `explore`, `run_filtered`, `web_lookup`, `fan_out`, and
`rate` are `alwaysLoad` on Claude Code ≥2.1.121. Older hosts may still defer their schemas. The
secondary tools (`read_slice`, `generate_image`, `follow_up`, `bridge_stats`, `decide`) remain deferred; load only
the ones a task needs. Add to your `CLAUDE.md`/`AGENTS.md`:

```
If a required core schema is missing on an older host, run tool-search for
`delegate, explore, read_slice, run_filtered, web_lookup, fan_out, rate`.
For secondary tools, load `generate_image`, `follow_up`, `bridge_stats`, or `decide` only when needed.
```

**3. Reconcile the conflict in `CLAUDE.md`.** State the precedence explicitly:

```
The host rule "prefer dedicated file/search tools" applies to the EDIT path (Edit needs the
file content → native Read). For PURE reading/locating/web (no edit), polyagent takes
precedence over native Read/Grep/Glob/WebSearch/WebFetch. Read a large file whole with native
Read ONLY when you are about to edit it.
```

**4. Delegate execution, not just exploration.** The bridge is not only for reading — `delegate`
runs implementation work with full read/edit/shell access, so the orchestrator shouldn't burn its
own tokens on self-contained tasks. State this in `CLAUDE.md` so the agent routes *doing*, not just
*finding*, to the cheap worker:

```
You are the ORCHESTRATOR. delegate(prompt, level) is the DEFAULT for BOTH execution AND judgment.
`level` is required: low=GPT-6 Luna max (codex), middle=GPT-6.2 Sol medium (codex),
high=GPT-6.2 Astra xhigh (codex). Numeric levels are rejected. Low/middle cover most work;
high is expensive and runs on codex; its reserve shares the Claude Code host subscription, so reserve it for tasks cheaper
levels cannot do. Codex holds all three primaries: exhausted Codex quota sends every level to its Claude reserve.
Exhausted Claude quota affects those reserves and the Claude Code host together. The worker has full read/edit/shell access
in cwd when you delegate. The constant win is context economy: the worker's raw output never enters
your context. Delegate it, then review the result; edit inline only for a quick one-off you're
already positioned for. Use delegate(prompt, level) for self-contained work. Pass agent:"name" or agent:{prompt:"..."} when the worker
needs a specialized persona.
```

AA index v5: Luna max 28 / US$0.15, Sol 6.2 medium 53 / cost not published, Astra xhigh 62 / ~US$2.5 estimated.
See the [GPT-6.2 decision and evidence](../research/2026-11-17-gpt-6-2-sol-astra.md).

