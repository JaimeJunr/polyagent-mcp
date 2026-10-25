# Reserva por nível do delegate — 2026-10-25

## Resultado

Aplicada por decisão do dono em 2026-10-25: reserva (o "segundo melhor") por nível quando o
titular está ausente ou unhealthy, antes do Cursor opt-in. `delegate` sem `engine` explícita e
cada worker de `fan_out` também fazem um único rerun na reserva quando o titular falha com
`quota_exhausted`, nunca com `rate_limited` ou outro erro. O prompt e as opções são preservados;
engine/model/effort passam aos da reserva. As duas tentativas ficam no log, permitindo ao health
aprender a cota do titular; a reserva registra `matchedRequest:false`.

| Nível | Titular (engine, modelo, effort, AA, $/tarefa) | Reserva aplicada | AA | $/tarefa | Teste ao vivo |
|---|---|---|---|---|---|
| low | codex, gpt-6-luna, max, 38, 0,07 | claude, claude-haiku-5-5, xhigh | 41 | 0,12 | ok (2026-10-25) |
| middle | codex, gpt-6.1-sol, medium, 48, 0,21 | claude, claude-haiku-5-5, max | 43 | 0,21 | ok (2026-10-25) |
| high | claude, claude-opus-5-5, high, 54, 1,82 | codex, gpt-6.1-sol, max | 52 | 0,72 | ok (2026-10-25) |

## Critérios

1. **Outra engine.** Low e middle rodam no codex; uma reserva no codex esgota junto. O high roda no
   claude, idem. A reserva tem de ficar na outra assinatura.
2. **Maior índice AA nessa outra engine, com custo por tarefa próximo ao do titular.** Não mais
   barato a qualquer preço: o objetivo é perder o mínimo de qualidade.
3. **Assinatura antes de pay-per-token.** Opencode/OpenRouter e Muse gastam dinheiro por chamada.
4. **Id e effort confirmados em execução real** pelo caminho do bridge (`delegate` com `engine`,
   `model` e `effort` explícitos, sandbox ligado). O teste foi uma resposta trivial (`ok`); prova que
   o CLI aceita o par modelo/effort, não a qualidade.

## Números (AA Intelligence Index v4.3.2, consultado em 2026-10-25)

Fonte: páginas de modelo e comparação em artificialanalysis.ai, via `web_lookup` em 2026-10-25.
$/tarefa é a estimativa da AA por tarefa do índice; em assinatura é proxy de cota, não fatura.

- Claude Haiku 5.5: medium 34 / $0,05; xhigh 41 / $0,12; max 43 / $0,21.
- Claude Sonnet 5.5: low 36 / $0,35; medium 41 / $0,48; high 47 / $0,88; xhigh 52 / $2,01; max 56 / $5,46.
- Claude Opus 5.5: low 42 / $0,55; high 54 / $1,82; xhigh 56 / $3,46; max 58 / $5,98.
- GPT-6.1 Sol: low 42 / $0,13; medium 48 / $0,21; high 50 / $0,32; xhigh 51 / $0,39; max 52 / $0,72.
- GPT-6 Astra: low 46 / $0,82; high 51 / $1,73; xhigh 52 / $2,31; max 53 / $3,26.
- GPT-6 Luna: max 38; custo por effort não exposto (o estudo de 2026-10-23 usa $0,07).
- Kimi K3.1 Pro: 55 / $2,11 (lançado 2026-10-23).
- Grok 4.5: high 39 / $0,88, marcado como deprecated pela AA; low/medium não encontrados.
- Mercury 2: 11 / $0,04.

## Por que cada reserva

- **low → Haiku 5.5 xhigh.** No claude, é o ponto com nota igual ou acima do Luna max (41 ≥ 38)
  pelo menor custo ($0,12, ~1,7×). Haiku medium (34 / $0,05) é mais barato, mas cai 4 pontos.
- **middle → Haiku 5.5 max.** Mesmo custo do Sol medium ($0,21) e a maior nota do claude nessa faixa
  (43). Sonnet high chega a 47, mas custa ~4× ($0,88). Opus low (42 / $0,55) perde nos dois eixos.
- **high → Sol 6.1 max.** Maior nota fora do claude com id confirmado (52), e mais barato que o
  titular ($0,72 contra $1,82). Astra high (51 / $1,73) e xhigh (52 / $2,31) custam mais pela mesma
  nota ou menor.

## Descartados

- **Kimi K3.1 Pro (55 / $2,11, assinatura).** Nota acima do Opus high, mas o CLI `kimi` não está
  instalado nesta máquina (`delegate` recusou em 2026-10-25), o id do K3.1 Pro no CLI não foi
  confirmado, e a última tentativa real (2026-09-18) bateu no limite mensal. Ver
  `2026-09-18-kimi-engine.md`.
- **Grok 4.5.** Deprecated na AA, sem nota de low/medium, e o bench de 2026-09-23 não mediu nada
  por falta de cota.
- **Opencode/OpenRouter (mercury-2, DeepSeek V4.1 Flash).** Pay-per-token; mercury-2 tem AA 11.
  DeepSeek V4.1 Flash acertou 6/6 no bench de 2026-09-23, mas não tem nota AA levantada.
- **Muse.** Pay-per-token e caminho de provider pago nunca validado.

## Reavaliar

- Quando o `kimi` for instalado e o K3.1 Pro rodar ao vivo: ele vira candidato à reserva do high
  (ou ao próprio high).
- Quando a AA publicar o Grok 4.7 por effort, ou o custo do DeepSeek V4.1 Flash.
- Quando os ratings locais (`rate`) acumularem amostras das reservas: nota baixa derruba a escolha.
- Quando mudar o titular de qualquer nível (`research/2026-10-23-tres-niveis.md`).
