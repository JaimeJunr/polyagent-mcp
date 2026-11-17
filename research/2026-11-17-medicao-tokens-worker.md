# Medição de tokens do worker e do host (2026-11-17)

Status: **aplicado.** `src/cli.ts` (parsers), `src/usage.ts` (log e tabela), `src/index.ts`
(`format()`, `fan_out`, `bridge_stats`) e `bench/host-cost*.mjs`.

Pergunta do dono: "está economizando?" precisa ser respondida com dado do próprio sistema, sem olhar
a tela de uso da assinatura. Antes, o log guardava só `outChars`, engine, latência e outcome; o
consumo do worker nunca foi medido ([estudo de leitura](2026-11-16-ferramentas-de-leitura.md)).

## O que passou a ser medido

Cada chamada de worker grava, no JSONL de `POLYAGENT_LOG`, o campo `workerUsage`:
`{ inputTokens, cachedInputTokens, outputTokens, reasoningTokens?, costUsd }`. Regras:

- `inputTokens` **inclui** o cacheado; `cachedInputTokens` é o subconjunto. Claude soma
  `input + cache_creation + cache_read`; Codex já reporta `input_tokens` com o cache dentro.
- `null` = o CLI não informou aquele campo. Nunca zero inventado. Sem nenhum dado, o campo some.
- Não grava prompt nem resultado, só contadores.

| Engine | Fonte | Status |
|---|---|---|
| codex | evento JSONL `turn.completed.usage` (`input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`), somado entre turnos | **confirmado ao vivo** em 2026-11-17 (ver "Chamada real") |
| claude | `usage` + `total_cost_usd` do JSON de `claude -p` (mesma forma que `bench/quota-eval-core.mjs` já lê) | **não confirmado ao vivo** nesta rodada; só fixture |
| opencode | `step_finish.part.tokens` (`input`, `output`, `reasoning`, `cache.read/write`) e `part.cost`, somados por step | `input`/`output`/`cost` presentes no fixture real de `test/cli.test.ts`; `cache`/`reasoning` são hipótese |
| grok | `usage` camelCase ou snake_case se vier no objeto único | **hipótese**: sem cota no host, nunca observado |
| kimi, muse | nada | **não medido**: formato de uso não confirmado, fica `undefined` |
| cursor | mesma rota do grok (`parseCliJson`) | **não confirmado** (engine fora de uso) |

`bridge_stats` ganhou a tabela **Worker tokens**, agrupada por `tool|engine|nível`, com
`measured/calls` (quantas chamadas do grupo tinham dado), input, cached, output e custo reportado.
Logs antigos sem o campo continuam válidos: entram só em `calls`, e a tabela some se nada foi medido.

## Host: como fechar a conta

O host (Claude Code) já grava tudo em `~/.claude/projects/<dir>/<sessão>.jsonl`: cada resposta traz
`message.id` e `usage` (várias linhas por `id`, em streaming, então se deduplica por `id`, como em
`bench/quota-eval-core.mjs`). Sem `ccusage` instalado, o script próprio faz o mesmo:

```bash
node bench/host-cost.mjs <sessão-sozinho.jsonl> <sessão-com-worker.jsonl> --log "$POLYAGENT_LOG"
```

- Com um transcript, devolve host (tokens por categoria + unidades de proxy) e os workers do log que
  caem na janela da sessão (primeiro a último timestamp).
- Com dois, devolve também `hostChangePct` (host com worker contra host sozinho) e os tokens dos workers.
- **Unidades de proxy** = input×1 + cache read×0,1 + cache write×1,25 + output×5. É a razão de
  preços de entrada da API, não fatura; serve para comparar sessões entre si.

Limite: a janela é por tempo. Se duas sessões do host rodam ao mesmo tempo, as chamadas de worker de
uma entram na janela da outra. Para comparação limpa use o método pareado de `bench/quota-eval.mjs`
(sessão isolada por trial) e leia os workers do log.

## O que continua não medido

1. **Cota real da assinatura.** Tokens e custo reportado pelo CLI são o consumo declarado, não o
   saldo do plano. A conversão tokens → % da cota não é pública e não foi medida.
2. **Custo em dólar do Codex.** O `turn.completed` não traz preço; `costUsd` fica `null`. Só o
   Claude (`total_cost_usd`) e o opencode informam custo.
3. **Mesma tarefa sem worker.** O log mostra o que o worker gastou, não o que o host teria gastado
   fazendo sozinho. Essa metade continua exigindo o par controlado (`bench/quota-eval.mjs`).
4. **kimi/muse/grok/opencode** ao vivo: parsers sem confirmação, ver tabela.
5. **Retry de ambiente do codex.** A tentativa que falha antes do fallback não tem tokens; só a
   engine que respondeu é medida.
6. **Verify (Jev)** e outras chamadas de `decide` não passam por worker; não entram na tabela.

## Como ler

- `measured/calls` abaixo de 1 num grupo: parte das chamadas não trouxe dado; os totais subestimam.
- Compare **cached/input**: perto de 1 significa que o worker relê o mesmo contexto (barato); o
  `output` é o que mais pesa em custo.
- "Está economizando?" = (host + worker com delegação) contra (host sozinho) na mesma tarefa:
  `compareHosts` entrega a primeira parte; os tokens do worker aparecem separados porque a
  assinatura (Codex vs Claude) é outra. Somar as duas em uma única conta exigiria a conversão
  do item 1.

## Chamada real

`explore` pelo `dist/index.js` com `POLYAGENT_LOG` temporário (codex, gpt-6-luna medium, 9 s):

```json
{"tool":"explore","engine":"codex","outChars":150,"workerUsage":{"inputTokens":49559,"cachedInputTokens":35840,"outputTokens":70,"costUsd":null,"reasoningTokens":0}}
```

Uma pergunta de uma linha custou ~49,6 mil tokens de entrada (72% cacheados) para 70 de saída, e
`bridge_stats` mostrou a linha `explore|codex|- | 1/1`. É um único ponto, não uma média.

## Reavaliar

- Quando houver ≥ 30 chamadas medidas por engine, calcular tokens médios por tool e por nível, e
  cruzar com `rate` (nota) para ver custo por resultado aceito.
- Se Kimi/Muse/OpenCode/Grok virarem rota ativa, capturar uma saída real e confirmar o parser.
