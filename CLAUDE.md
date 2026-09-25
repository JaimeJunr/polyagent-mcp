# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server (stdio) that lets any MCP host delegate to headless coding-agent CLIs: Codex, Grok,
Claude Code, and an opt-in Cursor fallback. The fleet handles implementation, project mapping,
surgical reads, filtered command output, and web lookups without putting the worker's full raw
context into the caller. The design goal of every tool is **context economy**: `format()` in
`src/index.ts` logs the char count returned to context, because that char count is the real cost
being optimized.

## Commands

```bash
npm run build      # tsc → dist/ (the published/registered artifact is dist/index.js)
npm run dev        # run the server from source via tsx (no build step)
npm test           # vitest run — all unit tests
npx vitest run test/cli.test.ts   # single test file
npx vitest run -t "resolveModel"  # single test by name
```

There is no linter configured. `npm run build` (tsc, `strict: true`) is the type-check gate.
`prepublishOnly` runs the build; only `dist/` is published (see `files` in `package.json`).

## Architecture

Eight small modules under `src/`, with pure logic covered by `test/*.test.ts`. The split exists so
the **pure logic is testable without spawning a worker process**:

- `index.ts` — MCP server + tool registrations (twelve tools: `delegate`, `fast_delegate`, `explore`,
  `read_slice`, `run_filtered`, `web_lookup`, `fan_out`, `generate_image`, `follow_up`,
  `bridge_stats`, `decide`, `rate`).
  Owns tool descriptions and the shared `routing` params (`cwd`/`model`/`effort`). The second arg
  to `new McpServer(...)` is an `instructions` string that states the routing boundary
  (read/locate/web/grunt-work → bridge tools; native Read only when about to edit). These load at
  **startup** and are visible to the host even while tool schemas are deferred — that is why they
  matter for adoption. The five core tools (`delegate`, `explore`, `read_slice`, `run_filtered`,
  `web_lookup`) plus `fast_delegate`, `fan_out`, and `rate` register with
  `_meta: { "anthropic/alwaysLoad": true }` so Claude Code (≥2.1.121) eagerly loads their schemas.
  Secondary tools (`generate_image`, `follow_up`, `bridge_stats`, `decide`) stay deferred.
  `fast_delegate` and `fan_out` were deferred and never got called — the same adoption bug that
  motivated alwaysLoad on the core five. `format()` appends the `session_id`
  footer and logs usage;
  `fan_out` consensus can use the optional Jev agreement gate before its Codex arbiter; a Jev
  failure or low agreement keeps the existing arbiter path.
  `follow_up` feeds that id back as `RunOpts.resume` so a prior worker session continues without
  resending its context — the footer and `follow_up` are two ends of the same loop.
  `follow_up` takes an optional `mode` — without it, a resumed session regains full tool access, so
  continuing a read-only session (`explore`/`read_slice`/`web_lookup`) must pass `mode:'ask'` to stay
  read-only. The default (no mode) is for continuing a `delegate`.
- `cli.ts` — the only module that touches the child process. `runCursor()` spawns the engine's CLI;
  `buildCursorArgs()`/`buildGrokArgs()`/`buildCodexArgs()`/`buildClaudeArgs()`/`buildOpencodeArgs()`/`buildKimiArgs()`/`buildMuseArgs()` (+ `buildArgs`
  dispatcher), `resolveModel()`, `parseCliJson()`/`parseCodexJsonl()`/`parseOpencodeJsonl()`/`parseKimiJsonl()`/`parseMuseJsonl()` (+ `parseOutput` dispatcher),
  `resolveTier()`, `resolveDelegate()`, `resolveFastTier()`, `resolveAuxTool()`, `resolveRunFiltered()`, `hasEngine()`, `binExists()`, `budgetNote()`, `evidenceNote()`
  are **pure** and unit-tested. Keep the spawn boundary here — do not spawn from elsewhere.
- `agents.ts` — resolves an optional `delegate`/`fast_delegate` persona on the host. A name such as
  `pit:issue-investigator` searches project/home `.claude/agents` and `~/.claude/plugins`; plugin
  collisions pick the newest match by mtime. An inline `{prompt}` skips lookup. Only the markdown
  body crosses into the worker, and names containing `/` or `..` are rejected.

### Engines & tiers (multi-CLI)

The bridge drives seven coding-agent CLIs, each with its own dialect and output format —
`RunOpts.engine` (`"cursor"|"grok"|"codex"|"claude"|"opencode"|"kimi"|"muse"`) selects one. Cursor is outside the default
tier path; it is available as a fallback only when `POLYAGENT_ENABLE_CURSOR=1`
(`CURSOR_ENABLED`).

- **cursor** (`cursor-agent`) — opt-in fallback only. `POLYAGENT_CURSOR_BIN` defaults to
  `cursor-agent`, NOT `agent` (in the user's PATH `agent` may be the grok binary). Dialect:
  `-p <prompt>` positional, `--trust`, effort encoded in model ids, `--force`. Output
  `{result, session_id}`. Its default model id is `composer-2.5-fast`; the old
  `composer-2.5[fast=true]` bracket is invalid now.
- **grok** (`grok`) — dialect: prompt is the VALUE of `--single`, `--effort` is a separate
  flag, autonomy is `--always-approve` (not `--force`). Output `{text, sessionId}`.
- **codex** (`codex exec`) — dialect: `exec` subcommand, JSONL output (`--json`, parsed by
  `parseCodexJsonl` → last `agent_message`), effort via `-c model_reasoning_effort=`, autonomy via
  `--dangerously-bypass-approvals-and-sandbox`, plus `--ignore-user-config`/`--ignore-rules` so it
  never loads `~/.codex/config.toml` (whose MCP servers hung the CLI, spawning runaway `mcp-server`
  procs). `parseCliJson` is tolerant of cursor AND grok single-object shapes; codex uses the JSONL parser.
  Session id: codex emits it as **`thread_id`** in the `thread.started` event (NOT `session_id`) —
  `parseCodexJsonl` reads `thread_id` (with `session_id` as fallback), else `follow_up` on a Codex
  delegate loses the session. Resume is a **subcommand**, not a flag: `buildCodexArgs` emits
  `exec resume <id> <prompt>` when `opts.resume` is set (cursor uses `--resume`, grok `-r`).
- **claude** (`claude -p`) — headless dialect: `-p --output-format json --strict-mcp-config
  --setting-sources project`; never add `--bare`, because it breaks auth with `Not logged in`.
  Output is `{result, session_id}` and deliberately reuses `parseCliJson` (no Claude-only parser).
  Resume uses `--resume`; force OR mode always adds `--dangerously-skip-permissions`, because
  headless Claude otherwise hangs waiting for approval.
- **opencode** (`opencode run`) — prompt positional, `--format json` emits JSONL events, `-m` requires
  `provider/model`, effort maps to `--variant`, resume uses `-s`; the CLI also offers last-session
  continuation via `-c`, but the bridge does not use `-c`. Autonomy uses `--auto`, persona uses a
  prompt prefix, and cwd uses `--dir`. The positional prompt follows `--`. It is pay-per-token, so it
  stays excluded from `TIERS` (pick it via `delegate.engine` or an auxiliary tool's engine override).
  It is the third `FAST_CANDIDATES` entry (`openrouter/inception/mercury-2`) — pay-per-token
  fallback after the first two subscription candidates (codex GPT-6 Luna medium, then Claude Haiku
  low) are missing, quota-exhausted or unhealthy. The common `fast_delegate` path is subscription;
  OpenRouter spend only happens after both codex and claude fail. It has no engine-level read-only
  mode; bwrap supplies that guard.
- **kimi** (`kimi -p`) — headless prompt via `-p`, `--output-format stream-json`, model via `-m`,
  resume via `-S`. `-p` already is non-interactive and **rejects** `--auto`/`-y`/`--yolo`; persona
  is a prompt prefix. No engine-level read-only; bwrap supplies that guard. Subscription OAuth, so
  it is in `quotaCandidates` but **not** in `TIERS`, `FAST_CANDIDATES`, or `FALLBACK_ENGINE_ORDER`.
- **muse** (`muse exec`) — dialect: `exec <PROMPT>` positional, JSONL via `--json` (parsed by
  `parseMuseJsonl`), model via `--model`, effort via `--reasoning-effort` (none|minimal|low|medium|high|xhigh|max|ultra,
  default high), resume via `--session-id <uuid>` on the same `exec` (do **not** use the interactive
  `muse resume` subcommand). Autonomy is `--approval-mode never` under force OR mode — **never**
  `--yolo`, which would also disable muse's internal sandbox; bwrap already covers isolation.
  Persona is a prompt prefix (the `--agents <JSON>` flag exists but its JSON shape is unconfirmed —
  do not invent it). The positional prompt follows `--`. Session id lives in `stream.id` when
  `stream.kind == "session"`; response text is concatenated `payload.text` from
  `payload_type == "run.output.delta"` events — ignore `turn.input.user` (that is the prompt).
  It is pay-per-token (API key in `~/.config/muse/auth.json`), so it is excluded from `TIERS` and
  `FAST_CANDIDATES`; choose it explicitly via `delegate.engine` or an auxiliary tool's engine
  override. It enters `quotaCandidates` but **not** `FALLBACK_ENGINE_ORDER` (that list is a codex
  environment-failure retry, and `fallbackOpts` drops `mode`, which would collapse the read-only
  guarantee). It has no engine-level read-only (`engineReadOnly: false`); bwrap supplies that guard.
  `--provider echo` exercises the dialect without token cost.

`delegate` takes a required `level` (1-5) → `resolveTier` maps difficulty to (engine, model, effort),
using a distinct model+effort pair at every level, all on subscriptions (codex + claude) — a Pareto
cost-benefit ladder where each step costs ~3× the previous one (see
`research/2026-09-23-tier-pareto.md`): 1=GPT-6 Luna max
(codex), 2=GPT-6 Sol high (codex), 3=GPT-6 Sol max (codex), 4=GPT-6 Astra max (codex),
5=Claude Opus 5.5 max (claude). Os ids `gpt-6-astra` foram confirmados em execução real em
2026-09-14; `gpt-6-luna`, `gpt-6-sol` e `claude-opus-5-5`, em 2026-09-23. O alias `opus` ainda resolve para o `claude-opus-5` antigo — use sempre `claude-opus-5-5`. **Custo:** os níveis 4 e 5 são caros — o 4 muito caro e o 5 muitíssimo mais, com
folga o mais caro da matriz. São último recurso, não default: níveis 1-3 dão conta da maior parte do
trabalho, implementação inclusa. Escalar para 4/5 só quando um nível barato já falhou ou a tarefa
exige raciocínio de fronteira de verdade. Como codex ocupa 4 dos 5 níveis, cota estourada nele derruba os níveis 1 a 4 de uma vez.
Consequência aceita: Grok 4.6 saiu da matriz em 2026-09-23 (mesma nota do Sol xhigh a 3,5× o custo)
e a assinatura Google já estava de fora — ver `research/2026-09-18-agy-google-cli.md`. `resolveTier(level, has, cursorEnabled)` uses the preferred CLI when present. If it
is missing, it falls back to the equivalent Cursor model only when `cursorEnabled` is true;
otherwise it throws a clear error naming the missing CLI.

`fast_delegate` has no level. `resolveFastTier(has, cursorEnabled, health)` picks the first installed,
healthy candidate in `FAST_CANDIDATES` (GPT-6 Luna medium → Claude Haiku low → OpenCode
mercury-2 → Grok 4.5 low), then the opt-in Cursor `DEFAULT_MODEL` as the final fallback. The first
two candidates are **subscriptions** (codex and claude); the third is **pay-per-token** (OpenRouter
API key / mercury-2). The Claude subscription candidate deliberately uses the same subscription as a
Claude Code host orchestrator. On the common path `fast_delegate` is marginal-zero cost; it only
spends real money on OpenRouter when codex and claude are missing, quota-exhausted or unhealthy.

Older historical measurement (host, `runCursor`, sandbox on, same long-output prompt, 2 runs):
mercury-2 7006ms (7885, 6126); haiku 10736ms (11330, 10141); grok-4.5 low 16301ms; GPT-6 Luna
was not measured because codex quota was exhausted. Discarded: gemini-flash-lite-latest (unstable,
18519ms with a 30s outlier), gpt-oss-120b OpenRouter (19251ms), groq gpt-oss-120b (120s timeout +
wrong answer). The 2026-09-23 bench (40 real runs via `runCursor` + bwrap) measured Luna medium
8/8, median 10.8s, worst 13.1s; Luna low 8/8, median 11.8s, worst 15.4s; Haiku 6/6, median
10.4s, worst 13.7s; mercury-2 5/6, median 14.8s, worst 240s timeout; Grok had no quota.
See `research/2026-09-23-aux-tools-bench.md`. It keeps the same full read/edit/shell access,
persona resolution, timeout budget note, and explicit `model`/`effort` overrides as `delegate`.
- `prompts.ts` — pure prompt builders (`readSlicePrompt`, `runFilteredPrompt`, `explorePrompt`,
  `webLookupPrompt`, `generateImagePrompt`, `fanOutArbiterPrompt`). The tools' behavior lives in these prompt strings,
  so changing a tool's contract usually means editing a prompt here (and its test), not `cli.ts`.
- `usage.ts` — JSONL usage log behind `POLYAGENT_LOG`; drives the `bridge_stats` and `rate` tools.

### Ratings (`rate`)

Ratings stay local in the JSONL file configured by `POLYAGENT_LOG`; `rate` stores only the session
handle, 1–5 score, and scrubbed note, never prompts or results. `ratingStats` joins each rating to
the last usage entry with the same `sessionId` and groups engine/model/effort/tool. The anchored
scale is 5 = correct and complete, no fixes needed; 4 = correct, small gaps; 3 = usable after
fixes; 2 = mostly wrong or incomplete; 1 = wrong, harmful, or hollow evidence (claimed checks that
proved nothing). `bridge_stats(export:
true)` writes the table to `research/bench/<YYYY-MM-DD>-ratings.md`.

### Jev (`decide`)

The HTTP boundary lives in `src/jev.ts`, separate from `cli.ts` and its process-spawn boundary.
Jev is not an engine and is not part of `TIERS` or `FAST_CANDIDATES`. Key resolution checks
`OPENROUTER_API_KEY`, then `.openrouter.key` in `~/.local/share/opencode/auth.json`. It is a
pay-per-token OpenRouter call. `decide` is secondary/deferred and has no `anthropic/alwaysLoad` metadata.
Two internal uses are off by default. `POLYAGENT_JEV_FANOUT=1` asks Jev whether at least two
successful `fan_out` consensus workers substantially agree; probability at or above
`POLYAGENT_JEV_FANOUT_THRESHOLD` (default 0.85) returns the first successful output and worker
session handles without the Codex arbiter. A low probability, malformed answer, missing key, or
Jev error or a 5-second timeout runs the existing arbiter. `POLYAGENT_JEV_SHADOW=1` asks Jev for a `delegate` level in
parallel after starting the worker; it records the suggestion but never changes the requested
level, and waits at most 5 seconds after the worker finishes. For `fan_out` agreement, each scrubbed
worker output keeps roughly one-quarter head and three-quarters tail within its character budget,
including an elision marker, because verdicts live at the end and head-only clipping caused 24/24
false skips in the benchmark. Both paths redact credential-shaped
strings and use bounded task/output
text and `logDecision` in `src/usage.ts`: JSONL entries have `tool:"decide"`, `engine:"jev"`,
zero returned chars, and a `decision` object with candidates, choice, confidence, acceptance,
fallback, latency, optional cost, and the requested level for shadow. Jev calls cost OpenRouter
tokens; enable these flags deliberately. `src/jevDecisions.ts` keeps request/verdict logic pure
and injects Jev/log dependencies for orchestration tests.

### The sandbox (default-on, mandatory for ALL engines, in `cli.ts`)

`runCursor` wraps the spawn in **bubblewrap (`bwrap`)** with an isolated `$HOME`, so each CLI can't
load the user's global behavior config (`~/.cursor/rules`, `~/.grok/config.toml`,
`~/.codex/config.toml`, `~/.claude/settings`, `mcp.json`, hooks, skills). That config was the real
cost: it inflated every call to ~57k input tokens and made the CLI try to spin up the user's MCP
servers on each run (the "hangs until timeout" symptom).
Sandboxed, a trivial call drops to ~11k input tokens (−80%). Only auth + toolchains are bound in; the
workspace (`cwd`) is bound RW as the last mount. Per-engine HOME binds are declared in
`SANDBOX_ENGINE_RO` and `SANDBOX_ENGINE_RW`: grok and codex need their engine homes RW; OpenCode gets
`~/.opencode` RO for installation and `~/.local/share/opencode` RW for sessions, logs, auth and
SQLite (including WAL/SHM), plus `~/.local/state/opencode` RW for locks; Muse gets RW
`~/.config/muse` (auth.json, settings, trust) and `~/.local/share/muse` (sessions, skills, plugins,
runtime, SQLite) — two directories, and `.local` requires an explicit RW declaration because
`SANDBOX_HOME_RO` mounts `~/.local` whole as RO. Claude gets
RO `~/.claude.json`, and RW
`~/.claude/{.credentials.json,statsig,projects,todos,shell-snapshots}`. The credential is RW on
purpose: the CLI renews the subscription oauth and must persist the new pair. Mounted RO, the
refresh fails with `EROFS` and the already-rotated refresh token stays burned on disk, taking down
the host's whole auth with `401 OAuth token has been revoked` — not just the worker. Never bind all of `~/.claude`: agent personas
are resolved on the host and injected as strings, preserving config and cost isolation. Design
points, all in `cli.ts`:

- **stdin MUST be closed (`stdio: ["ignore",…]`).** `codex exec` hangs forever ("Reading additional
  input from stdin…") if stdin is an open pipe — this, NOT the namespace, was why codex appeared to
  "not survive the sandbox". With stdin closed, codex runs in the bwrap like the others (~9s).
  cursor, grok, claude, opencode, kimi, and muse take the prompt by arg and never read stdin, so closing it is
  safe for all of them.
- **codex config is neutralized by flags, not just the sandbox:** `buildCodexArgs` always passes
  `--ignore-user-config`/`--ignore-rules` so `~/.codex/config.toml` (with its external MCP servers,
  which spawned runaway `mcp-server` procs) is never loaded; auth still resolves via `CODEX_HOME`.
- **`CODEX_HOME` is bound dynamically when it points outside `~/.codex`.** External account managers
  (e.g. the orca desktop app) route multiple codex logins by exporting `CODEX_HOME` to a path like
  `~/.config/orca/codex-accounts/<uuid>/home` per pane/workspace, inherited by whatever spawns the
  bridge's MCP server. The static `SANDBOX_ENGINE_RW` list only knows the conventional `~/.codex`, so
  without this the sandbox's `isoHome` overlay hides the real account entirely — codex fails to init
  (missing dir, or "Read-only file system" trying to write into an invisible path). `buildSandboxSpec`
  adds `process.env.CODEX_HOME` to `homeRw` for the codex engine whenever it's set and the directory
  exists. Even so, treat any codex environment failure as possibly host-specific and recoverable: see
  `isCodexEnvError`/`FALLBACK_ENGINE_ORDER` below.
- **`isCodexEnvError(stderr)` + `FALLBACK_ENGINE_ORDER` retry codex failures on another engine.**
  `runCursor` catches a codex exit whose stderr matches `isCodexEnvError` (CODEX_HOME pointing at a
  deleted directory, or the in-process app-server failing to init on a read-only path) and retries the
  *same prompt* once on the next available engine in `FALLBACK_ENGINE_ORDER` (`grok` → `claude`, plus
  `cursor` under `CURSOR_ENABLED`), dropping the codex-specific `model`/`effort` and appending a
  `[note: codex unavailable ...]` suffix to the result. This is host-agnostic by design — it isn't an
  orca-specific patch, since any host that mismanages `CODEX_HOME` hits the same failure. Non-env
  codex errors (auth, rate limit, bad prompt) are NOT retried — they propagate as-is.
  Cota esgotada e rate limit continuam **sem retry automático** — só a falha de ambiente cai no
  `FALLBACK_ENGINE_ORDER`. Mas não propagam mais crus: `classifyQuotaError({stdout, stderr,
  exitCode}, engine)` lê primeiro os campos JSON estruturados de **stdout** (é lá que o sinal vive) e
  só depois aplica regex sobre as mensagens extraídas, devolvendo `quota_exhausted` | `rate_limited`
  | `null`. `runCursor` converte o acerto em `QuotaError` com mensagem acionável — `quotaCandidates`
  monta a lista de engines instaladas, habilitadas (`CURSOR_ENABLED`) e capazes do que a tool exige
  (intersecção com `AUX_TOOL_REQUIREMENTS`/`ENGINE_CAPABILITIES`), e `quotaErrorMessage` escolhe a
  forma da sugestão pela superfície da tool: `engine:"<x>"` nas quatro auxiliares, `level:<n>` (menor
  nível cuja engine primária sobrou) no `delegate`, nenhuma em `fast_delegate`/`fan_out`, a lista
  restrita a codex/grok em `generate_image` (as duas com tool de imagem própria), e "presa à sessão"
  em `follow_up`. É por isso que `RunOpts.tool` existe: ela não
  muda a execução, só a forma do erro. `rate_limited` pede espera e **nunca** sugere troca de engine.
  Um padrão que não casa devolve `null` e a falha propaga crua — classificar errado é pior que não
  classificar: o `ralph.sh` tratou `OAuth session expired` como cota e mascarou um bug do bridge que
  queimava a credencial do usuário (ADENDO 3 do spike). Fonte dos padrões, com origem e confiança
  declaradas por engine: `research/2026-09-14-quota-patterns.md`. Só o grok (402 +
  `Grok Build usage balance exhausted`, com `http_status` aninhado como TEXTO dentro de `errors[0]` —
  por isso o parser desaninha) e a string de cota do codex foram observados em runtime; os padrões do
  claude vêm do fonte/doc e seguem sendo hipótese.
- **`buildSandboxArgs(spec)` is pure and unit-tested** (like `buildCursorArgs`). Bind order is
  load-bearing: `isoHome` mounts the empty `$HOME` **before** the HOME-subpath overlays (auth/
  toolchain), and the `workspace` bind is **last** so it's never shadowed. `buildSandboxSpec(workspace,
  engine)` is the impure half (mkdtemp + `existsSync` probing) — keep the fs/tmp side effects there.
- **Only `cwd` is mounted — paths outside it are invisible.** A command touching a sibling path
  (additional working dir, adjacent monorepo) fails with `No such file or directory`. Mount extras
  RW via `POLYAGENT_SANDBOX_EXTRA` (`:`-separated absolute paths); `buildSandboxSpec` keeps only
  the ones that exist and aren't the workspace, and `buildSandboxArgs` binds them **after** the HOME
  overlays but **before** the workspace, so the workspace stays the last (never-shadowed) bind.
- **Mandatory, with no graceful fallback.** `SANDBOX_ON` is true unless `POLYAGENT_SANDBOX` is
  `off`/`0`/`false`/`no`/empty. With the sandbox on and `bwrap` missing from PATH, `sandboxPreflight()`
  (called in `index.ts` right before `server.connect`) throws naming the remedy (installing
  bubblewrap), so the server never boots degraded; `runOnce` rejects with the same `BWRAP_MISSING`
  message if the binary disappears after the preflight. There is no stderr-warning path any more — a
  warning the MCP caller never saw was how a security guarantee got dropped silently.
  `POLYAGENT_SANDBOX=off` still disables it as an explicit operator choice, and in that case
  `assertReadOnlyEngine(tool, engine)` refuses any non-codex engine on `explore`/`read_slice`/
  `web_lookup` (only codex has its own `-s read-only`). The two ephemeral tmp dirs (iso-home, /tmp)
  are `cleanup()`-ed on close/error/timeout.
- The spawn boundary stays in `cli.ts` — the sandbox composes `bwrap <args> <engineBin> <engineArgs>`
  in the single `spawn()`; don't spawn `bwrap` from elsewhere.

### Key invariants (violating these breaks tools or tests)

- **Read-only modes are load-bearing for safety.** As três auxiliares não são mais fixas no codex
  (engine por env/parâmetro), e por isso a garantia de read-only fora do codex vem do **sandbox
  bwrap, obrigatório** (US-008): no nível do engine `buildGrokArgs` ignora `mode` e emite sempre
  `--always-approve`, e no claude `mode` emite `--dangerously-skip-permissions` — o oposto de
  read-only. Isso está declarado em código na matriz `ENGINE_CAPABILITIES` (`cli.ts`), campo
  `modeAtEngineLevel`. `assertReadOnlyEngine` recusa, nomeando o motivo, um engine não-codex com o
  sandbox desligado, e `resolveAuxTool` se apoia nesse guard.
  `explore`, `read_slice`, and `web_lookup` pass
  `RunOpts.mode`, which `buildCodexArgs` converts to `-s read-only -c
  approval_policy="never"`; `follow_up` takes the same mode to keep a resumed read-only session
  read-only. `run_filtered` and `delegate` omit mode and get full/bypass access because they execute
  commands or edit. Do not silently remove a read-only tool's mode.
- **The Cursor fallback default is `composer-2.5-fast`, never the old bracket or `auto`.**
  `DEFAULT_MODEL` (env `POLYAGENT_MODEL`) applies to the opt-in Cursor path. The current
  cursor-agent rejects `composer-2.5[fast=true]`. `resolveModel` still accepts caller-supplied
  `auto`, but it is not the default.
- **Health latency uses the real runtime timeout.** `computeEngineHealth` trata o outcome
  `"quota"` (registrado por `classifyOutcome` a partir do `name` da `QuotaError`, sem importar
  `cli.ts`) como score 0, junto de `failure` e `timeout` — não 1, não ignorado. O `continue`
  antigo existia para impedir que cota INFLASSE o health (cairia no ramo "não é failure nem
  timeout" e pontuaria 1); pontuar 0 é a mesma intenção levada até o fim: engine sem saldo é
  engine indisponível. Duas janelas, porque os sinais têm memórias diferentes: `success`/
  `failure`/`timeout` usam a janela curta (30 min — falha e timeout são transitórios, duram
  minutos); `quota` usa uma janela própria e longa (`quotaWindowMs`, default 6h — cota dura
  horas, às vezes até o próximo ciclo de cobrança). Sem a janela longa, um registro de cota
  fora dos 30 min some do mapa; engine sem registro é tratada como saudável (`health[e] ?? 1`)
  e a cascata escolhe de novo a engine esgotada. Cada registro decai na escala da SUA janela
  (halfLife = recWindow/4): cota recupera o health sozinha quando o saldo volta, só que mais
  devagar, sem lógica de expiração própria. Isto NÃO é fallback imediato: o health só reflete
  a cota DEPOIS de pelo menos uma chamada ter falhado e sido registrada no log de uso — a
  primeira chamada após a cota estourar ainda falha; as seguintes é que evitam a engine. A
  proteção é por aprendizado, e depende de `POLYAGENT_LOG` estar configurada: sem log não há
  registros, `computeEngineHealth` devolve vazio e todo engine fica com health 1 (omissão =
  saudável). Dado real (host, 2026-09): o log tinha 3162 linhas (272 `success`, 21 `failure`,
  2 `timeout`, 19 `quota` — todos os de cota do codex); com o `continue` antigo esses 19 eram
  descartados e não influenciavam a seleção. Medido de novo: janela de 2h via o registro de
  cota (health 0.00, cascata cai no opencode); janela de 30 min omitia o codex do mapa — a
  lacuna que a janela longa fecha.
  `computeEngineHealth(records, now, windowMs,
  latencyCeilMs, quotaWindowMs)` retains 300,000ms as its optional-parameter default for backward compatibility,
  but `currentEngineHealth()` passes `DEFAULT_TIMEOUT_MS` (30min by default) and the 6h quota
  window. The old fixed 5min
  ceiling zeroed successful 5–22min runs and falsely made engines unhealthy despite no failure or
  timeout. Both `resolveTier` and `resolveFastTier` use the resulting score at the shared 0.3 threshold.
- **`fast_delegate` is speed-first and alwaysLoad.** `FAST_CANDIDATES` is ordered GPT-6 Luna medium
  → Claude Haiku low → OpenCode `openrouter/inception/mercury-2` → Grok 4.5 low. `resolveFastTier`
  skips missing or unhealthy native engines before the opt-in Cursor fallback. Keep it level-free,
  with the neutral usage receipt `{ requestedLevel: 0, matchedRequest: true }`. It IS marked
  `alwaysLoad`: while deferred it was never called, the same adoption bug that motivated alwaysLoad
  on the five core tools (deferred schemas lose to always-loaded native Read/Grep). **Custo:** os
  dois primeiros são assinaturas (codex e claude); o 2º usa a assinatura Claude do orquestrador
  Claude Code e é um custo aceito. O pago (opencode) só entra quando codex e claude estão ausentes,
  sem cota ou unhealthy. A ordem e os números do bench de 2026-09-23 estão em
  `research/2026-09-23-aux-tools-bench.md`; medium manteve a velocidade do low e teve nota maior.
- **`explore`/`read_slice`/`web_lookup` resolvem engine, modelo e effort por `resolveAuxTool`, com
  default codex + `EXPLORE_MODEL=gpt-6-luna` + `EXPLORE_EFFORT=medium` explícito.** O effort
  usa `POLYAGENT_EXPLORE_EFFORT` quando configurado, só é injetado se a engine resolvida é codex,
  e um `effort` explícito do chamador sempre vence; engine não-codex sem override fica com effort
  `undefined`. `run_filtered` é a exceção: o default dele é a
  cascata do `fast_delegate` (`resolveRunFiltered` → `resolveFastTier`), pelos mesmos motivos de
  velocidade — e para não falhar quando a cota do codex está esgotada, caindo no próximo engine
  saudável. **Custo novo dessa tool:** a cascata pode cair no claude (assinatura) e depois no
  opencode (pay-per-token); o `run_filtered` só pode gastar dinheiro quando codex e claude não
  estiverem disponíveis. Não há mais
  `engine: "codex"` hardcoded no handler: cada uma lê `POLYAGENT_<TOOL>_ENGINE`/`_MODEL` e aceita
  um parâmetro `engine` opcional no **próprio inputSchema** — nunca no objeto `routing`
  compartilhado, que é spread nas ferramentas de roteamento e daria `engine` também a
  `delegate`/`fan_out`/`follow_up`. Precedência (inalterada): parâmetro da chamada > env da tool >
  default. Nas três de leitura a resolução é a função pura `resolveAuxTool(tool, params, env,
  sandboxOn)` em `cli.ts`; no `run_filtered` é `resolveRunFiltered` (param/env explícitos reusam
  `resolveAuxTool`; só o default muda). Ela recusa, nomeando o motivo, um engine que não atenda o
  requisito declarado em `AUX_TOOL_REQUIREMENTS` — read-only para as três de leitura, web search
  (só codex) para `web_lookup` — e nunca degrada para acesso total em silêncio; `run_filtered`
  aceita qualquer engine porque roda com `force: true` por desenho, e a cascata não esbarra em
  `assertReadOnlyEngine` (essa guard vale só para as três de leitura). Com engine não-codex e
  nenhum modelo definido, o modelo fica `undefined` de propósito: `gpt-6-luna` é id de codex e
  quebraria em grok/claude. An explicit `model` still wins. `explore` and `read_slice` pass a
  mode for `-s read-only`; `web_lookup` also sets `RunOpts.web`, which adds
  `-c tools.web_search=true` for real web search; `run_filtered` deliberately omits mode and uses
  bypass so it can run the requested command. `explore` takes `breadth` (`medium`|`thorough`) and
  LOCATES, never reviews.
- **`plan` and `build` no longer exist as tools.** They were removed together with `planPrompt`/
  `buildPrompt` in `prompts.ts` and their tests; the server registers twelve tools. What survives is the
  homonym: `RunOpts.mode: "plan" | "ask"` in `cli.ts` and `ExploreMode` in `prompts.ts` are the codex
  read-only mode (`-s read-only`), used by `explore`/`read_slice`/`web_lookup` and `follow_up` — do
  not delete them chasing the removed tool. `test/tools.test.ts` pins the twelve-tool surface.
- **Agent personas are additive and cross-engine.** `delegate` and `fast_delegate` accept a named or
  inline agent. Resolve it on the host in `agents.ts`, then pass its body via `RunOpts.agentPrompt`: Claude
  `--append-system-prompt`, Grok `--rules`, Codex `-c developer_instructions=` encoded by
  `tomlString`, Cursor/OpenCode/Kimi/Muse prompt prefix. Do not mount agent directories
  into the sandbox.
- **`delegate.engine` is an explicit override, not a tier input.** `level` remains required for difficulty;
  without `engine`, `resolveDelegate` uses `resolveTier`. When the explicit engine differs from the level's
  primary engine, tier `model`/`effort` are dropped so the selected CLI uses its own defaults (or explicit
  caller values). `opencode` and `muse` (pay-per-token) stay outside `TIERS`. `muse` also stays
  outside `FAST_CANDIDATES`; `opencode` is the third `FAST_CANDIDATES` entry (pay-per-token
  fallback after subscription GPT-6 Luna medium and Claude Haiku — see the `fast_delegate` invariant).
- **`read_slice` must return source lines, not just `file:line` prefixes** — this is an explicit
  instruction in `readSlicePrompt` and was a real regression (commit c41c2af). Preserve it.
- **`read_slice` blocks full-file/verbatim dumps before spawning a worker.** `isFullFileRequest` in
  `prompts.ts` is a deterministic code guard called by the handler in `index.ts`, not just prompt text;
  the prompt's soft-guard remains fallback coverage for regex misses.
- **`generate_image` is codex-only.** It is the sole tool with no cursor fallback: the built-in
  `image_gen`/`gpt-image-2` (keyless, via the ChatGPT/Codex subscription) exists only in codex, so the
  handler hard-fails when `hasEngine("codex")` is false. It forces `codex exec` at `IMAGE_MODEL` (env
  `POLYAGENT_IMAGE_MODEL`, default `gpt-6-sol`) with `effort:"low"` — the built-in tool does the
  pixels, the driver model just fires it. `RunOpts.images` (input files for editing) become `-i <file>`
  in `buildCodexArgs`, **followed by a `--` terminator**: `-i/--image` is variadic (`<FILE>...`), so
  without `--` the clap parser swallows the positional prompt as another image file and codex falls back
  to the (closed) stdin → "No prompt provided via stdin". `generateImagePrompt` pins gpt-image-2
  best-effort (the tool has no model selector) and enforces generate-then-move into the cwd; the tool
  returns only the saved path, never the bytes (context economy). `out_path` must live inside `cwd`.
- **`parseCliJson` degrades gracefully**: non-JSON stdout falls back to raw text; `usage.ts`
  skips malformed JSONL lines. Match this best-effort posture — logging/parsing must never throw
  up into a tool call.
  O erro de saída não-zero de `runOnce` é uma `ProcessError` (exportada de `cli.ts`) que carrega
  `{stdout, stderr, exitCode}` separados — o JSON estruturado dos CLIs sai em **stdout** e se perdia
  sempre que `stderr` tinha qualquer conteúdo. `error.message` segue idêntica
  (`<engine> agent exited <code>: <stderr||stdout>`) e o fallback de engine continua decidindo pelo
  `isCodexEnvError` sobre a message/stderr. Não colapse os canais de volta: a classificação de causa
  (cota, rate limit, auth) depende do stdout preservado.
- **Core tools are `alwaysLoad`.** The five core tools (`delegate`, `explore`, `read_slice`,
  `run_filtered`, `web_lookup`) plus `fast_delegate`, `fan_out`, and `rate` register with
  `_meta: { "anthropic/alwaysLoad": true }` so Claude Code (≥2.1.121) eagerly loads their schemas
  instead of deferring them. Deferred tools lose to always-loaded native Read/Grep — that was the
  root adoption bug. `fast_delegate` and `fan_out` both hit it while deferred (the agent never called
  them). Secondary tools (`generate_image`, `follow_up`, `bridge_stats`, `decide`) stay deferred. Do
  not strip `alwaysLoad` from the core five, `fast_delegate`, `fan_out`, or `rate`, or add it to the
  remaining secondary set, without intent.
- **Timeout is a safety net, not a work budget.** `DEFAULT_TIMEOUT_MS` is 30 min (`1_800_000`),
  overridable via `POLYAGENT_TIMEOUT_MS`. Two pure helpers append notes to the prompt of the two
  **execution** tools (`delegate`, `fast_delegate`): `budgetNote(timeoutMs)` appends a
  `[Time budget: ~N min ... return partial results ...]` note so the worker self-manages instead of
  being killed blind; `evidenceNote()` appends an `[Evidence: ...]` note demanding
  the **denominator** — how many candidates the check actually scanned — not just the result. A real
  `fast_delegate` case returned "37 tests passing" on a "renamed with no orphan" check whose
  assertion matched nothing — an empty-set pass is vacuously green. The caller only discovered it by
  injecting a fake `codex-inexistente:fantasma` into a SKILL.md and watching the test still pass.

  The denominator is the whole point, and an earlier draft of this note got it wrong: asking only
  "how many items did the assertion find" made the model report *violations* (the numerator), which
  reads identical whether it scanned 14 items or zero. Measured on the reproduced case, same model
  (mercury-2), invocations hidden behind a pattern the naive check misses:

  - without the note: `"Check passed: all invoked agents are defined"` — false, the orphan was there
  - with the note: `"scanned 0 Skill invocations across 2 SKILL.md files, 0 violations"`

  The model still reached the wrong conclusion in both runs. The note does not fix a fast/weak model
  that optimizes "green" over "proves" — it makes the emptiness visible in one glance. Do not drop
  `evidenceNote` as prompt noise, and do not reword it away from the denominator. Read tools (`explore`,
  `read_slice`, `run_filtered`, `web_lookup`) get neither note. Keep that split.

## The hook (`hooks/prefer-polyagent.mjs`)

Ships separately from the server: a hook the host wires (in its `settings.json`) as a `PreToolUse`
matcher for `Read|Grep|Glob|WebSearch|WebFetch|Bash|Edit|Write` (main-loop nudges), plus
`UserPromptSubmit`, `SessionStart`, and `SubagentStart` entries — each pointing at
`hooks/prefer-polyagent.mjs`. It steers the agent toward the `polyagent` alias and no longer
references the removed `plan`/`build` tools. Renaming from the old path is a breaking change for
host `settings.json` entries that still point at it. Env
`POLYAGENT_HOOK_MODE` = `off` | `nudge` | `redirect` (default **`redirect`**): `off` does
nothing; `nudge` is the old non-blocking `additionalContext` behavior; `redirect` returns
`permissionDecision: "deny"` (via `denyRedirect()`) for the two safe-to-block cases. On `Bash` it
only fires for artifact-writing commands (`git commit`/`push`, `git worktree add`, `gh pr create`,
`bkt pr create`) — nudging that grunt-work to `delegate`; read-only Bash is left alone (rtk already
trims it). Design constraints, all tested in `test/hook.test.ts`:

- Pure decision in `decide(input, deps)` with injectable fs — that's what the tests exercise.
  `decide()` returns `{ keys, text, redirect }`. The I/O wrapper (`main`) only runs when invoked as
  a script.
- **Redirect mode (default):** for WebSearch/WebFetch → `web_lookup` and whole-file large Read
  (no offset/limit, ≥ `POLYAGENT_HOOK_MIN_LINES`) → `read_slice`, the hook **denies** the native
  call once and names the bridge tool in the reason. It is **one-shot + fail-open**: per-session
  dedup keys are saved **before** emitting, so the second identical call is allowed through; the
  deny reason (`FAILOPEN_SUFFIX`) explicitly tells the model it may retry — critical under headless
  `-p` so it never hard-stalls. It **never** redirects Grep/Glob/Bash/Edit/Write (those stay
  nudge-only; blocking edits or git would break the host).
- **PreToolUse dedup per session** (keyed by `session_id` in an `os.tmpdir()` file, mode `0600`):
  every PreToolUse nudge/redirect fires at most once. A repeated fire is worse than none. This is why
  `Grep`/`Glob` can sit in the matcher — they collapse to a single preload reminder.
- The first qualifying nudge of a session also carries the one-time preload reminder.
- **`SessionStart` closes the Bash-grep hole:** the PreToolUse preload only fires on the `Grep`/`Read`
  tool, but agents often use `Bash grep` (matches no matcher), so the preload never arrived.
  `sessionStartContext()` injects it as `additionalContext` before the first tool decision and
  pre-marks `preload` in the dedup file so the PreToolUse piggyback never repeats it.
  `sessionStartContext()` and `AGENT_PREF_BODY` also name `fast_delegate`: prefer it over
  `delegate` for simple/urgent work where speed matters more than picking a level.
- Fail-open on errors: any error → print nothing, exit 0. SubagentStart and SessionStart paths are
  unchanged by redirect mode.
- Threshold for the large-Read redirect/nudge is `POLYAGENT_HOOK_MIN_LINES` (default 300).

**`SubagentStart` reaches spawned subagents.** Main-loop PreToolUse nudges never reach subagents, so
the hook wires a dedicated `SubagentStart` entry. When `hook_event_name === "SubagentStart"`,
`main()` emits `{ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext:
subagentStartContext(data.agent_type) } }`. Pure `subagentStartContext(agent_type)` reuses
`AGENT_PREF_BODY` and appends `EXPLORE_EXTRA` when `agent_type === "Explore"` — an extra line
telling that run (spawned on the orchestrator's expensive model) to route all reading through
`explore`/`read_slice` (which run on GPT-6 Luna). `sessionStartContext()` carries the matching
main-loop steer: prefer calling `explore()` directly over spawning the Explore subagent. The bridge
and context-mode coexist without a race: they use separate channels (context-mode may still do its
own thing; the bridge injects via `additionalContext` only). Fail-open/non-throwing as elsewhere.

**`UserPromptSubmit` routes each prompt independently.** The host must wire a separate
`UserPromptSubmit` entry in `settings.json` to the same `hooks/prefer-polyagent.mjs` script. When a
prompt asks for parallel opinions, current library information, filtered test/build output, or a
code location, `main()` emits one calm `additionalContext` sentence naming the matching tool.
This entry intentionally has no session dedup: every submitted prompt is judged on its own.
`POLYAGENT_HOOK_MODE=off` remains a no-op, and routing errors fail open.

When changing hook behavior, put decisions in pure functions (`decide`, `sessionStartContext`,
`subagentStartContext`, `promptRouteContext`) and keep `main()` limited to dispatch/output. Add or
adjust a case in `test/hook.test.ts` — the test imports the `.mjs` directly and injects fakes for fs.

## Project harness (`.claude/`, `research/`, `bench/`)

Distinct from the shipped hook above: this is the harness for **maintaining this repo**, active only
when an agent runs here.

- **Skills** (`.claude/skills/`): `model-refresh` (new model released → ids, placement, tests,
  docs), `run-bench` (measure models on the real bridge path), `add-engine` (touch points for a new
  CLI), `ship` (commit → PR → merge → rebuild `dist/` → MCP restart). Each one's `description` says
  when it applies.
- **Hooks** (`.claude/settings.json`, versioned): `polyagent-git-sync.sh` (SessionStart,
  fast-forward only on a clean tree) and `polyagent-pr-reminder.sh` (after `git push`, reminds to
  feed back `CLAUDE.md` and `research/`). `.claude/settings.local.json` is machine-local — never
  commit it.
- **`research/`** is the project's research base: one dated study per decision, with sources and a
  "Reavaliar" section, indexed in `research/README.md`. Code comments that justify a model choice
  point there. `research/bench/` holds raw JSONL from `npm run bench` (`bench/aux-bench.mjs`) and from
  `node bench/adoption-eval.mjs <label>` — the adoption eval: fixed prompts run in a real `claude -p`
  (user config + hooks) to measure whether the host picks polyagent tools; it spends real Claude
  usage, so run it deliberately and compare labels (e.g. `baseline` vs `after`).

## Conventions

- ESM + TypeScript, Node16 module resolution. `dist/` and `node_modules/` are gitignored;
  imports use `.js` extensions (Node16 requirement) even though sources are `.ts`. Note "Node16"
  is the TS `moduleResolution`, not the runtime — `package.json` `engines` requires Node `>=18`.
- Comments are in Portuguese; code identifiers and prompt strings are in English. Match this.
- Cross-cutting env vars are read once as module-level consts in `cli.ts`/`usage.ts` — add new
  config there, don't scatter `process.env` reads.
