# Modelos de decisão gratuitos no lugar do Jev

Data: 2026-10-24. Pergunta: os modelos de decisão gratuitos do OpenRouter que falam o mesmo
`/v1/systemone` do Jev servem de substituto para o gate de consenso do `fan_out` e o shadow do
`delegate`?

## Candidatos

| Modelo | Mesmo schema do Jev | Preço | Contexto |
|---|---|---|---|
| `typesafe/jev-1.13` (atual) | — | US$ 0,042/M entrada, saída grátis | 32K |
| `inception/mercury-decide:free` | sim (página do OpenRouter) | grátis | 32K |
| `baseten/elephant-1:free` (9B, Qwen3.5-9B) | sim (TypeSafe System One) | grátis | 16K |
| `baseten/mammoth-1:free` (27B, Qwen3.5-27B) | sim (TypeSafe System One) | grátis | 16K |
| `perplexity/pplx-decider-flash-v1.2` | contrato typed-decision; `/v1/systemone` não confirmado | US$ 0,01/M | 262K |
| `respan/span-01-lite` | não confirmado; é pontuação de comportamento | grátis | — |

Os dois últimos ficaram fora do bench. Limite dos `:free` no OpenRouter: 20 req/min e 50/dia,
1000/dia com ≥ US$ 10 de crédito. Fonte do benchmark do fabricante (Jev Decision Index 0.4:
Mammoth 71,24, Elephant 62,65, Jev 1.14 62,2):
<https://labs.baseten.co/articles/mammoth-1-and-elephant-1-frontier-decision-models>.

## Método

`bench/jev-bench.mjs 1 all` com `POLYAGENT_JEV_MODEL=<id>`, as mesmas fixtures de
`2026-09-24-jev-decisions-bench.md`: 24 casos de `fan_out` curto, 12 longos e 25 de shadow
(agora com os três níveis nomeados). Uma repetição por modelo, 61 chamadas cada, serial, chave via
chaveiro (`secret-request --keyring openrouter`). O bench passou a gravar `model` em cada linha,
um arquivo por modelo, e espera 3,1 s antes de cada chamada `:free` (o `ms` inclui essa pausa;
latência real ≈ `ms − 3100`). JSONL em `research/bench/2026-10-24-jev-bench*.jsonl`.

## Resultado (2026-10-24)

| Modelo | `fan_out` curto a 0,85 | `fan_out` longo a 0,85 | a 0,95 (curto) | shadow exato | shadow na faixa | latência mediana | custo 61 chamadas |
|---|---|---|---|---|---|---|---|
| Jev 1.13 | 100%, 0 false skip | 100% | 87,5% (3 skips perdidos) | 19/25 (76%) | 22/25 (88%) | 517 ms | US$ 0,0022 |
| Mercury Decide | 100%, 0 | 100% | 100% | 22/25 (88%) | 24/25 (96%) | ≈ 545 ms | 0 |
| Elephant 1 | 100%, 0 | 100% | 91,7% | **24/25 (96%)** | **25/25 (100%)** | ≈ 455 ms | 0 |
| Mammoth 1 | 100%, 0 | 100% | 100% | 23/25 (92%) | 24/25 (96%) | ≈ 500 ms | 0 |

- Nenhum erro, nenhum 429 nas 244 chamadas.
- No gate de consenso a 0,85 (o threshold em uso) os quatro empatam: zero false skip, inclusive
  nos casos difíceis e nos longos. O gate não diferencia os modelos.
- O shadow separa: o Jev erra o nível `middle` (3 viram `low`, 3 viram `high`). Os três gratuitos
  acertam mais; Elephant errou só um caso (`high` → `middle`).
- O shadow do Jev caiu de 96% (2026-09-24, cinco níveis) para 76% com os três níveis nomeados.

## Limites

Uma repetição, 25 casos de shadow: a diferença Elephant vs Mammoth (1 caso) é ruído. Fixtures
sintéticas; no uso real (2026-09-26) o Jev acertou só 5/12 do shadow. O limite diário dos `:free`
pode cortar o shadow num dia de uso intenso; a falha já cai no caminho sem Jev, sem quebrar a tool.
Modelo `:free` pode sumir ou ganhar preço sem aviso.

## Decisão

**Aplicada em 2026-10-24** a pedido do dono: trocar o default de `JEV_MODEL` para `baseten/elephant-1:free`
(melhor shadow, mais rápido, grátis), mantendo `POLYAGENT_JEV_MODEL` para voltar ao Jev; o 16K de
contexto cabe no recorte do `fan_out` longo (passou 12/12). As flags seguem opt-in.

## Reavaliar

Repetir com 3 repetições antes de mudar o default. Depois de ligar `POLYAGENT_JEV_SHADOW` com o
modelo novo, comparar o shadow real contra o nível pedido e a nota `rate`, como no estudo de
2026-09-24. Reavaliar se o `:free` sair do ar ou ganhar preço.
