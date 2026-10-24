# Três níveis nomeados no delegate — 2026-10-23

## Decisão

O dono escolheu substituir os cinco níveis numéricos por exatamente três nomes. É uma quebra de
contrato deliberada: `delegate.level` exige `"low"`, `"middle"` ou `"high"`; números não têm
compatibilidade. `fan_out.levels` aceita os mesmos nomes, com pelo menos dois itens e repetição.

| Nível | Engine | Modelo | Effort | Índice AA | $/tarefa AA |
|---|---|---|---|---|---|
| low | codex | gpt-6-luna | max | 38 | 0,07 |
| middle | codex | gpt-6.1-sol | medium | 48 | 0,21 |
| high | claude | claude-opus-5-5 | high | 54 | 1,82 |

Escada: $0,07 → $0,21 (~3×) → $1,82 (~8,7×). Sai Sol 6.1 xhigh; sai Opus 5.5 max.
Os esforços continuam disponíveis por override explícito e seus custos históricos permanecem
para interpretar logs. O fallback Cursor conserva os ids dos três pontos retidos.

O problema observado foi de escolha: com cinco degraus, o host continuava escolhendo entre os
mais baratos. Três nomes tornam a escolha mais clara. Não é uma alegação de que os dois pontos
retirados deixaram de ter capacidade; são opções a menos na superfície da ferramenta.

Low/middle cobrem a maior parte do trabalho, incluindo implementação. High é caro e compartilha
a assinatura Claude do host Claude Code. Cota Codex esgotada afeta low/middle; cota Claude
esgotada afeta high e o host juntos. `fan_out` começa com `["low", "middle"]`; acrescenta
`"high"` só depois de um consenso barato discordar ou para um veredito caro de errar.

`fast_delegate` continua sem nível e conserva a cascata `FAST_CANDIDATES`. A resolução das
auxiliares, o sandbox e `generate_image` não fazem parte desta decisão. O receipt neutro do
`fast_delegate` continua com `requestedLevel: 0`; novos receipts de delegate/fan_out guardam os
nomes. Leitura e stats toleram `requestedLevel` numérico nos JSONL antigos.

## Evidência pública — outubro de 2026

Snapshot fornecido pelo dono para a decisão em 2026-10-23. Não é uma nova execução de benchmark
local; as páginas são mutáveis e não garantem reconstrução exata da classificação nessa data.

| Modelo / effort | Índice AA | $/tarefa | Saída tok/s |
|---|---|---|---|
| Luna max | 38 | 0,07 | 136 |
| Sol 6.1 low | 42 | 0,13 | ~47–50 |
| Sol 6.1 medium | 48 | 0,21 | ~47–50 |
| Sol 6.1 high | 50 | 0,32 | ~47–50 |
| Sol 6.1 xhigh | 51 | 0,39 | ~47–50 |
| Sonnet 5.5 low | 36 | 0,35 | — |
| Sonnet 5.5 medium | 41 | 0,48 | — |
| Sonnet 5.5 high | 47 | 0,88 | — |
| Sonnet 5.5 xhigh | 52 | 2,01 | — |
| Sonnet 5.5 max | 56 | 5,46 | — |
| Haiku 5.5 max | 43 | 0,21 | 235 |
| Opus 5.5 high | 54 | 1,82 | — |
| Opus 5.5 max | 58 | 5,98 | — |

Fontes da AA: [Sol low versus medium](https://artificialanalysis.ai/models/comparisons/gpt-6-1-sol-low-vs-gpt-6-1-sol-medium),
[Sonnet high versus medium](https://artificialanalysis.ai/models/comparisons/claude-sonnet-5-5-high-vs-claude-sonnet-5-5-medium)
e [análise do Opus 5.5](https://artificialanalysis.ai/articles/claude-opus-5-5).
$/tarefa é proxy de uso de cota das assinaturas, não cobrança por chamada do bridge. Os custos
Sonnet deste snapshot diferem do estudo de setembro; esta mudança conserva a tabela histórica
`src/costs.ts`, que já contém os três pontos da escada e modelos usados em outros caminhos.

No snapshot de 2026-10-23, Opus 5.5 lidera SWE-bench Pro com 89,9% e aparece em primeiro no
LMArena WebDev com 1807. Fonte de ranking: [Arena](https://arena.ai/leaderboard?vision_webdev=true),
cuja [tabela WebDev](https://arena.ai/leaderboard/code/webdev) identifica esse ponto como Opus
5.5 **Max**. A liderança pública do modelo não mede diretamente Opus **high**, escolhido aqui.
O recorte exato de SWE-bench Pro é evidência trazida pelo dono; não foi reproduzido por este
estudo nem inferido do índice geral AA.

A [documentação OpenAI](https://developers.openai.com/api/docs/models) recomenda Sol para
balancear capacidade e custo, com medium como padrão na
[página do Sol 6.1](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
A [issue Codex #53407, de 2026-10-12](https://github.com/openai/codex/issues/53407) relata
“at capacity” e perda de streams com Sol xhigh em tarefas longas. É relato de usuário em um
ambiente específico, não prova de que xhigh falha em todos os ambientes.

## Uso local

Notas `rate` locais fornecidas pelo dono, também resumidas no
[estudo de 2026-10-07](2026-10-07-haiku-5-5.md):

| Modelo / effort | Nota média | Avaliações |
|---|---|---|
| Luna max | 4,7 | 7 |
| Sol 6.1 medium | 4,6 | 18 |
| Opus 5.5 high | 4,7 | 10 |

São 35 avaliações entre os três pontos escolhidos, com tarefas diferentes e amostras pequenas.
Não constituem comparação controlada nem demonstram equivalência de qualidade.

## Alternativas descartadas

- Manter cinco níveis: preservaria a ambiguidade de escolha observada pelo dono.
- Sol high/xhigh como degrau extra: ganhos de índice modestos sobre medium (+2/+3), custo maior
  ($0,32/$0,39 contra $0,21) e o relato operacional de xhigh favorecem simplificar a superfície.
- Sonnet 5.5: dominado em todos os pontos no recorte índice/custo. Luna max supera Sonnet low;
  Sol low supera Sonnet medium; Sol medium supera Sonnet high; Opus high supera Sonnet xhigh;
  Opus max supera Sonnet max. Essa é uma leitura da tabela, não uma medição nova de código.
- Haiku max: 43/$0,21 contra 48/$0,21 do Sol medium; sua velocidade de 235 tok/s não justifica
  consumir a assinatura Claude do host no degrau intermediário desta decisão.
- Opus max: sobe de 54 para 58 por ~3,3× o custo de Opus high ($5,98 contra $1,82). Continua
  possível por override, mas deixa de ocupar um nível.

## Reavaliar

- Depois de pelo menos 20 novas avaliações por nível, comparar nota, sucesso, latência e cota.
- Medir se o host passou a escolher middle/high quando necessário, com denominador de chamadas.
- Se tarefas em middle falharem e high gastar cota demais, reexaminar Sol high/xhigh com um bench
  controlado e verificar se a issue de capacidade/streams foi resolvida na CLI em uso.
- Se novos índices de código contradisserem a leitura do índice geral, priorizar evidência de
  código e casos locais; não tratar o índice geral como substituto de qualidade de implementação.
- Se preços, esforços ou limites das assinaturas mudarem, recalcular os saltos e a concentração
  de cota antes de mexer nos três nomes ou na cascata rápida.
