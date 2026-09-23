---
name: add-engine
description: Use when adding a new coding-agent CLI as a polyagent-mcp engine (a new `Engine` value next to codex/grok/claude/opencode/kimi/muse), or when an engine's CLI changed its flags, output format, session/resume handling or auth/config paths and the bridge now hangs, returns empty text, loses the session_id or fails inside the bwrap sandbox.
---

# add-engine — onde uma engine nova precisa tocar

As **regras** de cada dialeto e do sandbox estão no `CLAUDE.md` (seções "Engines & tiers" e "The
sandbox") — leia as duas antes. Esta skill é o mapa de pontos de toque, porque esquecer um deles não
quebra o build: a engine só falha em runtime.

## Antes de codar: spike

Rode o CLI à mão e registre em `research/AAAA-MM-DD-<engine>-engine.md` (modelo: os spikes de
opencode/kimi/muse linkados em `research/README.md`): flag de prompt headless, formato de saída
(JSON único ou JSONL e qual evento traz o texto), onde vem o session id, como retomar, flag de
autonomia, se lê stdin, onde guarda auth/config/sessões no `$HOME`, e se é assinatura ou
pay-per-token. Sem isso você vai adivinhar o parser.

## Pontos de toque em `src/cli.ts`

| O quê | Onde |
|---|---|
| Nome da engine | `type Engine` (topo) e o parse do prefixo de `session_id` (`prefix !== ...`) |
| Binário | `<ENGINE>_BIN` com env `POLYAGENT_<ENGINE>_BIN`, e o seletor de binário em `runCursor` |
| Dialeto | `build<Engine>Args` + ramo no `buildArgs` |
| Saída | `parse<Engine>Jsonl`/reuso de `parseCliJson` + ramo no `parseOutput` |
| Sandbox | `SANDBOX_ENGINE_RO` / `SANDBOX_ENGINE_RW` (`~/.local` é RO inteiro: subpasta gravável precisa RW explícito) |
| Capacidades | `ENGINE_CAPABILITIES` (`engineReadOnly`, `modeAtEngineLevel`, `webSearch`...) — é o que `resolveAuxTool`/`quotaCandidates` consultam |
| Cota | padrões em `classifyQuotaError` só se observados em runtime; senão fica `null` (classificar errado é pior que não classificar) |
| Cascatas | `TIERS`/`FAST_CANDIDATES`/`FALLBACK_ENGINE_ORDER`: pay-per-token fica fora por padrão; `FALLBACK_ENGINE_ORDER` descarta `mode`, então engine sem read-only próprio não entra lá |

Em `src/index.ts`: as strings de `engine` nas descrições (`delegate.engine` e as auxiliares).

## Testes

`test/cli.test.ts` (args, parser com saída real capturada do spike, resume), `test/aux-engine.test.ts`
(read-only/requisitos), `test/quota.test.ts` (candidatos). Use uma saída **real** do CLI como
fixture, não uma inventada.

## Prova final

Uma chamada real pelo caminho do bridge, com sandbox ligado: `runCursor({ engine, prompt, cwd })`
importado de `dist/cli.js`, e depois um `follow_up` na sessão devolvida. Parser que passa na fixture
e falha no CLI real é o caso comum.
