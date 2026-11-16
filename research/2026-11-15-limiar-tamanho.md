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

## Adendo 2026-11-16: 6 repetições por célula

Mesmo harness, `QUOTA_REPETITIONS=6`, retomando as 16 tentativas anteriores (48 no total, 24 pares).
Dados: `research/bench/2026-11-16-limiar-tamanho-6rep-results.jsonl`. Todo trial `coarse` delegou (`workers` ≥ 1).

| Tarefa | Custo host (proxy de API) `coarse` vs `lean` | `coarse` aceito | `lean` aceito |
|---|---|---|---|
| tiny | +66,8% | 6/6 | 6/6 |
| implement | −6,8% | 6/6 | 6/6 |
| medium | −27,3% (−28,3% só nos 3 pares aceitos) | 3/6 | 6/6 |
| batch | −40,0% (−46,2% só nos 3 pares aceitos) | 3/6 | 6/6 |

Total pareado: −12,3% (US$ 0,904 contra 1,031). Aceitos: `lean` 24/24, `coarse` 18/24.

Leitura:
- O limiar se confirma: tiny custa mais delegado (+67%), implement é neutro (−7%), medium e batch economizam 27-40%.
- Achado novo: em medium e batch o `coarse` reprovou o critério de qualidade em metade das tentativas (3/6 cada),
  e o `lean` não reprovou nenhuma. A economia do host nessas tarefas vem com mais risco de entrega errada.
  O worker Codex Luna medium entregou resposta que não passou no check em `medium` reps 2, 4, 5 e `batch` reps 0, 4, 5.
- O custo medido é só o do host Claude. O custo do worker (Codex, ~90-170k tokens de entrada por trial) não entra no proxy:
  parte da economia é troca de assinatura, não redução do trabalho total.
- Os −25% e −45% de n=2 eram otimistas; com n=6 ficam −27% e −40%, mas com a ressalva de qualidade acima.

Efeito na regra de roteamento: o piso de tamanho (média ou maior) continua certo; falta dizer que o resultado do worker
deve ser verificado antes de dar a tarefa por pronta (já está em "After the result" da skill).

Ainda não medido: cota real da assinatura, outros workers (Claude Haiku, Sol medium) e se um worker mais forte
elimina as reprovações de medium/batch.
