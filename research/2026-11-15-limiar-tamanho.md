# Limiar de tamanho: a partir de quando delegar antes de explorar compensa

Data: 2026-11-15. Pergunta: o piloto mostrou que delegar a tarefa inteira antes de explorar reduz o custo do host
em tarefa pequena (implement) e em lote. Esse ganho vale também para uma correção de uma linha?

## Método

- Harness `bench/quota-eval.mjs` com `QUOTA_SIZE_FOCUSED=1`; fixtures em `bench/quota-size-fixtures.mjs`.
- Quatro tamanhos: `tiny` (corrigir `>` para `>=` em uma função), `implement` (ledger do piloto), `medium`
  (`computeFee` + `applyTransfer` com validações e testes) e `batch` (lote transacional do piloto).
- Dois braços: `lean` (contexto enxuto, sem Polyagent) e `coarse` (delegar a tarefa inteira ao Codex Luna medium antes
  de ler). Host `claude-sonnet-5-5` medium; 2 repetições por célula, ordem rotacionada; 16 trials, note2.
- Métrica: custo equivalente de API do host (proxy), não cota real da assinatura. Só trials aceitos entram na média.
- Uma primeira rodada foi descartada: o servidor MCP não conectava (`node_modules` ausente no runtime), e o `coarse`
  fez a tarefa sozinho, com 0 workers. Nesta rodada válida, todo trial `coarse` aceito tem `mcp__polyagent__delegate`
  e 1 worker.

## Resultado

| Tarefa | `lean` (US$) | `coarse` (US$) | Variação |
|---|---|---|---|
| tiny | 0,0269 | 0,0847 | +215% |
| implement | 0,0288 | 0,0292 | +1% |
| medium | 0,0444 | 0,0331 | −25% |
| batch | 0,0605 | 0,0334 | −45% |

Total pareado: `coarse` +20,1% (US$ 0,386 contra 0,321). Aceitos: `lean` 8/8, `coarse` 7/8. A falha foi `0-batch-coarse`.

## Leitura

- O ponto de virada fica entre `implement` e `medium`. Em tarefa de uma linha, delegar custou mais.
- n=2 por célula. O +215% do `tiny` vem de um trial de US$ 0,142 (o outro custou US$ 0,027, igual ao `lean`);
  a direção é coerente com o piloto, os percentuais exatos não são firmes.
- Neste run o `implement` ficou neutro (+1%), enquanto o piloto anterior mediu −27% a −31%: a variação entre rodadas
  é grande e o ganho da tarefa pequena não é confiável.
- Ação tomada: a regra "delegue a tarefa autocontida antes de explorar" ganhou piso de tamanho (média ou maior) em
  `src/index.ts`, `src/claudeMd.ts` e `src/skill.ts`.

## Reavaliar

- Mais repetições (≥5 por célula) em `tiny`, `implement` e `medium` para fixar o limiar.
- Cota real da assinatura (não só proxy de API), outras engines de worker (Claude Haiku, Sol medium) e tarefas que
  não são código (revisão, diagnóstico): ainda não medidos.

Dados: `research/bench/2026-11-15-limiar-tamanho-results.jsonl`.
