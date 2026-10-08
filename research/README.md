# research/ — base de pesquisa do polyagent-mcp

Tudo o que o projeto **mediu ou pesquisou** para decidir modelo, engine, esforço ou ordem de
cascata. O código aponta pra cá quando uma escolha precisa de justificativa (ex.: o comentário da
matriz `TIERS` em `src/cli.ts`). Não substitui benchmark público: junta o que é público com o que
**nós** medimos no caminho real (`runCursor` + bwrap) e com as notas dadas pelo uso (`rate`).

## Convenções

- **Um estudo por arquivo**, nome `AAAA-MM-DD-<assunto>.md` (a data é a da medição).
- Todo número carrega **fonte** (URL) ou **como foi medido** (script + comando), e a data.
- Seções que todo estudo tem: a decisão/resultado, os critérios, o que foi descartado e por quê,
  os números, e **Reavaliar** (quando e o que faria a decisão mudar).
- Estudo superado não é apagado: ganha uma linha no topo apontando pro substituto.
- Dado bruto de medição vai em `bench/` (JSONL); o estudo guarda só o resumo.

## Estudos

| Data | Estudo | Decidiu / cobre |
|---|---|---|
| 2026-10-07 | [Claude Haiku 5.5 contra GPT-6 Luna](2026-10-07-haiku-5-5.md) | Id `claude-haiku-5-5`; alias `haiku` já resolve para ele; custo AA por effort em `src/costs.ts`; bench real 9/9, mediana 5,6 s contra 8,6 s do Luna medium; Haiku 5.5 medium vira 2º do `FAST_CANDIDATES`; Pareto do `delegate` revista e nível 3 passa a Sol 6.1 xhigh (max: 12/19 sucessos, p50 26,6 min) |
| 2026-09-30 | [Eval de adoção depois dos PRs #37/#38](2026-09-30-adoption-handoff.md) | **Aplicada e medida:** r2 10/18 → hook novo 14/18. Bloquear `grep` no Bash uma vez levou localizar código de 0/3 a 3/3; implementação 2/4 → 3/4; aviso em `Agent`/`Skill` não mudou o handoff (0/2) |
| 2026-09-30 | [GPT-6.1 Sol nos níveis 2 e 3](2026-09-30-gpt-6-1-sol.md) | Índice e custo AA por esforço; níveis 2/3 passam a medium/max; escada $0,07 → $0,21 → $0,72 → $1,82 → $5,98; id confirmado via codex-cli 0.159.2 |
| 2026-09-28 | [Laya local (Unsloth Studio) no lugar do Jev](2026-09-28-laya-local.md) | Mesmo bench do Jev contra `laya-multilingual` e `laya-typed-decisions` via `POLYAGENT_JEV_URL`; seguro no gate a 0,85 mas quase não pula, `fan_out` longo estoura a janela, shadow ruim; Jev continua |
| 2026-09-28 | [Claude Sonnet 5.5 contra a frota](2026-09-28-sonnet-5-5.md) | Índice AA e $/tarefa por esforço; fora da fronteira de Pareto, `TIERS` não muda; custo entra em `src/costs.ts`; id ainda sem teste ao vivo |
| 2026-09-24 | [Decisões com Jev: consenso em `fan_out` e shadow do `delegate`](2026-09-24-jev-decisions-bench.md) | Benchmark sintético do gate de consenso e da sugestão shadow de nível; flags seguem opt-in |
| 2026-09-24/25 | [Custo por tarefa dos modelos](2026-09-24-custo-por-tarefa.md) | $/tarefa AA, custo de código e proxy de cota; decisão de nível 4 → Opus 5.5 high e impacto na cota do host |
| 2026-09-23 | [Escada de níveis pela fronteira de Pareto](2026-09-23-tier-pareto.md) | Matriz histórica de 2026-09-23 (Luna max · Sol high · Sol max · Astra max · Opus 5.5 max); nível 4 superado pela decisão de 2026-09-24 |
| 2026-09-23 | [Bench das tools auxiliares e do fast_delegate](2026-09-23-aux-tools-bench.md) | **Aplicada:** Luna medium explícito nas auxiliares; cascata Luna medium → Haiku → mercury-2 → Grok |
| 2026-09-23 | [Como fazer o agente usar mais o polyagent](2026-09-23-tool-adoption-steering.md) | **Medido:** 3 mudanças (fan_out alwaysLoad, dica por prompt, cross-check pós-veredito). Com Opus 5.5: acertos 7 → 9 em 19 pares, 2 melhoras × 0 pioras, ainda não significativo |
| 2026-09-18 | [Dialeto de flags de cada CLI](2026-09-18-cli-dialects.md) | Como cada engine recebe prompt, modelo, esforço, autonomia e resume |
| 2026-09-18 | [Engine opencode](2026-09-18-opencode-engine.md) | Integração do `opencode run` (pay-per-token, OpenRouter) |
| 2026-09-18 | [Engine kimi](2026-09-18-kimi-engine.md) | Integração do `kimi -p` |
| 2026-09-18 | [Engine muse](2026-09-18-muse-engine.md) | Integração do `muse exec` |
| 2026-09-18 | [Engine Google (agy) — fora](2026-09-18-agy-google-cli.md) | Por que ficou de fora; código preservado em [`2026-09-18-agy-engine.patch`](2026-09-18-agy-engine.patch) (`git apply`) |
| 2026-09-14 | [Padrões de erro de cota](2026-09-14-quota-patterns.md) | Fonte dos padrões de `classifyQuotaError`, com origem e confiança por engine |

Os estudos de 2026-09-14 e 2026-09-18 vieram dos loops ralph (a pasta `.ralph/` foi removida em
2026-09-23). PRDs, progresso e logs desses loops ficaram só no histórico do git.

## bench/

Resultado bruto das medições (`npm run bench`) e exportações do resumo de notas (`bridge_stats`).
Formato de cada linha e como reproduzir: [bench/README.md](bench/README.md).
