# Contributing to polyagent-mcp

Thanks for helping. The project is small and moves fast; these notes keep changes easy to review.

## Ways to contribute

- **Report a bug** with the host you use, your OS, the tool call, and the error text.
- **Add or fix an engine** (a new coding-agent CLI). The `add-engine` skill in
  `.claude/skills/` lists every touch point.
- **Bring measurements.** Benchmarks that move a model between levels are very welcome; follow
  the `run-bench` skill and add a dated study under `research/`.
- **Improve docs**, especially install steps for hosts we have not tested.
- **macOS support.** The Linux-only `bwrap` sandbox is the biggest barrier to new users.

Not sure where to start? Look for issues labeled `good first issue`.

## Set up

```bash
git clone https://github.com/JaimeJunr/polyagent-mcp.git
cd polyagent-mcp
npm install
npm run build      # tsc, strict mode: this is the type-check gate
npm test           # vitest, unit tests
npm run dev        # run the server from source
```

You need Node ≥ 18 and `bubblewrap` on Linux. Some tests run real `bwrap`.

## Before you open a PR

1. Open an issue first for anything bigger than a small fix, so we agree on direction.
2. Branch off `master`; never push to it directly.
3. Add tests for new behavior. Keep pure logic separate from process spawning so it can be
   tested without launching a worker (see `src/cli.ts`).
4. `npm run build` and `npm test` must pass.
5. Read [CLAUDE.md](CLAUDE.md). It documents the architecture and the invariants that break
   tools or tests if violated (read-only modes, the sandbox, `alwaysLoad` tools).

## Conventions

- ESM + TypeScript. Imports use `.js` extensions even though sources are `.ts`.
- Read config from the environment once, in module-level constants in `cli.ts` or `usage.ts`;
  do not scatter `process.env` reads.
- Spawning child processes happens only in `src/cli.ts`.
- Logging and parsing never throw into a tool call.
- Comments in the existing code are mostly Portuguese; English is fine in new code and docs.

## Changing a model, level or default

Do not guess. Prices and benchmark numbers must come from a checked source. Record the evidence
as a dated file in `research/` and link it from the code comment that justifies the choice.

## Security

If you find a way out of the sandbox or a leaked credential, do not open a public issue.
Use GitHub's private vulnerability reporting on this repository.
