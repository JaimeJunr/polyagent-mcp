---
name: model-refresh
description: Use when a new model is released or announced (GPT/Luna/Sol/Astra, Claude Opus/Fable/Haiku, Grok, OpenRouter models), when the user asks to update the model roster, tiers, levels, FAST_CANDIDATES, EXPLORE_MODEL or IMAGE_MODEL of polyagent-mcp, or brings a benchmark/leaderboard/Pareto-frontier comparison asking which model should sit at which level.
---

# model-refresh — trocar modelos do polyagent sem quebrar nada

Onde os modelos moram (todos em `src/cli.ts`): `TIERS` (níveis do `delegate`), `FAST_CANDIDATES`
(cascata do `fast_delegate` e do `run_filtered`), `EXPLORE_MODEL_FALLBACK` (explore/read_slice/
web_lookup/árbitro do fan_out), `IMAGE_MODEL`. O resto (descrições em `src/index.ts`,
`hooks/prefer-polyagent.mjs`, `README.md`, `CLAUDE.md`) só **descreve** esses valores.

## 1. Confirmar o id em execução real — antes de escrever qualquer linha

Id de anúncio/leaderboard não é id de CLI. Verifique cada um:

- **codex:** `~/.codex/models_cache.json` lista slug + efforts aceitos + effort default. Depois rode
  `codex exec --ignore-user-config --ignore-rules --skip-git-repo-check -m <id> -c model_reasoning_effort=low --json "reply OK" </dev/null`.
- **claude:** `claude -p --model <id> --output-format json --strict-mcp-config --setting-sources project "reply OK" </dev/null`
  e leia `modelUsage` — é ele que diz qual modelo respondeu.
- **Alias engana.** Em 2026-09-23 `--model opus` respondia com `claude-opus-5`, não o 5.5 recém-lançado.
  Use o id completo na matriz.
- Grava no comentário da matriz: quais ids foram confirmados e em que data.

## 2. Decidir o lugar de cada modelo

Critérios e o estudo de referência: `research/2026-09-23-tier-pareto.md`. O que já deu errado:

| Armadilha | Correção |
|---|---|
| Julgar pela nota **geral** | O polyagent é frota de código: quando geral e Coding Agent Index discordam, vale código. (Quase tirou o Astra, topo em código, por estar dominado na geral.) |
| Aceitar recomendação de pesquisa web como veio | Confira a data: uma pesquisa "atualizada ontem" não tinha os lançamentos da véspera. Confira os números na fonte com `web_lookup`. |
| Pôr modelo pay-per-token (OpenRouter) num nível | Os níveis são assinatura (custo = cota). Pesquisa de "custo por token" não enxerga isso: DeepSeek/MiMo "mais baratos" cobram dinheiro por chamada, e o Luna sai de graça. Pay-per-token entra só por decisão explícita do dono. |
| Degrau grande demais | Cada nível ~3× o custo do anterior; o nível 2 tem que valer como degrau barato. |
| Ignorar concentração de cota | Conte quantos níveis ficam numa assinatura só: cota estourada derruba todos juntos. Declare no comentário. |
| Mexer no Cursor | Legado sem assinatura: não atualize `cursorModel` nem verifique ids dele. |

Decisão de lugar é do dono: apresente a escada proposta (nota, custo/tarefa, salto) com no máximo
2 opções e a recomendada.

## 3. Aplicar (TDD)

1. Atualize primeiro os testes que fixam valores (`test/cli.test.ts`, `test/aux-engine.test.ts`,
   `test/hook.test.ts`, `test/quota.test.ts`, `test/health-latency-tdr.test.ts`) e veja falhar.
2. Mude `src/cli.ts`, depois as descrições (`src/index.ts`, hook, `README.md`, `CLAUDE.md`).
3. `AGENTS.md` (no `.gitignore`) é **gerado** do `CLAUDE.md` para o codex — regenere com a skill
   `ivt-core:claude-codex-sync` em vez de editar à mão; ele já ficou para trás antes.
4. Testes que fixam **regra** (não valor) podem ter virado falsos: "modelo distinto por nível",
   sugestão de `level` no erro de cota, engine do nível no teste de health. Ajuste a regra, com
   comentário do porquê, em vez de forçar o valor antigo.
5. Varredura final: `grep -rnE "<id-antigo>|<Nome Antigo>" src hooks test *.md` — sobra só Cursor ou
   nota datada.

## 4. Registrar

Novo estudo em `research/AAAA-MM-DD-<assunto>.md` + linha em `research/README.md`. O comentário da
matriz aponta para o estudo. Entrega: skill `ship`.
