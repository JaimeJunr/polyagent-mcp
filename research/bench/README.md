# research/bench/ — dado bruto de medição

Dois tipos de arquivo, os dois JSONL (uma linha por evento, sem prompt nem resposta):

| Arquivo | Origem | Uma linha é |
|---|---|---|
| `AAAA-MM-DD-aux.jsonl` | `npm run bench` (`bench/aux-bench.mjs`) | uma rodada de uma tarefa com gabarito: `task`, `cand`, `engine`, `model`, `effort`, `rep`, `ms`, `ok`, `chars`, `err` |
| `AAAA-MM-DD-ratings.md` | `bridge_stats` com export | resumo das notas dadas via `rate` (agregado por engine/modelo/tool, sem dado cru) |

## Como o bench mede

- Pelo caminho real das tools: `runCursor` de `dist/cli.js`, sandbox bwrap ligado, prompts de
  `dist/prompts.js` (os mesmos que `explore`/`read_slice`/`run_filtered`/`web_lookup` usam).
- `ms` é wall-clock do processo inteiro (subida do CLI + loop do agente + modelo). É o tempo que o
  chamador espera. Não confunda com latência de API de leaderboard, que ignora a subida do CLI.
- Gabarito calculado do repo no início da rodada (linha do `resolveFastTier`, contagem do
  `quota.test.ts`). O de `web_lookup` é externo (preço do OpenRouter): confira antes de rodar.
- `err` com "quota exhausted" não é erro do modelo: tire a linha da comparação.

O resumo e a decisão de cada rodada vão num estudo em `research/`, não aqui.
