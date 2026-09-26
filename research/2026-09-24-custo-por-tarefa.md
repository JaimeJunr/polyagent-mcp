# Spike — custo por tarefa dos modelos da frota (2026-09-24/25)

Contexto: complementar a [escada de níveis](2026-09-23-tier-pareto.md) com custos por esforço
publicados pela Artificial Analysis (AA), consultados em 2026-09-24/25, e alimentar a coluna de
estimativa nas avaliações locais do `rate`.

**$/tarefa** é a média ponderada em USD por tarefa do *Artificial Analysis Intelligence Index*.
A AA multiplica tokens de entrada, cache, raciocínio e resposta pelos preços de API, divide pelo
número de tarefas e pondera cada avaliação pelo seu peso no índice. **$/tarefa de código** vem do
*AA Coding Agent Index*, com o modelo dentro dos harnesses Claude Code ou Codex. São cargas de
trabalho diferentes. **$/1M in/out** é a tarifa de API por milhão de tokens, não um custo por
tarefa. Como `codex` e `claude` rodam por assinatura, esses custos são **proxies de cota gasta,
não faturas por chamada**. A coluna local `est $/task (AA)` não mede tokens da execução local.

## Tabela A — OpenAI (`codex`)

Índice e custo de código só foram encontrados para `max`.

| Modelo | Esforço | Índice AA | $/tarefa | Índice código | $/tarefa de código | $/1M in/out |
|---|---|---:|---:|---:|---:|---:|
| `gpt-6-luna` | low | 21 | $0,0045 | — | — | $0,10 / $0,50 |
| `gpt-6-luna` | medium | 29 | $0,02 | — | — | $0,10 / $0,50 |
| `gpt-6-luna` | high | 32 | $0,03 | — | — | $0,10 / $0,50 |
| `gpt-6-luna` | xhigh | 34 | $0,04 | — | — | $0,10 / $0,50 |
| `gpt-6-luna` | max | 37 | $0,07 | 41 | $0,18 | $0,10 / $0,50 |
| `gpt-6-sol` | low | 34 | $0,13 | — | — | $2 / $10 |
| `gpt-6-sol` | medium | 40 | $0,25 | — | — | $2 / $10 |
| `gpt-6-sol` | high | 43 | $0,37 | — | — | $2 / $10 |
| `gpt-6-sol` | xhigh | 44 | $0,53 | — | — | $2 / $10 |
| `gpt-6-sol` | max | 48 | $1,06 | 57 | $2,99 | $2 / $10 |
| `gpt-6-astra` | low | 46 | $0,82 | — | — | $10 / $50 |
| `gpt-6-astra` | medium | 50 | $1,54 | — | — | $10 / $50 |
| `gpt-6-astra` | high | 51 | $1,73 | — | — | $10 / $50 |
| `gpt-6-astra` | xhigh | 52 | $2,31 | — | — | $10 / $50 |
| `gpt-6-astra` | max | 53 | $3,26 | 62 | $7,47 | $10 / $50 |

O [estudo de 2026-09-23](2026-09-23-tier-pareto.md) registrou $7,09 para Astra `max` em código;
a página atual de comparação Claude Code × Codex mostra **$7,47**.

## Tabela B — Anthropic (`claude`)

`—` indica dado não encontrado, sem interpolação. Índice e custo de código só foram encontrados
para `max` de Fable 5.1, Opus 5.5 e Opus 5. Resultados de Fable 5.1 e Opus 5.5 na AA incluem
*default fallback*.

| Modelo | Esforço | Índice AA | $/tarefa | Índice código | $/tarefa de código | $/1M in/out | Lançamento | ID de API |
|---|---|---:|---:|---:|---:|---:|---|---|
| Fable 5.1 | low | 47 | $2,37 | — | — | $10 / $50 | 2026-09-01 | `claude-fable-5-1` |
| Fable 5.1 | medium | 49 | $2,98 | — | — | $10 / $50 | 2026-09-01 | `claude-fable-5-1` |
| Fable 5.1 | high | 51 | $3,91 | — | — | $10 / $50 | 2026-09-01 | `claude-fable-5-1` |
| Fable 5.1 | xhigh | 53 | $5,98 | — | — | $10 / $50 | 2026-09-01 | `claude-fable-5-1` |
| Fable 5.1 | max | 53 | $7,63 | 62 | $12,39 | $10 / $50 | 2026-09-01 | `claude-fable-5-1` |
| Opus 5.5 | low | 42 | $0,55 | — | — | $4 / $20 | 2026-09-22 | `claude-opus-5-5` |
| Opus 5.5 | medium | 51 | $1,34 | — | — | $4 / $20 | 2026-09-22 | `claude-opus-5-5` |
| Opus 5.5 | high | 54 | $1,82 | — | — | $4 / $20 | 2026-09-22 | `claude-opus-5-5` |
| Opus 5.5 | xhigh | 56 | $3,46 | — | — | $4 / $20 | 2026-09-22 | `claude-opus-5-5` |
| Opus 5.5 | max | 58 | $5,98 | 66 | $13,04 | $4 / $20 | 2026-09-22 | `claude-opus-5-5` |
| Opus 5 | low | 39 | $1,10 | — | — | $5 / $25 | 2026-07-24 | `claude-opus-5` |
| Opus 5 | medium | 45 | $2,19 | — | — | $5 / $25 | 2026-07-24 | `claude-opus-5` |
| Opus 5 | high | 48 | $3,61 | — | — | $5 / $25 | 2026-07-24 | `claude-opus-5` |
| Opus 5 | xhigh | 50 | $4,88 | — | — | $5 / $25 | 2026-07-24 | `claude-opus-5` |
| Opus 5 | max | 51 | $5,86 | 60 | $10,79 | $5 / $25 | 2026-07-24 | `claude-opus-5` |
| Fable 5 | max | 50 | $8,75 | — | — | $10 / $50 | 2026-06-09 | `claude-fable-5` |
| Sonnet 5 | low | 24 | $0,51 | — | — | $2 / $10 promo; $3 / $15 padrão | 2026-06-30 | `claude-sonnet-5` |
| Sonnet 5 | medium | 28 | $1,00 | — | — | $2 / $10 promo; $3 / $15 padrão | 2026-06-30 | `claude-sonnet-5` |
| Sonnet 5 | high | 32 | $1,79 | — | — | $2 / $10 promo; $3 / $15 padrão | 2026-06-30 | `claude-sonnet-5` |
| Sonnet 5 | xhigh | 34 | $2,87 | — | — | $2 / $10 promo; $3 / $15 padrão | 2026-06-30 | `claude-sonnet-5` |
| Sonnet 5 | max | 38 | $5,09 | — | — | $2 / $10 promo; $3 / $15 padrão | 2026-06-30 | `claude-sonnet-5` |
| Opus 4.8 | max | 42 | $4,08 | — | — | $5 / $25 | 2026-05-28 | `claude-opus-4-8` |
| Opus 4.7 | max | 41 (estimado) | — | — | — | $5 / $25 | 2026-04-16 | `claude-opus-4-7` |
| Sonnet 4.6 | max | 30 | $2,49 | — | — | $3 / $15 | 2026-02-17 | `claude-sonnet-4-6` |
| Haiku 4.5 | extended thinking | 17 | $0,21 | — | — | $1 / $5 | 2025-10-15 | `claude-haiku-4-5-20251001` |
| Haiku 4.5 | thinking off | 15 (estimado) | — | — | — | $1 / $5 | 2025-10-15 | `claude-haiku-4-5-20251001` |

Outros esforços de Fable 5 e Opus 4.8 não foram encontrados. Na consulta de 2026-09-25, a
[página atual de Sonnet 5](https://artificialanalysis.ai/models/releases/claude-sonnet-5)
mostrava `low` 24 (uma leitura anterior dizia 25) e passou a publicar `xhigh` 34 a $2,87. A
tabela e `src/costs.ts` usam esses valores atuais. Para Haiku, o código atribui $0,21 a qualquer
`effort` registrado, inclusive o alias `haiku` de `fast_delegate`, porque essa é a única medição
de Haiku com raciocínio publicada; não é medição específica de `low`.

## Tabela C — outros

| Modelo (engine) | Índice AA | $/tarefa | $/1M in/out | Observação |
|---|---:|---:|---:|---|
| Mercury 2 (`openrouter/inception/mercury-2`) | 14 (estimado) | — | $0,25 / $0,75 | Cobrança por token; custo AA por tarefa não encontrado |
| Grok 4.5 high (`grok`) | 39 | $1,04 | $2 / $6 | `low` não encontrado |
| Jev 1.13 (`decide`) | — | — | $0,042 / $0 | Modelo de decisão; não comparável ao índice de agentes |

## Observações

1. Níveis antes da decisão de nível 4 abaixo, no índice geral: L1 Luna max **$0,07**; L2 Sol high **$0,37**;
   L3 Sol max **$1,06**; L4 Astra max **$3,26**; L5 Opus 5.5 max **$5,98**. São proxies de cota.
2. Opus 5.5 max agora tem índice de código medido: **66 a $13,04/tarefa de código**, acima de
   Astra max (**62 a $7,47**) e Fable 5.1 max (**62 a $12,39**). O estudo de 2026-09-23 dizia que
   a nota do Opus 5.5 ainda não fora publicada. O nível 5 é o topo medido em código, a cerca de
   **1,75×** o custo de código do Astra.
3. Opus 5.5 supera Opus 5 em nota em todos os esforços e custa menos de low a xhigh (high:
   **54 a $1,82** contra **48 a $3,61**). Em `max`, custa **$5,98 contra $5,86**: $0,12 a mais
   por sete pontos de índice geral e seis de código. Esses índices não justificam escolher o Opus 5
   antigo por padrão; o alias `opus` ainda resolve para ele.
4. Sonnet 5 high (**32 a $1,79**) é dominado por Sol high (**43 a $0,37**) e Opus 5.5 low
   (**42 a $0,55**) ou medium (**51 a $1,34**) no índice geral.
5. Haiku 4.5 de `fast_delegate` custa **$0,21/tarefa AA com extended thinking**, como proxy da
   cota da assinatura Claude.

## Fontes

- AA, lançamentos: [Luna](https://artificialanalysis.ai/models/releases/gpt-6-luna),
  [Sol](https://artificialanalysis.ai/models/releases/gpt-6-sol),
  [Astra](https://artificialanalysis.ai/models/releases/gpt-6-astra),
  [Opus 5.5](https://artificialanalysis.ai/models/releases/claude-opus-5-5),
  [Opus 5](https://artificialanalysis.ai/models/releases/claude-opus-5),
  [Fable 5.1](https://artificialanalysis.ai/models/releases/claude-fable-5-1),
  [Sonnet 5](https://artificialanalysis.ai/models/releases/claude-sonnet-5).
- AA, modelos: [Opus 4.8](https://artificialanalysis.ai/models/claude-opus-4-8),
  [Sonnet 4.6](https://artificialanalysis.ai/models/claude-sonnet-4-6-adaptive),
  [Haiku 4.5 com raciocínio](https://artificialanalysis.ai/models/claude-4-5-haiku-reasoning),
  [Mercury 2](https://artificialanalysis.ai/models/mercury-2),
  [Grok 4.5](https://artificialanalysis.ai/models/grok-4-5).
- AA, [Claude Code × Codex](https://artificialanalysis.ai/agents/coding-agents/comparisons/claude-code-vs-codex):
  índice e custo por tarefa de código.
- Anthropic, [preços](https://platform.claude.com/docs/en/about-claude/pricing) e
  [modelos](https://platform.claude.com/docs/en/about-claude/models/overview): tarifas e IDs de API.

## Reavaliar

Quando a AA atualizar índice ou preço, especialmente Sonnet 5, rever a tabela e o mapa central
`AA_COST_PER_TASK` em `src/costs.ts`. Se surgirem custos de código para outros esforços ou medição
local de cota consumida, comparar separadamente com o proxy. A matriz de níveis só muda se o novo
ponto alterar a fronteira de qualidade e custo em código ou o consumo real de cota da frota.


## Decisão: nível 4 → Opus 5.5 high

Decisão do dono em 2026-09-24, com os dados AA de 2026-09-24/25 registrados acima: trocar
`codex|gpt-6-astra|max` por `claude|claude-opus-5-5|high` no nível 4. Opus high tem Intelligence
Index **54 a $1,82/tarefa**, contra **53 a $3,26** de Astra max: **−44% de custo e +1 ponto**.
Os níveis 1, 2, 3 e 5 e todos os `cursorModel` ficam iguais. Nova escada:
**$0,07 → $0,37 (~5×) → $1,06 (~3×) → $1,82 (~1,7×) → $5,98 (~3,3×)**, proxies de cota.

O motivo de 2026-09-23 para manter Astra no nível 4 (topo medido em código) não vale mais:
Opus 5.5 **max** tem Coding Agent Index **66 a $13,04**, contra Astra max **62 a $7,47**.
**A AA ainda não publicou índice de código para Opus 5.5 high.** A decisão de high usa o índice
geral; não extrapola a nota de max para high. É uma exceção por ausência de medição de código à
regra de priorizar código sobre o índice geral, não uma escolha contra um resultado de código.

Codex passa de quatro para **três níveis (1–3)**; Claude passa a **4–5**, na **mesma assinatura
que o orquestrador host Claude Code**. Segundo o relato do dono, em **2026-09-24**, durante esta
própria mudança, a tentativa no host chegou à Anthropic, mas a assinatura Claude atingiu o
**limite de sessão** (reset informado: 00:40). É evidência concreta do compromisso de cota:
quando Claude esgota, níveis 4 e 5 e o host ficam indisponíveis juntos; codex 1–3 continuam
disponíveis. O nível 4 fica mais barato, mas passa a consumir cota do host. Ambos os níveis
altos continuam reservados a tarefas que os níveis baratos não resolvem.

O id `claude-opus-5-5` foi confirmado em execução real em **2026-09-23 com effort max**.
O effort high foi **confirmado ao vivo em 2026-09-26**: `claude -p --model claude-opus-5-5
--effort high` respondeu com `modelUsage` = `claude-opus-5-5`. Em 2026-09-24 a verificação tinha
sido bloqueada pelo limite de sessão da assinatura Claude. O `Not logged in` da tentativa no ambiente do
agente foi atribuído pelo dono à ausência de auth nesse ambiente, não à rejeição do id ou effort.

### Reavaliar

- Publicação do Coding Agent Index AA para **Opus 5.5 high**; confrontar qualidade e custo de código.
- Scores locais de `rate` para `claude|claude-opus-5-5|high|delegate` contra o histórico
  `codex|gpt-6-astra|max|delegate`, informando o número de avaliações de cada grupo.
- Pressão de cota no host Claude Code e indisponibilidade conjunta de host/níveis 4–5.
- Completar o teste ao vivo de `--model claude-opus-5-5 --effort high` quando a sessão liberar,
  lendo a chave de `modelUsage`; a aceitação ainda não foi confirmada por esta mudança.
