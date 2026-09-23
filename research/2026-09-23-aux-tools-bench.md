# Bench — modelos das tools auxiliares e do fast_delegate (2026-09-23)

Status: **proposta**, aguardando decisão do dono. Nada mudou no código por causa deste estudo.

Pergunta: qual modelo/esforço deve atender `explore`, `read_slice`, `web_lookup`, `run_filtered` e a
cascata do `fast_delegate` (`FAST_CANDIDATES`) depois da troca para GPT-6? Estas tools pedem
**velocidade e acerto em tarefa simples**, não nota alta de inteligência.

## Como foi medido

`bench/aux-bench.mjs` (versão da rodada: gabarito fixo; a versão versionada calcula o gabarito do
repo). Caminho real: `runCursor` de `dist/cli.js`, sandbox bwrap ligado, prompts de
`dist/prompts.js`. 2 repetições, em série. `ms` = wall-clock do processo inteiro.
Dado bruto: [`bench/2026-09-23-aux.jsonl`](bench/2026-09-23-aux.jsonl) (40 linhas).

| Tarefa | Tool | Gabarito |
|---|---|---|
| T1 | `explore` | `resolveFastTier` em `src/cli.ts:1496` |
| T2 | `read_slice` | trecho do `FAST_CANDIDATES` contendo a linha do mercury-2 |
| T3 | `run_filtered` | `npx vitest run test/quota.test.ts` → 32 passed, 0 failed |
| T4 | `web_lookup` (só codex tem web search) | MiMo-V2.6-Pro: `xiaomi/mimo-v2.6-pro`, $0,435 / $0,87 |

## Resultado

| Candidato | Custo | Acertos | Mediana | Pior caso | Por tarefa (s, rodada 1/2) |
|---|---|---:|---:|---:|---|
| `gpt-6-luna` low (codex) | assinatura | 8/8 | 11,8 s | 15,4 s | T1 12/10 · T2 15/13 · T3 10/12 · T4 11/11 |
| `gpt-6-luna` medium (codex) | assinatura | 8/8 | 10,8 s | 13,1 s | T1 12/10 · T2 13/13 · T3 10/9 · T4 11/11 |
| `haiku` low (claude) | assinatura | 6/6 | 10,4 s | 13,7 s | T1 6/9 · T2 14/12 · T3 6/12 |
| `deepseek-v4.1-flash` (opencode) | por token | 6/6 | 11,8 s | **87,9 s** | T1 14/9 · T2 88/52 · T3 8/9 |
| `mercury-2` (opencode) | por token | 5/6 | 14,8 s | **240 s (timeout)** | T1 16/240✗ · T2 28/14 · T3 11/9 |
| `grok-4.5` low | assinatura | — | — | — | sem cota nas 6 rodadas: excluído |

Leituras:

- **Todos acertam** o que terminam. A diferença é **cauda de latência**: os dois pay-per-token via
  OpenRouter tiveram rodadas de 50 s a 240 s na mesma tarefa em que também fizeram ~10 s.
- **Luna medium não é mais lento que low** (mediana 10,8 s contra 11,8 s): quase todo o tempo é
  subida do CLI + loop do agente, não raciocínio. Medium tem nota geral maior (29 contra 21, AA).
- **Haiku** é o mais estável fora do codex (pior caso 13,7 s), mas gasta a assinatura Claude, a
  mesma do orquestrador do host.
- A velocidade de API do leaderboard não prevê isso: mercury-2 tem 705 tok/s na AA e foi o pior
  caso aqui.

## Proposta

| Onde | Hoje | Proposta | Por quê |
|---|---|---|---|
| `explore`/`read_slice`/`web_lookup` | `gpt-6-luna` sem effort (default do CLI = medium) | `gpt-6-luna` com `effort: "medium"` **explícito** | mesmo resultado; fixa o valor em vez de depender do default do CLI |
| `FAST_CANDIDATES` 1º | `gpt-6-luna` low | `gpt-6-luna` medium | mesma velocidade, mais inteligência |
| `FAST_CANDIDATES` 2º | `mercury-2` (por token) | `haiku` low | estável e sem custo por chamada; mercury-2 teve timeout |
| `FAST_CANDIDATES` 3º | `haiku` low | `mercury-2` | continua como saída fora das assinaturas |
| `FAST_CANDIDATES` 4º | `grok-4.5` low | igual | sem dado (sem cota) |

## Limites

- 2 repetições: a cauda de latência apareceu, mas a frequência dela não está medida. Mais rodadas
  (`node bench/aux-bench.mjs 5 mercury-2,deepseek-v4.1-flash,haiku-low`) antes de tirar o mercury-2
  de vez.
- Tarefas pequenas e deste repo. Tarefa grande de `fast_delegate` (editar vários arquivos) não foi
  medida.
- Custo em dinheiro das rodadas pay-per-token não foi registrado por chamada.

## Reavaliar

Quando as notas de uso (`rate`) tiverem volume por engine/modelo, ou quando o Grok voltar a ter
cota (medir o 4º da cascata).
