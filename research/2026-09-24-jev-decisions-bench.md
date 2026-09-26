# Decisões com Jev: consenso em `fan_out` e shadow do `delegate` (2026-09-24)

O bruto foi gravado em 2026-09-25 UTC; a data no nome do arquivo é UTC.

## Contexto

O estudo avalia dois caminhos opt-in: `POLYAGENT_JEV_FANOUT` pula o árbitro Codex quando
`p(agree) >= threshold` (default `0.85`); `POLYAGENT_JEV_SHADOW` registra a sugestão de nível do
Jev ao lado do nível escolhido por `delegate`, sem agir sobre ela.

A ideia veio do artigo da Av1dlive “How to Build Agentic Harness using Jev” e do repositório
`codejunkie99/keel`: o host prepara opções, o seletor escolhe ou se abstém, o host valida a resposta
e registra cada decisão. Jev é TypeSafe `typesafe/jev-1.13` via OpenRouter: US$ 0,042/M tokens de
entrada, saída gratuita e contexto de 32K.

## Método

`bench/jev-bench.mjs` com `bench/jev-fixtures.mjs`, via `npm run bench:jev`: chamadas reais à API
OpenRouter, executadas em série. Fixtures sintéticas, escritas por um worker LLM:

- `fan_out` curto: 24 casos (12 concordâncias, 12 discordâncias, incluindo 8 near-miss “hard”).
- `fan_out` longo: 12 casos de 7–12K caracteres (4 concordâncias, 8 discordâncias). A divergência
  aparece apenas nos ~800 caracteres finais, sempre depois do caractere 6000.
- `delegate` shadow: 25 prompts rotulados nos níveis 1–5, cada um com faixa aceitável.

Bruto: [`research/bench/2026-09-25-jev-bench.jsonl`](bench/2026-09-25-jev-bench.jsonl).

## Resultados

- **Curto, antes do ajuste:** 3 repetições, 72 chamadas. Em thresholds 0,5–0,9: 100% de acurácia,
  0/36 false skips e taxa de skip de 50%. Em 0,95: 9/36 skips esperados foram perdidos; acurácia
  de 87,5% (63/72). Jev: mediana 465 ms, máximo 768 ms.
- **Árbitro Codex:** 6 execuções pareadas; mediana 7052 ms, máximo 10025 ms. Cada skip economizou
  cerca de 6,2 s na mediana.
- **Longo, antes da correção:** 3 repetições, 36 chamadas. Com threshold 0,85, houve 24/24 false
  skips nas discordâncias: 0% de acurácia para detectar essa classe. O gate esconderia todas as
  divergências reais. Causa: o recorte guardava só o início de cada resposta, limitado a 6000
  caracteres; os vereditos estavam no final.
- **Correção:** `fanOutAgreementRequest` passou a preservar início e fim (aprox. 1/4 do início e
  3/4 do fim), com marcador de elisão. Foram adicionados testes TDD.
- **Longo, depois da correção:** 3 repetições, 36 chamadas. Acurácia de 100%, 0/24 false skips em
  todos os thresholds 0,5–0,95 e taxa de skip de 33% (proporção de casos concordantes). Reexecução
  curta de 1 repetição: resultado inalterado.
- **Shadow:** 3 repetições, 75 chamadas. Exato: 96% (72/75); dentro da faixa: 100% (75/75); zero
  sobre-escaladas e zero sub-escaladas. Única confusão: 3 tarefas de nível 4 receberam nível 3.
  Mediana: 458 ms.
- **Custo:** cerca de US$ 0,0064 no estudo todo: fanout curto US$ 0,001056, shadow US$ 0,001407,
  fanout longo US$ 0,00391 por 36 chamadas.

## Decisão

Manter `POLYAGENT_JEV_FANOUT` e `POLYAGENT_JEV_SHADOW` desligadas por padrão. Manter threshold
`0.85`. Shadow é apenas coleta de dados; Jev não escolhe o nível efetivo.

## Limites

- Fixtures sintéticas escritas por LLM são mais limpas que saídas reais de workers; até os near-miss
  ainda são relativamente explícitos.
- Nenhuma saída real de `fan_out` foi testada.
- Saídas com mais de ~24K caracteres no total continuam sujeitas a recorte.
- Os rótulos shadow refletem o julgamento do autor, não resultados medidos.
- A alegação de “~80% de redução de custo” do tweet não foi validada neste estudo.

## Fontes

- [TypeSafe Jev 1.13 no OpenRouter](https://openrouter.ai/typesafe/jev-1.13/)
- [How to Build Agentic Harness using Jev — Av1dlive](https://x.com/Av1dlive/status/2102802621664985241)
- [Como usar Jev — OpenRouter](https://openrouter.ai/blog/tutorials/how-to-use-jev/)
- [Jev vs. Claude Opus 5 em classificação — OpenRouter](https://openrouter.ai/blog/insights/jev-vs-claude-opus-5-classification/)
- [codejunkie99/keel](https://github.com/codejunkie99/keel)
- [RouteLLM](https://arxiv.org/abs/2406.18665)
- [REFLEX](https://arxiv.org/abs/2609.26532)
- [Av1dlive, tweet sobre resultados](https://x.com/Av1dlive/status/2103190313624039620)

## Reavaliar

Depois de habilitar `POLYAGENT_JEV_FANOUT`/`POLYAGENT_JEV_SHADOW` em uso real, ler os registros
`decision` em `POLYAGENT_LOG`: evidência de false skip (reexecuções do usuário) e escolha shadow
contra nível efetivo e avaliação (`rate`). Só então considerar deixar Jev escolher o nível. Repetir
o benchmark quando sair uma nova versão do Jev.

**Uso real, medido em 2026-09-26:** 12 registros `delegate_level_shadow`; o Jev coincidiu com o
nível pedido em só 5/12 (42%, contra 96% no bench), quase sempre um nível acima (`2→3`, `3→4`).
Zero registros de `fan_out_agreement`: o host ainda não chama `fan_out`.

**Clareza do prompt (adicionado em 2026-09-26):** a mesma chamada do shadow pergunta três critérios
noul (`names_target`, `defines_done`, `single_task`) e grava `delegate_prompt_clarity_shadow`
com `decision.session` para cruzar com `rate`. Smoke no Jev real: prompt vago 0,04/0,09/0,32
(unclear), três tarefas misturadas 0,53/0,21/0,11 (unclear), prompt com arquivo e teste
0,99/0,98/0,97 (clear); ~0,5 s e US$ 0,00002 por chamada. Reavaliar: prompts `unclear` têm nota
`rate` menor? Só com essa correlação considerar avisar ou bloquear antes do worker.
