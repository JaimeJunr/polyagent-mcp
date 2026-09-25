# research/bench/ — dado bruto de medição

Quatro tipos de arquivo; três são JSONL (uma linha por evento, sem prompt nem resposta):

| Arquivo | Origem | Uma linha é |
|---|---|---|
| `AAAA-MM-DD-aux.jsonl` | `npm run bench` (`bench/aux-bench.mjs`) | uma rodada de uma tarefa com gabarito: `task`, `cand`, `engine`, `model`, `effort`, `rep`, `ms`, `ok`, `chars`, `err` |
| `AAAA-MM-DD-jev-bench.jsonl` | `npm run bench:jev -- [reps] [all\|fanout\|shadow] [--arbiter]` | uma chamada Jev ou arbiter: `suite`, `kind`, `id`, `rep`, `label`/`expected`, `p`/`choice`, `confidence`, `ms`, `cost`, `err` |
| `AAAA-MM-DD-adoption.jsonl` | `node bench/adoption-eval.mjs` | uma sessão Claude Code por prompt: ferramentas escolhidas, contagens `bridge`/`native`/`other`, `hit`, `violation`, custo, duração, turnos, erro e timeout |
| `AAAA-MM-DD-ratings.md` | `bridge_stats` com export | resumo das notas dadas via `rate` (agregado por engine/modelo/tool, sem dado cru) |

## Avaliação de adoção

Rode `node bench/adoption-eval.mjs [label] [prompt-ids-separados-por-vírgula]`; sem IDs, executa o conjunto inteiro. As linhas guardam `expect`, a sequência de nomes de tools e se houve `ToolSearch` por polyagent, sem prompt nem resposta. `hit` mede o uso esperado; no controle, significa que `fan_out` não foi usado. `bridge`, `native` e `other` são contagens de chamadas.

O eval usa a configuração real do Claude Code e consome uso da assinatura. Prompts que esperam `fan_out` iniciam vários workers; rode deliberadamente.

## Bench Jev

`node bench/jev-bench.mjs [reps=1] [all|fanout|shadow] [--arbiter]` usa as fixtures rotuladas de
`bench/jev-fixtures.mjs` e faz chamadas reais à API OpenRouter via `dist/jev.js`. Rode `npm run build`
antes. As chamadas são seriais. Sem chave OpenRouter, o script encerra antes da primeira chamada.
Falhas individuais entram no JSONL com `err` e contam como fallback no resumo de fanout.
`--arbiter` mede até seis chamadas adicionais pelo caminho real `runCursor`/codex, uma por caso
selecionado mesmo com mais de uma repetição; seu `cost` é `null` porque `runCursor` não o retorna.
O resumo calcula as taxas sobre todas as tentativas e mostra também quantas respostas foram válidas.

## Como o bench mede

- Pelo caminho real das tools: `runCursor` de `dist/cli.js`, sandbox bwrap ligado, prompts de
  `dist/prompts.js` (os mesmos que `explore`/`read_slice`/`run_filtered`/`web_lookup` usam).
- `ms` é wall-clock do processo inteiro (subida do CLI + loop do agente + modelo). É o tempo que o
  chamador espera. Não confunda com latência de API de leaderboard, que ignora a subida do CLI.
- Gabarito calculado do repo no início da rodada (linha do `resolveFastTier`, contagem do
  `quota.test.ts`). O de `web_lookup` é externo (preço do OpenRouter): confira antes de rodar.
- `err` com "quota exhausted" não é erro do modelo: tire a linha da comparação.

O resumo e a decisão de cada rodada vão num estudo em `research/`, não aqui.
