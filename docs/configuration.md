# Configuration

| Var | Default | Meaning |
|-----|---------|---------|
| `POLYAGENT_CURSOR_BIN` | `cursor-agent` | Path to the optional Cursor CLI fallback. |
| `POLYAGENT_GROK_BIN` | `grok` | Path to the Grok CLI. |
| `POLYAGENT_CODEX_BIN` | `codex` | Path to the Codex CLI. |
| `POLYAGENT_CLAUDE_BIN` | `claude` | Path to the Claude Code CLI. |
| `POLYAGENT_OPENCODE_BIN` | `opencode` | Path to the OpenCode CLI used by explicit engine selection. |
| `POLYAGENT_ENABLE_CURSOR` | _(off)_ | Set to `1`/`true` to allow Cursor fallback when a tier's preferred CLI is missing. Otherwise the call fails with the missing CLI named. |
| `POLYAGENT_MODEL` | `composer-2.5-fast` | Default model for the optional Cursor path. |
| `POLYAGENT_EXPLORE_MODEL` | `gpt-6-luna` | Codex model for `explore`, `read_slice`, and `web_lookup` when neither the call nor the tool-specific `_MODEL` sets one. `run_filtered` defaults to the `fast_delegate` cascade, not this. |
| `POLYAGENT_EXPLORE_EFFORT` | `medium` | Explicit Codex effort for `explore`, `read_slice`, and `web_lookup` when the call omits `effort`; ignored for non-Codex engines and does not set the `run_filtered` cascade. |
| `POLYAGENT_<TOOL>_ENGINE` | cascade | Per-tool engine for the four auxiliary tools — `<TOOL>` is `EXPLORE`, `READ_SLICE`, `RUN_FILTERED`, or `WEB_LOOKUP`. The call's own `engine` parameter beats it. Unset, all four use the FAST_CANDIDATES cascade (codex first), skipping engines that are missing, unhealthy or out of quota, and engines that lack what the tool needs. Refused when the engine lacks what the tool needs: read-only (`explore`/`read_slice`/`web_lookup`, which outside codex comes from the sandbox) or web search (`web_lookup`, codex or claude). |
| `POLYAGENT_<TOOL>_MODEL` | _(see above)_ | Per-tool model, same four names. The call's `model` beats it. With a non-codex engine and no model set anywhere, the engine's own default model is used. |
| `POLYAGENT_AGENT_PATHS` | _(off)_ | Additional `:`-separated roots for named agent personas, searched before project/home `.claude/agents` and `~/.claude/plugins`. |
| `POLYAGENT_SANDBOX` | `bwrap` | Isolates every engine in a bubblewrap sandbox with an empty `$HOME`, preventing global config, MCP servers, hooks, and skills from loading. Only auth, required engine state, and toolchains are bound in. Set `off`/`0` to disable explicitly — with the sandbox off, the read-only tools (`explore`, `read_slice`, `web_lookup`) accept only the codex engine. A missing `bwrap` is a startup error, never a silent downgrade. |
| `POLYAGENT_FORCE` | _(off)_ | If `1`/`true`, force-enable non-interactive approval for Cursor, Claude, and OpenCode runs. |
| `POLYAGENT_TIMEOUT_MS` | `1800000` (30 min) | Per-call safety-net timeout (not a work budget). Execution tools (`delegate`) also get a prompt note so the worker returns partial results before being killed. |
| `POLYAGENT_LOG` | _(off)_ | Path to a JSONL file; when set, calls log `{tool, outChars}` for `bridge_stats`. Internal Jev attempts also write `tool:"decide"`, `engine:"jev"`, zero returned chars, and a `decision` record with choice, confidence, acceptance, fallback, latency, cost, and requested level for shadow. |
| `POLYAGENT_JEV_FANOUT` | _(on only with an OpenRouter key at boot)_ | Default is on only when `OPENROUTER_API_KEY` or the opencode auth file has a key; a fresh install without one makes no external call. Set `1`/`on` to force it on (needed when the key lives only in the system keyring); `0`/`false`/`off`/`no` disables. Asks Jev whether 2+ successful `fan_out` consensus outputs substantially agree. At or above the threshold, return the first worker and session handles without the Codex arbiter. On low confidence, invalid answer, missing key, Jev error, or a 5-second timeout, use the arbiter. OpenRouter call (free with the default model; spends the daily `:free` quota). |
| `POLYAGENT_JEV_FANOUT_THRESHOLD` | `0.85` | Minimum Jev agreement probability for skipping the arbiter; invalid values use 0.85. |
| `POLYAGENT_CLAUDE_MD` | _(on)_ | Set to `off`/`0`/`false`/`no` to stop the server from refreshing an installed `CLAUDE.md` block on start. |
| `POLYAGENT_CLAUDE_MD_PATH` | `~/.claude/CLAUDE.md` | File that holds the managed block. |
| `POLYAGENT_JEV_SHADOW` | _(on only with an OpenRouter key at boot)_ | Default is on only when `OPENROUTER_API_KEY` or the opencode auth file has a key; a fresh install without one makes no external call. Set `1`/`on` to force it on (needed when the key lives only in the system keyring); `0`/`false`/`off`/`no` disables. Asks Jev for a `delegate` level and a prompt-clarity check (target named, done defined, single task) in one parallel call with the worker. The suggestion never changes the requested level; a pending Jev call adds at most 5 seconds after the worker ends. OpenRouter call (free with the default model; spends the daily `:free` quota). |
| `POLYAGENT_JEV_VERIFY` | _(on only with an OpenRouter key at boot)_ | Default is on only when `OPENROUTER_API_KEY` or the opencode auth file has a key; a fresh install without one makes no external call. Set `1`/`on` to force it on (needed when the key lives only in the system keyring); `0`/`false`/`off`/`no` disables. Judges each successful `delegate` result in the background: does it claim success, report how many items its checks covered, show evidence, and address the task? Logs a `delegate_result_verify_shadow` decision; never delays or changes the result. One decision-model call per worker result. |
| `POLYAGENT_JEV_MODEL` | `baseten/elephant-1:free` | Decision model for `decide` and the two Jev flags (any `/v1/systemone` model). `typesafe/jev-1.13` restores the paid Jev; see `research/2026-10-24-modelos-decisao-gratis.md`. |
| `OPENROUTER_API_KEY` | _(unset)_ | Key for `decide` and the Jev flags. Fallbacks, in order: `.openrouter.key` in `~/.local/share/opencode/auth.json`, then the system keyring item stored by `secret-request --keyring openrouter --env OPENROUTER_API_KEY` (read with `secret-tool`). |
| `POLYAGENT_PROFILE` | `full` | Which tools load their schema every session (`alwaysLoad`). `full`: `delegate`, `explore`, `run_filtered`, `web_lookup`, `fan_out`, `rate`. `minimal`: only `delegate`, `explore`, `run_filtered`; the rest load on demand. `minimal` saves about 1,100 estimated tokens per session (`npm run doctor` shows the exact figure for your install); `full` stays the default until the adoption eval shows `minimal` does not lose adoption. Unknown values use `full`. |
| `POLYAGENT_HOOK_MODE` | `nudge` | `off` desativa; `nudge` emite `additionalContext`; `redirect` bloqueia uma vez WebSearch/WebFetch, Read integral grande e Bash de busca de código, com retry fail-open. Grep/Glob/Edit/Write/MultiEdit/Agent/Task emitem apenas nudge. Skill não é tratada pelo hook desde 2026-10-25: o deny empurrava até skills básicas para um worker; usar Skill nativamente é válido. |
| `POLYAGENT_HOOK_MIN_LINES` | `300` | Line threshold above which the optional hook (below) redirects/nudges whole-file Read toward `read_slice`. |

The three Jev flags are on by default (without an OpenRouter key each one falls back to the plain path) and pass truncated worker output or task text through the credential scrubber before sending it to OpenRouter.
They use the same `OPENROUTER_API_KEY` or OpenCode auth-file key as `decide`.

### Breaking change: env var rename

Every `CURSOR_BRIDGE_*` variable was renamed to `POLYAGENT_*` (same suffix), and `CURSOR_BIN`
became `POLYAGENT_CURSOR_BIN`. This is a **clean cut**: the old names are no longer read at all —
setting one has zero effect (no fallback, no warning). Update your host config (`mcp.json` /
`settings.json` `"env"` blocks) and any shell profile before upgrading.

| Old (removed) | New |
|---------------|-----|
| `CURSOR_BIN` | `POLYAGENT_CURSOR_BIN` |
| `CURSOR_BRIDGE_AGENT_PATHS` | `POLYAGENT_AGENT_PATHS` |
| `CURSOR_BRIDGE_GROK_BIN` | `POLYAGENT_GROK_BIN` |
| `CURSOR_BRIDGE_CODEX_BIN` | `POLYAGENT_CODEX_BIN` |
| `CURSOR_BRIDGE_CLAUDE_BIN` | `POLYAGENT_CLAUDE_BIN` |
| `CURSOR_BRIDGE_MODEL` | `POLYAGENT_MODEL` |
| `CURSOR_BRIDGE_EXPLORE_MODEL` | `POLYAGENT_EXPLORE_MODEL` |
| `CURSOR_BRIDGE_IMAGE_MODEL` | `POLYAGENT_IMAGE_MODEL` |
| `CURSOR_BRIDGE_FORCE` | `POLYAGENT_FORCE` |
| `CURSOR_BRIDGE_ENABLE_CURSOR` | `POLYAGENT_ENABLE_CURSOR` |
| `CURSOR_BRIDGE_TIMEOUT_MS` | `POLYAGENT_TIMEOUT_MS` |
| `CURSOR_BRIDGE_DEBUG` | `POLYAGENT_DEBUG` |
| `CURSOR_BRIDGE_SANDBOX` | `POLYAGENT_SANDBOX` |
| `CURSOR_BRIDGE_SANDBOX_EXTRA` | `POLYAGENT_SANDBOX_EXTRA` |
| `CURSOR_BRIDGE_LOG` | `POLYAGENT_LOG` |
| `CURSOR_BRIDGE_HOOK_MODE` | `POLYAGENT_HOOK_MODE` |
| `CURSOR_BRIDGE_HOOK_MIN_LINES` | `POLYAGENT_HOOK_MIN_LINES` |

"cursor" survives only where it names the actual Cursor engine (`POLYAGENT_CURSOR_BIN`,
`POLYAGENT_ENABLE_CURSOR`).

> **Security:** `delegate` and `run_filtered` have full access and auto-approve
> their work. `explore`, `read_slice`, and `web_lookup` use Codex's read-only sandbox. Named agents
> are resolved on the host, reject path traversal, and are injected without mounting agent
> directories.

