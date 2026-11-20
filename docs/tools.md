# Tools

The server exposes twelve tools:

| Tool | Purpose |
|------|---------|
| `delegate` | Run a task with full **read/edit/shell** access in `cwd`. Required `level`: low=GPT-6 Luna max (codex), middle=GPT-6.2 Sol medium (codex), high=GPT-6.2 Astra xhigh (codex). **Low/middle cover most work. High is expensive and runs on codex; its reserve shares the Claude Code host subscription; reserve it for tasks cheaper levels cannot do.** Optional `engine` overrides the tier; `opencode` requires a `provider/model` model. Optionally accepts an `agent` persona by name or inline `{prompt}`, and `deny` (commands such as `git push`, `rm`, `make db-up` or `npx prisma migrate`; args match as an ordered subsequence outside git) to block inside the sandbox with exit 126 — a guardrail against accidents, not a security boundary; requires bwrap. |
| `explore` | Read-only exploration on Codex with `gpt-6-luna` and explicit `medium` effort by default (`POLYAGENT_EXPLORE_EFFORT`). `question` alone → broad fan-out search returning `file:line` refs; `question`+`files` → answer about those files; neither → general project map. `breadth: "thorough"` sweeps wider. Locates, does not review. |
| `read_slice` | Surgical read-only read: returns ONLY the code relevant to `want` (exact lines with `file:line`) from the given `files` — the full file never enters your context. Codex uses `gpt-6-luna` with explicit `medium` effort by default (`POLYAGENT_EXPLORE_EFFORT`). Use instead of reading large files whole. |
| `run_filtered` | Run a shell `command` with full access and get back ONLY the lines relevant to `want` — semantic filtering of huge build/test/log output. Default engine is the same FAST_CANDIDATES cascade: codex GPT-6 Luna medium, then Claude Haiku 5.5 medium, then OpenRouter mercury-2. OpenRouter credit is spent only after both subscription candidates are missing, quota-exhausted or unhealthy. |
| `web_lookup` | Web/docs lookup through Codex/GPT-6 Luna with explicit `medium` effort by default (`POLYAGENT_EXPLORE_EFFORT`), real web search enabled and a read-only filesystem. Falls back to Claude Haiku 5.5 medium (native WebSearch) when codex is unhealthy or out of quota. |
| `decide` | Ask a System One decision model (default `baseten/elephant-1:free`; `typesafe/jev-1.13` via `POLYAGENT_JEV_MODEL`) for calibrated probabilities or a typed choice label through OpenRouter; useful for risky-call gates, classification, and verifying worker claims. |
| `generate_image` | Generate or edit an image through Codex's built-in image tool and save it inside `cwd`. |
| `fan_out` | Get independent opinions, compare approaches, cross-check a risky verdict, or split broad research. Avoid simple lookups, single-file edits, and tightly coupled sequential work; it runs several workers and costs several times one `delegate`. Required `levels` contains at least two names from `low`, `middle`, `high`; repeats are allowed. Start with `["low", "middle"]`; add `"high"` only after a cheaper consensus disagreed or for a costly verdict. With the optional Jev consensus gate, high agreement skips the Codex arbiter; uncertainty or Jev failure keeps it. |
| `follow_up` | Continue a prior session by `session_id`. |
| `bridge_stats` | Report calls and chars returned to context per tool, plus ratings; optional `export: true` writes `research/bench/<YYYY-MM-DD>-ratings.md` (needs `POLYAGENT_LOG`). |
| `rate` | Grade a reviewed result from 1–5 by its `session_id`; ratings stay local and feed `bridge_stats`. |

Worker tools accept `cwd`, `model`, and `effort` where applicable. `delegate` requires a **level**
("low", "middle", or "high"). Explicit `model`/`effort`
values override the selected tier.

### When an engine runs out of quota

A call that fails because the engine's plan quota is exhausted does **not** silently retry on
another engine — spending the next subscription is your decision. The call fails with an actionable
error naming the engines still available (installed, enabled, and capable of what that tool needs)
and how to switch: `engine:"<x>"` on the four auxiliary tools and `delegate`, or the lowest
still-usable `level:"<name>"` when a tier engine remains. Tools that pick the engine themselves (`fan_out`) and `follow_up`
(pinned to the resumed session's engine) report the quota without suggesting a parameter, and
`generate_image` reports it against the two engines that have an image tool at all (codex, grok). A transient rate limit is reported separately and asks you to wait, since switching
engines would not help. Anything the classifier does not recognize — an expired login, for one —
propagates as the raw CLI failure instead of being guessed at.

