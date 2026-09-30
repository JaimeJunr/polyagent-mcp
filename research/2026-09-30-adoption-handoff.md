# Eval de adoção depois dos PRs #37/#38 (2026-09-30)

Contexto: os PRs #37 e #38 (mergeados em 2026-09-27) mudaram só texto — instruções do servidor,
`sessionStartContext` e o bloco gerenciado do `CLAUDE.md` — para o host (1) não largar o polyagent
por causa do MCP `codex` caído e (2) passar subagent/skill ao worker via param `agent` em vez de
fazer o trabalho sozinho. A medição ficou pendente porque a cota do `claude -p` tinha acabado.

## Como rodou

`node bench/adoption-eval.mjs after-r1` (os 14 prompts), host `claude-opus-5-5` effort `medium`,
numa worktree limpa do `master` (`ADOPTION_REPO`), em 2026-09-30. Custo reportado: $9,49 (12/14).
Bruto: [`bench/2026-09-30-adoption.jsonl`](bench/2026-09-30-adoption.jsonl). Uma rodada só (r1):
n pequeno, serve para achar onde o host foge, não para afirmar taxa.

## Resultado — 9/14 acertos (64%)

| Prompt | Acerto | O que o host usou |
|---|---|---|
| read, noisy-cmd, second-opinion, breadth, control-simple | sim | polyagent (ou nada, no controle) |
| risky-verdict | sim | `fan_out`, mas também `Bash`/`Read`; estourou o timeout |
| h-two-models, h-design-choice, h-docs | sim | polyagent (`h-two-models` estourou o timeout) |
| locate | **não** | `Bash` ×2 |
| h-find | **não** | `Bash` |
| web | **não** | `Bash` (provável `npm view`; resposta certa por outro caminho) |
| handoff-agent | **não** | `Agent` nativo + `Bash` ×5 |
| handoff-skill | **não** | `Skill` nativo + `Bash`/`Read` ×6 |

## Leitura

- **Handoff: 0/2.** O texto dos PRs #37/#38 não mudou o comportamento. Pedido com subagent, o host
  chamou o `Agent` nativo; pedido com skill, carregou a `Skill` e fez o trabalho sozinho. Em
  nenhum dos dois chamou `delegate`. Isso bate com a queixa do dono: o host delega pouco.
- **Localizar código: 0/2.** `locate` e `h-find` foram resolvidos com `grep` no `Bash`. O hook
  `PreToolUse` não olha `Bash` de leitura (só comandos que gravam artefato), então nada avisou.
- **web:** falha discutível — `npm view` é o jeito certo e barato de achar versão de pacote.
- Onde o prompt nomeia a tarefa de fan-out ou de comando ruidoso, o host acerta.

## Rodada 2 — com prompts de implementação (10/18, 56%)

Mesmo setup, label `after-r2`, custo reportado $11,27 (15/18). Entraram 4 prompts de
implementação que esperam `delegate`/`fast_delegate` (`impl-test`, `impl-feature`, `impl-rename`
e o held-out `h-impl-flag`).

| Grupo | r1 | r2 | O que o host usou nas falhas da r2 |
|---|---|---|---|
| Implementação | — | **2/4** | `impl-test`: `Bash`/`Read` e fez sozinho; `impl-rename`: só `Bash` ×2 (provável `sed`) |
| Handoff | 0/2 | **0/2** | `Agent` nativo; `Skill` nativa e só depois `delegate`, sem `agent` |
| Localizar/ler código | 1/3 | **0/3** | `Bash` (grep) — `read` virou falha entre as rodadas |
| web | 0/1 | 0/1 | `Bash` |
| fan-out, comando ruidoso, controle | 8/8 | 8/8 | — |

Os dois acertos de implementação são fracos: em `impl-feature` e `h-impl-flag` o host primeiro
leu e editou sozinho (`Edit`/`Write` + vários `Bash`) e só chamou `delegate` no fim, sem `agent`.
Ou seja: **o `delegate` aparece como último passo, não como o caminho da tarefa.**

Variação entre rodadas: só `read` mudou (acerto → falha). O resto repetiu, então os padrões acima
não são sorte de uma rodada.

**Conclusão:** a fuga principal é o `Bash`. Ele aparece em todas as falhas, e o hook `PreToolUse`
não olha `Bash` de leitura nem `Agent`/`Skill`. Texto de instrução sozinho (PRs #37/#38) não
mudou isso.

## Rodada com o hook novo — 14/18 (78%)

Mudança medida (mesmo dia): o hook `PreToolUse` passa a (1) bloquear uma vez, fail-open, o `Bash`
cuja primeira parte da pipeline é `grep`/`rg`/`find`/`git grep`, apontando `explore`/`read_slice`;
e (2) avisar, sem bloquear, em `Agent`/`Task`/`Skill`, apontando o param `agent` do `delegate`.
Matcher do host: `Read|Grep|Glob|WebSearch|WebFetch|Bash|Edit|Write|MultiEdit|Agent|Task|Skill`.
Label `hook-r1`, mesmo setup, custo reportado $10,88 (14/18).

| Grupo | r2 (antes) | hook-r1 | Observação |
|---|---|---|---|
| Localizar/ler código | 0/3 | **3/3** | o `grep` foi bloqueado e o host foi para `explore`/`read_slice` |
| Implementação | 2/4 | **3/4** | `impl-rename` foi direto para `fast_delegate`; `impl-test`/`impl-feature` ainda editam sozinhos antes de chamar `delegate`; `h-impl-flag` não delegou |
| Handoff | 0/2 | **0/2** | o aviso em `Agent`/`Skill` não mudou nada: o host segue com a tool nativa |
| fan-out, comando ruidoso, controle | 8/8 | 8/8 | — |
| web | 0/1 | 0/1 | `npm view` pelo `Bash` |
| **Total** | **10/18** | **14/18** | |

Leitura: o bloqueio de uma vez funciona; o aviso sozinho (Agent/Skill) não. Isso repete o que o
estudo de 2026-09-23 já sugeria: texto perde para fricção. Uma rodada só por condição — o salto de
código (0/3 → 3/3) é grande e bate com o mecanismo; os outros números são n pequeno.

## Reavaliar

- ~~Rodar r2~~ e ~~somar prompts de implementação~~: feito em 2026-09-30 (seção acima).
- Candidatos a correção, a medir contra esta linha de base: nudge do hook em `Agent`/`Skill`
  (hoje fora do matcher) apontando o param `agent` do `delegate`; nudge em `Bash` de leitura
  (`grep`/`rg`/`find`) apontando `explore`.
