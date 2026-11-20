# polyagent-mcp

**Give your coding agent a team of cheaper workers.** polyagent-mcp is an MCP server that lets
your main agent hand work to other coding-agent CLIs (Codex, Claude Code, Grok, OpenCode, …)
and get back only the answer, not the worker's raw output.

It does not replace your agent or its harness. It adds to it: cheaper web lookups, delegated
implementation, cross-model second opinions, and filtered build/test output.

> **Status:** v0.5, used daily by its author. Works in any MCP host; the best-tested setup is
> [Claude Code](https://claude.com/claude-code). Linux today, macOS is the next goal (see
> [Roadmap](#roadmap)).

## Why

Claude Code has one of the best agent harnesses available, so the research behind this project
starts from it instead of fighting it. The harness is great; the expensive part is spending the
top model's tokens on work a cheaper model does just as well: reading large files, searching the
web, running noisy test suites, doing a self-contained edit.

polyagent-mcp routes that work to the model with the best cost/quality trade-off:

- Models are placed on a **Pareto line** built from public intelligence benchmarks and local
  measurements ([method and results](research/2026-09-23-tier-pareto.md)). Today that puts
  mostly Codex models behind `delegate`.
- Three named levels (`low`, `middle`, `high`) hide the model choice from the caller.
- Every tool is designed for **context economy**: the worker's raw output never enters your
  agent's context. `bridge_stats` reports how much did.

The goal is better cost-efficiency, not just lower cost. Honest limits of what has and has not
been measured are in [docs/evidence.md](docs/evidence.md).

## What you get

| Tool | Use it to |
|------|-----------|
| `delegate` | Hand a self-contained task (feature, bugfix, build fix) to a worker with read/edit/shell access. |
| `explore` | Map or search a codebase read-only; get `file:line` references back. |
| `read_slice` | Read only the relevant lines of a big file. |
| `run_filtered` | Run a noisy command and keep only the signal. |
| `web_lookup` | Look up docs, errors and current versions on the web, cheaply. |
| `fan_out` | Get independent opinions from 2+ models and cross-check a risky call. |
| `follow_up` | Continue a worker session by `session_id`. |
| `rate`, `bridge_stats` | Grade results and see per-tool usage. |
| `decide`, `generate_image` | Calibrated yes/no probabilities; image generation via Codex. |

Full parameters, levels and quota behavior: [docs/tools.md](docs/tools.md).

## Quick start

You need Node ≥ 18, [`bubblewrap`](https://github.com/containers/bubblewrap) (Linux), and at
least one authenticated worker CLI. Codex is the primary engine for all three levels; Claude
Code is the reserve when Codex is missing, unhealthy or out of quota.

```bash
git clone https://github.com/JaimeJunr/polyagent-mcp.git
cd polyagent-mcp
npm install && npm run build

# Claude Code
claude mcp add polyagent -s user -- node "$(pwd)/dist/index.js"
```

Any other MCP host: add this to its `mcp.json`.

```json
{
  "mcpServers": {
    "polyagent": { "command": "node", "args": ["/abs/path/to/polyagent-mcp/dist/index.js"] }
  }
}
```

Using an AI agent to install it? Point it at [INSTALL.md](INSTALL.md): a step-by-step guide for
Claude Code, Cursor, Codex, Grok and generic hosts, including the permission allowlist.

### Recommended setup (Claude Code)

Registering the tools is not enough: hosts tend to prefer their native `Read`/`Grep`/`WebSearch`.
Three optional pieces make the agent actually use polyagent, strongest first:

1. a `PreToolUse` hook that nudges at the moment of the native call,
2. a managed `CLAUDE.md` routing block (`npm run install-claude-md`),
3. a managed on-demand skill (`npm run install-skill`).

Details: [docs/steering.md](docs/steering.md).

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/tools.md](docs/tools.md) | Every tool, the three levels, quota behavior |
| [docs/configuration.md](docs/configuration.md) | All environment variables |
| [docs/steering.md](docs/steering.md) | Hooks, `CLAUDE.md` block and skill |
| [docs/evidence.md](docs/evidence.md) | What has and has not been measured |
| [INSTALL.md](INSTALL.md) | Agent-friendly install guide per host |
| [research/](research/README.md) | One dated study per design decision |
| [CLAUDE.md](CLAUDE.md) | Architecture and invariants (read before changing code) |

## Safety

`delegate` and `run_filtered` give the worker full access and auto-approve its actions inside
`cwd`. Every engine runs in a mandatory bubblewrap sandbox with an empty `$HOME`, so your global
config, MCP servers, hooks and skills never load. `delegate` also accepts a `deny` list
(for example `git push`, `rm`) as a guardrail against accidents; it is not a security boundary.
`explore`, `read_slice` and `web_lookup` are read-only.

## Roadmap

- **macOS and optional sandbox.** The sandbox is Linux-only (`bwrap`) and mandatory today.
  Supporting macOS is a goal; see the open issues.
- Publish to npm so `npx` works without cloning.
- More worker engines and keeping the Pareto line current as models ship.

## Contributing

Contributions are welcome: bug reports, new engines, benchmarks, docs. Start with
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
