# Custo por tarefa na assinatura: Sol 6.1 contra Opus 5.5 (2026-10-29)

Sem medição nossa. Guarda um gráfico da Artificial Analysis (AA) que muda a leitura dos custos
deste projeto: o polyagent roda `codex` e `claude` **por assinatura**, não por API, e a escada de
níveis ($0,07 → $0,21 → $1,82) usa preço de API como proxy de cota.

Fonte: post de Adam Holter (@AdamHoltererer) no X, 29/10/2026, com gráfico da AA
([imagem](2026-10-29-custo-assinatura-sol-opus.png)). Base declarada no gráfico: preço das
assinaturas pela Priors (Real API Pricing, alta confiança) × custo por tarefa do AA Intelligence
Index v5 em esforço high. Resets de cota não contados.

## Números

| Plano ($20/mês) | Centavos de assinatura por US$1 de API | Custo API por tarefa (high) | Centavos de assinatura por tarefa |
|---|---:|---:|---:|
| Claude Pro → Opus 5.5 | 1,6¢ | $3,47 | 5,4¢ |
| ChatGPT Plus → GPT-6.1 Sol | 11,7¢ | $0,59 | 6,9¢ |

- Por dólar de API, Sol sai **7,5×** mais caro que Opus na assinatura (o plano Claude rende ~62×
  o valor em API; o ChatGPT, ~8,5×).
- Por tarefa, a diferença cai para **1,3×**, ainda a favor do Opus: Sol gasta metade do preço por
  token, mas Opus usa menos tokens (23k contra 60k de saída por tarefa).
- Conclusão do autor: equivalência de API da assinatura sozinha não basta; é preciso pesar a
  eficiência de tokens por tarefa.

## O que isso diz para o polyagent

- A premissa "high (Opus) é ~8,7× mais caro que middle (Sol)" vem de preço de API. Medido em
  fração de assinatura de $20, uma tarefa de Opus high custa **menos** que uma de Sol high.
- Ressalvas antes de mexer em `TIERS`:
  - O middle é Sol 6.1 **medium**, não high; a comparação do gráfico é high contra high.
  - O $3,47 do Opus 5.5 high (índice v5) não bate com o $1,82 usado em
    [três níveis](2026-10-23-tres-niveis.md); versão do índice diferente, conferir.
  - O gráfico é do plano de $20; não confere o plano real do dono (Pro/Max, Plus/Pro), que muda a
    taxa de centavos por dólar.
  - Opus divide a cota com o host Claude Code; cota esgotada no high derruba o orquestrador junto.
    Barato por tarefa não remove esse acoplamento.
- Nenhuma decisão aplicada.

## Recálculo com os planos do dono (2026-10-30)

Planos lidos das credenciais locais em 2026-10-30: Claude **Team** com `rateLimitTier`
`default_claude_max_5x`; Codex com `chatgpt_plan_type` **plus**.

> Revisado em 2026-11-03 com a base pública da Priors (ver "Todos os planos" abaixo): a primeira
> versão supunha Team Premium ≥ $6.250 e Luna com a mesma taxa do Sol ($171); a Priors dá
> $5.280 para o Team Premium e ~$91 para o Luna no Plus.

Cota mensal em dólares de API, da tabela "Todos os planos":

- ChatGPT Plus: **$171** de API por mês no Sol 6.1, **~$91** no Luna.
- Claude Team Premium: **$5.280** no Opus 5.5 (confiança baixa na Priors). A cota Claude é ~31×
  a do Plus no Sol.

Custo por tarefa: `src/costs.ts` (mesma base AA da escada). A diferença para o gráfico (Opus high
$3,47 e Sol high $0,59 contra $1,82 e $0,32 aqui) é ~1,9× nos dois, coerente com tarefas mais caras
no índice v5; razões entre modelos não mudam.

| Papel | Modelo | Pool | $ API/tarefa | % da cota mensal | Tarefas/mês | Relativo ao low |
|---|---|---|---:|---:|---:|---:|
| low | Luna max | Plus | 0,07 | 0,077% | ~1.300 | 1× |
| middle | Sol 6.1 medium | Plus | 0,21 | 0,12% | ~810 | 1,6× |
| **high** | **Opus 5.5 high** | Claude | 1,82 | **0,034%** | **~2.900** | **0,45×** |
| reserva low | Haiku 5.5 xhigh | Claude | 0,12 | 0,002% | ~44.000 | 0,03× |
| reserva middle | Haiku 5.5 max | Claude | 0,21 | 0,004% | ~25.000 | 0,05× |
| reserva high | Sol 6.1 max | Plus | 0,72 | 0,42% | ~240 | 5,5× |

Leitura:

- Na assinatura do dono a escada vira **1× → 1,6× → 0,45×**: o high é o titular mais barato em
  cota, e o middle é o mais caro. A escada de API (1× → 3× → 26×) não descreve o nosso custo.
- O pool escasso é o **Plus** (low, middle e reserva do high). Escalar do middle para o high
  economiza cota escassa; a reserva do high (Sol max) é a opção mais cara da tabela.
- As reservas Haiku custam quase nada em cota Claude.

Ressalvas do recálculo:

- A cota Claude é **compartilhada com o host** Claude Code, que roda Opus na sessão principal;
  quanto sobra dela não foi medido. Esse é o limite real do high, não o custo por tarefa.
- Janelas de 5 h e semanais não entram; "% da cota mensal" é proxy grosso.
- O Team Premium tem confiança baixa na Priors e só linha de Opus; para o Haiku usei a mesma taxa.

## Todos os planos (2026-11-03)

Fonte: [Priors — Real API Pricing](https://github.com/Fei2411/real-api-pricing/blob/main/charts/en/overview/real-price-overview-table.txt),
lida em 2026-11-03. Ela dá, por plano e modelo, tokens por mês e US$/MTok efetivo; dividido pelo
US$/MTok da API do mesmo modelo, vira **centavos de assinatura por US$1 de API**. Claude Max usa
as cotas permanentes a partir de 2026-09-14, sem bônus.

Como as linhas do Codex foram derivadas (a Priors não tem preço de API do GPT-6/6.1):

- Sol 6.1 no Plus: 11,7¢ (gráfico da AA, que usa a Priors).
- Luna 6 no Plus: 9,2 B tokens/mês contra 0,87 B do Sol 6.1, com preço de API 20× menor
  ($0,10/$0,50 contra $2/$10, supondo o mesmo mix) → **22,1¢**. O Luna rende ~1,9× menos cota por
  dólar de API que o Sol; o par GPT-5.6 (9,3¢ contra 5,5¢) mostra o mesmo sentido.
- Pro 5x e Pro 20x: razão Pro/Plus das linhas GPT-5.6 da Priors (5x: mesmo ¢ do Plus; 20x: 0,48×
  no Sol e 0,50× no Luna).
- `*` = sem linha na Priors; Team Standard (1,25× Pro por $25) e Business Standard (limites do
  Plus por $25) inferidos dos textos de [Claude Team](https://support.claude.com/en/articles/9266767-what-is-the-team-plan)
  e [ChatGPT Business](https://help.openai.com/en/articles/12003714-chatgpt-business-models-and-limits).
  Sem dado: ChatGPT Go, Business Premium, Pro 500, Enterprise (Claude e ChatGPT; no Claude
  Enterprise o uso é cobrado a preço de API).

Tarefas por mês = cota em dólares de API ÷ custo AA por tarefa de `src/costs.ts`.

**Claude Code**

| Plano | $/mês | ¢ por US$1 (Opus / Haiku) | Cota em API (Opus) | Opus 5.5 high | Haiku 5.5 xhigh | Haiku 5.5 max |
|---|---:|---:|---:|---:|---:|---:|
| Pro | 20 | 1,56 / 1,59 | $1.279 | ~700 | ~10.500 | ~6.000 |
| Team Standard* | 25 | 1,56 / 1,59 | ~$1.600 | ~880 | ~13.100 | ~7.500 |
| Max 5x | 100 | 1,30 / 1,31 | $7.688 | ~4.200 | ~64.000 | ~36.500 |
| Team Premium (dono) | 125 | 2,37 / — | $5.280 | ~2.900 | ~44.000 | ~25.100 |
| Max 20x | 200 | 1,51 / 1,49 | $13.218 | ~7.300 | ~112.000 | ~64.000 |

**Codex**

| Plano | $/mês | ¢ por US$1 (Sol 6.1 / Luna) | Cota em API (Sol / Luna) | Luna max | Sol 6.1 medium | Sol 6.1 max |
|---|---:|---:|---:|---:|---:|---:|
| Plus (dono) | 20 | 11,7 / 22,1 | $171 / $91 | ~1.300 | ~810 | ~240 |
| Business Standard* | 25 | 14,6 / 27,6 | $171 / $91 | ~1.300 | ~810 | ~240 |
| Pro 5x | 100 | 11,7 / 22,1 | $855 / $453 | ~6.500 | ~4.100 | ~1.200 |
| Pro 20x | 200 | 5,6 / 11,1 | $3.581 / $1.805 | ~25.800 | ~17.000 | ~5.000 |

Leitura:

- Em centavos de assinatura por tarefa (custo AA × ¢ por US$1), os titulares ficam próximos:
  Luna max 1,5¢ (Plus/Pro 5x) ou 0,8¢ (Pro 20x); Sol 6.1 medium 2,5¢ ou 1,2¢; Opus 5.5 high
  2,4¢ (Max 5x) a 4,3¢ (Team Premium); Haiku 5.5 xhigh 0,2–0,3¢. Por dólar pago, o high não é
  mais barato que o middle; o que o barateia no caso do dono é o pool Claude ser ~31× maior,
  não o preço por tarefa.
- O Max 5x ($100) dá ~46% mais cota que o Team Premium ($125); o Team Premium é o plano Claude
  menos eficiente por dólar na Priors.
- No Codex, o Pro 5x não melhora a taxa (é 5× o Plus por 5× o preço); só o Pro 20x dobra a
  eficiência.
- Ressalva geral: janelas de 5 h e semanais, confiança "low" em todas as linhas do Max e do Team
  Premium, e o mix de tokens das tarefas AA pode diferir do mix que a Priors supõe.

## Reavaliar

- Medir quanto da cota Claude o host consome por semana; se sobrar folga, considerar o high como
  escalada padrão no lugar do middle e tirar o rótulo "caro" das descrições das tools e do bloco
  do `CLAUDE.md`.
- Ver se `src/costs.ts` / a coluna `est $/task (AA)` deveriam ganhar o proxy de fração de cota
  por pool, em vez de dólar de API.
- Refazer se algum plano mudar (Plus → Pro, Team → outro assento).
