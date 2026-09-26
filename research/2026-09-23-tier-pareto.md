> Nível 4 superado pela [decisão de Opus 5.5 high](2026-09-24-custo-por-tarefa.md#decisão-nível-4--opus-55-high); demais níveis preservados.
# Spike — escada de níveis do `delegate` pela fronteira de Pareto (2026-09-23)

Decisão: refazer a matriz `TIERS` (`src/cli.ts`) depois do lançamento de GPT-6 Sol, GPT-6 Luna e
Claude Opus 5.5 (avaliados pela Artificial Analysis em 2026-09-22). Aprovada pelo dono em 2026-09-23.

## Resultado

| Nível | Modelo (engine) | Nota geral (AA) | Custo/tarefa | Salto de custo |
|---|---|---:|---:|---:|
| 1 | `gpt-6-luna` max (codex) | 37 | $0,07 | — |
| 2 | `gpt-6-sol` high (codex) | 43 | $0,37 | ~5× |
| 3 | `gpt-6-sol` max (codex) | 48 | $1,06 | ~3× |
| 4 | `gpt-6-astra` max (codex) | 53 (Coding Agent Index 62) | $3,26 | ~3× |
| 5 | `claude-opus-5-5` max (claude) | 58 | $5,98 | ~2× |

Antes (roster de 2026-09-14): 1 Luna 5.6 max · 2 Sol 5.6 xhigh · 3 Grok 4.6 high · 4 Astra max · 5 Fable max.

## Critérios

1. **Só pontos da fronteira de Pareto**: nenhum outro modelo tem nota ≥ por custo ≤.
2. **Código antes da nota geral.** O polyagent é frota de agentes de código, então quando as duas
   notas discordam vale o Coding Agent Index (DeepSWE v1.1 + Terminal-Bench 4.0 + SWE-Atlas-QnA).
3. **Degraus suaves** (~3× por nível). Pedido do dono: o nível 1 tem que ser o mais barato que ainda
   vale a pena, e o nível 2 tem que valer a pena como um degrau de verdade para tarefa barata.
4. **Só assinatura** (codex/claude). Na assinatura o custo é cota, não dinheiro por chamada. Por isso
   `$/tarefa` aqui serve como aproximação de cota gasta, não de fatura.

## Por que cada troca

- **Grok 4.6 high saiu (nível 3).** Nota geral 44 a $1,86, a mesma do Sol xhigh (44 a $0,53) custando
  3,5× mais. Como degrau acima do nível 2 ele não somava nada. Nota de código do `high` não encontrada.
- **Sol 6 max entrou no 3.** 48 geral e 57 em código a $2,99/tarefa de código, na fronteira dos dois
  índices.
- **Sol 6 high no 2 (e não xhigh).** O xhigh dá +1 ponto (44 contra 43) a +43% de custo. Com o high,
  o salto 1→2 cai de 7,5× (Luna max → Sol xhigh) para 5×.
- **Astra ficou no 4**, mesmo sendo dominado na nota geral pelo Opus 5.5 high (54 a $1,82 contra 53 a
  $3,26). Em código ele é o topo **medido**: 62, empatado com o Fable 5.1 max, e 40% mais barato que
  ele ($7,09 contra $12,4). O Opus 5.5 ainda não tem nota de código.
- **Opus 5.5 max no 5** (escolha do dono). É a maior nota geral já medida pela AA (58). Tira o Fable
  5.1, que empata com o Astra em código e custa mais.

## Descartados, e por quê

- **DeepSeek V4 Flash 0731 no nível 1** (sugestão de uma pesquisa): Coding Agent Index 39 a $0,09,
  contra 41 do Luna max. É pior em código **e** pay-per-token. O Luna sai de graça por chamada, porque
  é assinatura.
- **MiMo-V2.6-Pro no nível 2** (sugestão da outra pesquisa): 46 geral a $0,13, e domina Luna max e
  Sol xhigh/high na nota geral. Ficou fora porque (a) é pay-per-token via OpenRouter (slug
  `xiaomi/mimo-v2.6-pro`, $0,435/$0,87 por 1M tokens) e cobraria dinheiro no nível mais usado; (b) não
  tem Coding Agent Index; (c) é lento (~76 tok/s); (d) saiu em 2026-09-21, sem Arena nem BridgeBench.
  Para testar sem mexer na matriz: `delegate(engine:"opencode", model:"openrouter/xiaomi/mimo-v2.6-pro")`.
- **Opus 5.5 high no nível 4** (fronteira geral): adiado até sair a nota de código dele. Além disso, 4
  e 5 na mesma assinatura Claude disputam a cota com o próprio orquestrador do host.
- **Fable 5.1**: dominado nos dois índices (Astra em código, Opus 5.5 na nota geral).

## Custo aceito

Codex tem 4 dos 5 níveis. Se a cota dele estourar, os níveis 1 a 4 caem juntos (antes eram 1, 2 e 4).

## Números (Artificial Analysis, conferidos em 2026-09-23)

Índice geral v4.3.2. Atenção: a troca para a v4.3.2 derrubou todas as notas em 12 a 19 pontos, então
não compare com rankings de meses anteriores.

| Entrada | Nota geral | Custo/tarefa |
|---|---:|---:|
| GPT-6 Luna low / medium / high / xhigh / max | 21 / 29 / 32 / 34 / 37 | $0,0045 / $0,02 / $0,03 / $0,04 / $0,07 |
| GPT-6 Sol low / medium / high / xhigh / max | 34 / 40 / 43 / 44 / 48 | $0,13 / $0,25 / $0,37 / $0,53 / $1,06 |
| GPT-6 Astra max | 53 | $3,26 |
| Claude Opus 5.5 medium / high / xhigh / max | 51 / 54 / 56 / 58 | $1,34 / $1,82 / $3,46 / $5,98 |
| Grok 4.6 high | 44 | $1,86 |
| MiMo-V2.6-Pro | 46 | $0,13 |

Coding Agent Index (custo por tarefa de código):

| Entrada | Índice | Custo/tarefa | Detalhe |
|---|---:|---:|---|
| GPT-6 Luna max | 41 | $0,18 | DeepSWE 64%, Terminal-Bench 4.0 15%, SWE-Atlas-QnA 44% |
| DeepSeek V4 Flash 0731 max | 39 | $0,09 | DeepSWE 54% |
| GPT-6 Sol max | 57 | $2,99 | DeepSWE 69%, TB 43%, QnA 58% |
| GPT-6 Astra max | 62 | $7,09 | DeepSWE 68%, TB 56%, QnA 62% |
| Claude Fable 5.1 max (Claude Code) | 62 | $12,4 | — |
| Claude Opus 5.5 | não publicado | — | — |
| MiMo-V2.6-Pro | não publicado | — | — |

Fontes:
- https://artificialanalysis.ai/leaderboards/models
- https://artificialanalysis.ai/models/releases/comparisons/gpt-6-luna-vs-gpt-6-sol
- https://artificialanalysis.ai/agents/coding-agents
- https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier
- https://artificialanalysis.ai/articles/benchmarking-gpt-6-astra
- https://openrouter.ai/xiaomi/mimo-v2.6-pro

Outras fontes consultadas e por que pesaram menos:
- **Arena Agent** (arena.ai/leaderboard/agent): mede uso real (1,85M sessões), mas os dados são de
  2026-09-15, antes do Opus 5.5 e do GPT-6 Sol.
- **BridgeBench**: coloca Astra 1º em código (7,2). Mas o próprio escore já embute custo (não dá pra
  cruzar com custo de novo), e ele ainda não avaliou Opus 5.5 nem GPT-6 Sol.
- **CheapestInference** (relatório mensal de Pareto): cruza nota com preço de saída por 1M tokens, e
  não com custo por tarefa. Além disso, não tinha os lançamentos de 2026-09-22.

## Ids verificados em execução real (2026-09-23)

`gpt-6-luna` e `gpt-6-sol` via `codex exec` (efforts aceitos: low…max; Sol também `ultra`), e
`claude-opus-5-5` via `claude -p --model claude-opus-5-5`. O alias `opus` **ainda resolve para
`claude-opus-5`**, então use sempre o id completo.

## Reavaliar

Em 1 ou 2 semanas, quando entrarem a nota de código do Opus 5.5 e as avaliações do MiMo-V2.6-Pro e do
GPT-6 Sol na Arena e no BridgeBench. Se o Opus 5.5 high passar do Astra em código, ele vira candidato
ao nível 4. Se o MiMo mostrar código forte, vale discutir abrir exceção pay-per-token no nível 2.
