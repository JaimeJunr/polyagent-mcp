# Custo fixo de ter o polyagent instalado (2026-11-20)

## Medido
Servidor real subido por stdio (`npm run doctor` repete a medição), `POLYAGENT_CLAUDE_MD=off`:

| Parte | Caracteres |
|---|---|
| Schemas das 6 tools `alwaysLoad` (delegate 5.446, explore 2.263, fan_out 2.226, run_filtered 1.679, web_lookup 1.334, rate 959) | 13.907 |
| Instruções do servidor | 2.414 |
| Texto do hook no `SessionStart` | 2.979 |
| **Total** | **19.300** |

Schemas das 5 tools deferidas (só nomes até serem chamadas): 6.392 caracteres.

## Estimado
Cerca de 4,8 mil tokens a 4 caracteres por token. É aproximação, não contagem do tokenizer.
Um perfil `minimal` (só delegate, explore, run_filtered) tiraria 4.519 caracteres, uns 1,1 mil tokens:
pouco perto de um contexto de 80–150 mil, e é lido do cache a cada prompt.

## Achado lateral
`package.json` publica só `dist/` (`files`): o hook `hooks/prefer-polyagent.mjs` não vai no pacote npm.
Quem instalar por `npx` não recebe o hook. Relevante para a issue #90.

## Reavaliar
Quando as descrições das tools mudarem, ou quando a medição por perfil existir (issue #98).
