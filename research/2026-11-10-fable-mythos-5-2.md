# Claude Fable 5.2 e Mythos 5.2 (estudo de 2026-11-09, gravado em 2026-11-10)

Sem medição nossa, nada aplicado. O estudo foi feito na sessão de 2026-11-09, que não gravou o
arquivo porque o dono estava "só estudando"; dali saiu apenas a correção da skill `model-refresh`
(PR 72, passo "pesquisar antes de opinar"). Este arquivo recupera o conteúdo e confere os números
na Artificial Analysis em 2026-11-10.

## O que são

- **Fable 5.2** e **Mythos 5.2** são o mesmo modelo por baixo, com o mesmo preço.
- O Fable tem travas fortes contra uso indevido e está em todos os planos pagos do Claude.
- O Mythos tem menos travas e só sai para organizações aprovadas em programas de cibersegurança e
  ciências da vida (é dele o resultado dos capsídeos de terapia gênica). **Fora do nosso alcance.**
- Preço de API (VENDOR): US$ 8 por milhão de tokens de entrada e US$ 40 de saída; o fast mode
  custa o dobro. O Opus 5.5 custa US$ 4 / 20, então o Fable custa o dobro por token.

## Números

AA = Artificial Analysis, Intelligence Index **v5** (não comparar com as notas antigas do
`CLAUDE.md`). Terminal-Bench 4.0 e FrontierCode 2.0 vieram da pesquisa de 2026-11-09 e **não
foram reconferidos**.

| Fable 5.2 | Nota AA v5 | US$/tarefa | Terminal-Bench 4.0 | FrontierCode 2.0 | Conferido |
|---|---:|---:|---:|---:|---|
| low | 54 | 3,10 | 54,5% | 38,4% | **não**: a AA não publica o custo do low |
| medium | 56 | 3,80 | 55,1% | 41,3% | nota e custo sim (AA) |
| high | 62 | 9,08 | 59,6% | 49,1% | nota e custo sim (AA) |
| xhigh | 62 | 14,83 | 61,6% | 47,6% | nota e custo sim (AA) |
| max | 65 | 26,54 | 59,6% | 48,8% | nota e custo sim (AA) |

- Max lidera o índice v5 (65): 5 pontos acima do Gemini 4 Carbon high e 6 acima do Opus 5.5 max.
- Na mesma tabela da AA: Opus 5.5 max US$ 10,0 por tarefa; GPT-6.1 Sol US$ 1,27; Fable 5.1 max
  US$ 12,99 (o corte de 20% no preço por token não baixou o custo por tarefa: o 5.2 gasta mais
  tokens).
- Alegação da Anthropic (VENDOR, FrontierCode 2.0): Fable high ≈ Opus 5.5 max por metade do custo;
  xhigh é a maior nota entre os modelos testados.

## O erro da sessão de 2026-11-09

O agente estimou o Fable 5.2 high em ~US$ 3,1 por tarefa aplicando o corte de preço sobre o Fable
5.1, sem pesquisar. A AA já mostrava US$ 9,08 (3× a estimativa). Isso motivou o PR 72.

## O que isso diz para o polyagent

- O nível high é Opus 5.5 high, US$ 1,82 por tarefa na medição de setembro (índice anterior; não
  achamos o custo dele no v5).
- Mesma nota que o nosso high (54): o Fable low custaria ~1,7× mais (valor não conferido).
- Fable high: +8 pontos por ~5× o custo. Melhor e bem mais caro; **não compensa no nível high**.
- Uso possível: veredito caro pontual via `delegate` com `model: "claude-fable-5-2"` explícito,
  na mesma assinatura Claude do host. O id não foi confirmado em execução real.

## Fontes

- AA, página do modelo (INDEPENDENT): https://artificialanalysis.ai/models/claude-fable-5-2
- AA, medium (INDEPENDENT): https://artificialanalysis.ai/models/claude-fable-5-2-medium
- AA no X, lançamento no índice v5: https://x.com/ArtificialAnlys/status/2119878995386982508
- R&D World (custo por tarefa dobrou no max): https://www.rdworldonline.com/anthropic-says-fable-5-2-nearly-doubles-its-predecessors-hardware-design-score-token-prices-fell-20-but-the-cost-per-task-doubled-at-full-effort/
- Planos e preço de API: https://kingy.ai/blog/claude-fable-5-2/
- Anúncio da Anthropic no X (@claudeai), 9/11/2026, colado pelo dono.

## Reavaliar

- Quando a AA publicar o custo do low: confirmar ou corrigir a linha low.
- Antes de qualquer uso: confirmar o id `claude-fable-5-2` com `claude -p --model` e `modelUsage`.
- Se o high precisar de mais qualidade e a cota Claude permitir, comparar Fable medium (56,
  US$ 3,80) contra Opus 5.5 max no mesmo índice v5.
