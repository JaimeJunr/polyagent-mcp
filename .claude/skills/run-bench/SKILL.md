---
name: run-bench
description: Use when deciding or re-checking which model/effort should back explore, read_slice, web_lookup, run_filtered, fast_delegate or the FAST_CANDIDATES order in polyagent-mcp, when comparing speed or accuracy of engines/models on real bridge calls, or when the user asks to measure, benchmark or "testar de verdade" a model before adopting it.
---

# run-bench — medir no caminho real antes de decidir

Leaderboard mede a API; o chamador do polyagent espera o **CLI inteiro** (subida + loop do agente +
modelo). Em 2026-09-23 `codex exec` levou 24 s para responder "OK" — a latência de API do mesmo
modelo é ~6 s. Por isso decisão de tool auxiliar sai de medição própria.

## Rodar

```bash
npm run bench                      # 2 repetições, todos os candidatos
node bench/aux-bench.mjs 1 luna-low,haiku-low   # recorte: reps + ids de candidato
```

Candidatos, tarefas e gabarito: `bench/aux-bench.mjs`. Formato da saída:
`research/bench/README.md`. Rode em background (dezenas de chamadas em série; minutos).

## Enquanto roda

- **Não edite `src/` nem `test/`**: o gabarito foi tirado do repo no início. Trabalhe em docs/skills
  ou espere.
- Cota esgotada aparece como `err: "... quota exhausted"` — descarte a engine da comparação, não
  conte como erro do modelo. Grok estava sem cota em 2026-09-23.
- opencode/OpenRouter cobra por chamada e tem cauda longa de latência: mercury-2 variou de ~15 s a
  >160 s na mesma tarefa. Reporte mediana **e** pior caso, não só média.

## Concluir

1. Resuma por tarefa × candidato: acertos/rodadas, mediana e máximo de `ms`, custo (assinatura vs
   pay-per-token).
2. Cruze com as notas de uso (`bridge_stats`), quando houver volume.
3. Estudo em `research/AAAA-MM-DD-<assunto>.md` + linha em `research/README.md`.
4. Mudança de default: skill `model-refresh` (passo 3) e `ship`.
