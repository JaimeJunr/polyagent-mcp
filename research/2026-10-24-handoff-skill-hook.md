# Skill por nome + deny único em Agent/Skill: handoff 0/2 → 4/4 (2026-10-24)

Contexto: no [eval de adoção de 2026-09-30](2026-09-30-adoption-handoff.md) o handoff ficou 0/2 em
três condições (texto, texto + aviso do hook). Pedido com subagent, o host chamava o `Agent` nativo;
pedido com skill, carregava a `Skill` e fazia o trabalho sozinho. O
estudo de 2026-10-23 sobre negar a primeira edição (`2026-10-23-edit-redirect.md`, ainda não
mergeado) mostrou que negar a primeira `Edit` não ajuda: o host já leu os arquivos e prefere repetir.
Em `Agent`/`Skill` o host ainda não fez o trabalho, como no `grep`, e o `delegate` substitui a
chamada na hora.

## O que mudou

1. `delegate`/`fast_delegate` aceitam `agent: { skill: "plugin:name" }`. O `SKILL.md` vira a
   persona e a pasta da skill entra no bwrap como `--ro-bind` (`RunOpts.roBinds`). Antes, o host
   tinha que colar o `SKILL.md`, e `scripts/`/`references/` ficavam de fora.
2. Hook em `redirect`: `Agent`/`Task`/`Skill` recebem deny único (fail-open) quando o arquivo do
   subagent ou o `SKILL.md` é achado e não depende do host — o subagent não lista tools MCP (fora o
   context-mode), `Agent`/`Task` nem browser; a skill não cita MCP, browser nem subagents. Senão,
   fica o aviso de antes. Conferido ao vivo: `ivt-quality:security-audit` e `ivt-core:code-reviewer`
   recebem deny; `tamandua-tester:qa-tester` (MCP de banco) só aviso.
3. Instructions do servidor, `sessionStartContext`, bloco do `CLAUDE.md` e descrição do `agent`
   passam a citar `{ skill }`.

## Como rodou

`node bench/adoption-eval.mjs skillhook-r{1,2} handoff-agent,handoff-skill`, host `claude-opus-5-5`
effort `medium`, `ADOPTION_REPO` = worktree da branch `feat/handoff-skill-by-name`. Durante a
medição, `~/.claude/settings.json` apontou o hook para a worktree e o `dist/` do checkout principal
recebeu o build da branch; o script restaurou os dois no fim. Custo reportado: $2,78 (3/4). Um
acerto exige `delegate`/`fast_delegate` **com** `agent` no formato esperado (`name`; `skill` ou
`inline`). Bruto: [`bench/2026-10-24-adoption.jsonl`](bench/2026-10-24-adoption.jsonl).

## Resultado — 4/4 (antes 0/2 em todas as condições)

| Rodada | Prompt | Tools do host | `agent` |
|---|---|---|---|
| r1 | handoff-agent | `Agent` (deny) → `delegate` → `rate` | `name` |
| r1 | handoff-skill | `delegate` ×2 → `Bash` → `rate` (estourou os 8 min do eval) | `skill` ×2 |
| r2 | handoff-agent | `Agent` (deny) → `delegate` → `Agent` → `Bash` ×7 | `name` |
| r2 | handoff-skill | `delegate` ×2 → `Bash` → `rate` | `skill` ×2 |

## Leitura

- **Skill:** o host nem chamou a `Skill`; foi direto ao `delegate` com `{ skill }` nas duas rodadas.
  Quem fez isso foi o texto novo (instructions/`sessionStartContext`), não o deny — que não chegou
  a disparar. O formato curto (só o nome) parece ter tirado o atrito de colar o `SKILL.md`.
- **Agent:** o deny levou ao `delegate` com o nome do subagent nas duas rodadas. Na r2 o host chamou
  o `Agent` de novo depois (o fail-open deixa) e rodou 7 `Bash`: delegou, mas também conferiu sozinho.
  Acerto pelo critério do eval, com custo duplicado.
- O timeout da r1 da skill é do eval (8 min), não do worker: a auditoria de segurança é longa.
- n = 2 por prompt e uma condição só; o salto 0 → 4 é grande e bate com o mecanismo, mas não separa
  quanto veio do texto e quanto do deny no caso do `Agent`.

## Reavaliar

- Rodar os 18 prompts para conferir que o deny em `Agent` não piorou outros grupos (a regra só
  dispara em `Agent`/`Task`/`Skill`; os outros prompts não deveriam mudar).
- Se o host continuar refazendo o trabalho depois do `delegate` (r2 do `handoff-agent`), testar um
  texto de deny que diga para revisar o resultado do worker em vez de refazer.
