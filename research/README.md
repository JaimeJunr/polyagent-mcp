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
| 2026-09-23 | [Escada de níveis pela fronteira de Pareto](2026-09-23-tier-pareto.md) | Matriz `TIERS` do `delegate` (Luna max · Sol high · Sol max · Astra max · Opus 5.5 max) |
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
