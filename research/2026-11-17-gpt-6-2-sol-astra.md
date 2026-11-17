# GPT-6.2 Sol e GPT-6.2 Astra (estudo de 2026-11-17)

**Aplicado em 2026-11-17 (dono concordou):** middle = Sol 6.2 medium, high = Astra xhigh (reserva
Claude Opus 5.5 high). Antes disso, os dois ids **rodam no codex-cli 0.169.0 e não no 0.165.0 instalado**
(mesma conta ChatGPT). Este arquivo guarda os números e o teste para a decisão.

## Bloqueio: era a versão do codex, não a conta

Testado em 2026-11-17, codex-cli 0.165.0 (a 0.169.0 existe no npm; não atualizada):

```
codex exec --ignore-user-config --ignore-rules --skip-git-repo-check -m gpt-6.2-sol \
  -c model_reasoning_effort=low --json "reply OK" </dev/null
→ The 'gpt-6.2-sol' model is not supported when using Codex with a ChatGPT account.
```

Mesmo erro para `gpt-6.2-astra`. O `~/.codex/models_cache.json` (atualizado 15:17) só lista
`gpt-6-astra`, `gpt-6-sol`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna`. 
**Confirmado em 2026-11-17 com codex-cli 0.169.0** (instalado só numa pasta temporária, sem tocar
o global): `gpt-6.2-sol` e `gpt-6.2-astra` com effort low responderam "OK". O global segue 0.165.0;
`npm i -g @openai/codex` ainda não foi rodado. Falta confirmar efforts aceitos (medium, max) e o
`models_cache.json` depois da atualização.

## Números (AA = Artificial Analysis, Intelligence Index v5.0.1, INDEPENDENT)

Fonte: páginas dos modelos e leaderboard, lidas em 2026-11-17. A AA publica **custo por tarefa só
no max**; os outros esforços têm só a nota.

| Modelo | low | medium | high | xhigh | max | US$/tarefa (max) |
|---|---:|---:|---:|---:|---:|---:|
| GPT-6.2 Astra | 46 | 57 | 60 | 62 | 62 | 4,00 |
| GPT-6.2 Sol | 41 | 53 | 55 | 56 | 57 | 1,01 |

Contexto na mesma tabela (max): Fable 5.2 65 (US$ 26,54), Opus 5.5 59 (US$ 10,04), GPT-6.1 Terra
51 (US$ 0,96), Haiku 5.5 36 (US$ 0,41), Luna 28 (US$ 0,15). O GPT-6.1 Sol aparece como
`deprecated` na AA (lançado em 2026-09-29), e não está mais na tabela do leaderboard.

Preço de API por milhão de tokens (VENDOR via AA): Astra US$ 8 entrada / 40 saída; Sol US$ 2 / 10.
A coluna "price" da AA (US$ 5,88 Astra, US$ 1,47 Sol) é preço misto por milhão de tokens, **não**
custo por tarefa. Tokens de saída no índice: Astra 65,8 M, Sol 60,9 M.

Não confirmado: o worker de busca citou o anúncio da OpenAI
(`openai.com/index/introducing-gpt-6-2-astra-sol/`) como fonte dos ids e dos preços; a página
bloqueou `curl` (Cloudflare), então só os preços batem com a AA. O índice v5 usa notas diferentes
das antigas do `CLAUDE.md` (Luna 38, Sol 6.1 48, Opus 5.5 54): não comparar entre os dois.

## Busca extra (2026-11-17): custo por esforço dos modelos atuais

As páginas de provedor da AA (`/providers/openai`, `/providers/anthropic`) trazem nota e US$/tarefa
**por esforço** dos modelos antigos. Os 6.2 só têm custo no max (as páginas de cada esforço do 6.2
redirecionam para a do max, com os mesmos US$ 4,00 e US$ 1,01). Terminal-Bench 4.0 (TB4) e
FrontierCode 2.0 (FC2) vêm da mesma fonte (INDEPENDENT).

| Modelo e esforço | Nota AA v5 | US$/tarefa | TB4 | FC2 |
|---|---:|---:|---:|---:|
| Luna max (low atual) | 27,9 | 0,15 | 12,6% | 25,2% |
| GPT-6.1 Sol low | 34,8 | 0,16 | 30,8% | 20,2% |
| **GPT-6.1 Sol medium (middle atual, deprecated)** | 46,3 | 0,36 | 48,0% | 33,4% |
| GPT-6.1 Sol high | 50,3 | 0,59 | 51,5% | 36,7% |
| GPT-6.1 Sol max | 54,6 | 1,27 | 56,1% | 40,6% |
| **Opus 5.5 high (high atual)** | 51,8 | 3,46 | 56,6% | 35,9% |
| Opus 5.5 max | 59,1 | 10,04 | 59,6% | 46,4% |
| GPT-6.2 Sol max | 57 | 1,01 | não achado | não achado |
| GPT-6.2 Astra max | 62 | 4,00 | não achado | não achado |

- **O Opus 5.5 high vale 51,8 no v5, não 54** (o 54 era do índice antigo).
- Astra max (62, US$ 4,00) contra Opus 5.5 high (51,8, US$ 3,46): +10 pontos por +16% de custo, e
  sai da cota Claude do host.
- Sol 6.2 max (57, US$ 1,01) contra Sol 6.1 max (54,6, US$ 1,27): 2,4 pontos a mais por 20% a menos.
- Sol 6.2 medium (53) contra o middle atual (46,3, US$ 0,36): +6,7 pontos; o custo do 6.2 medium
  continua não publicado.
- Alegações da OpenAI (VENDOR, lançamento de 2026-11-17): Astra usa 22% menos tokens de saída que o
  GPT-6 Astra no GDPval v2; a Legora (parceira) mediu 62% menos tokens que o GPT-6.1 Sol nas tarefas
  dela. Sem comparação numérica de tokens por esforço. FrontierCode: Sol fica 0,5 ponto atrás do
  Astra max segundo a OpenAI (valores absolutos não publicados).
- Não achado em lugar nenhum: Terminal-Bench 4.0, SWE-bench, METR, Epoch ou LMArena para os 6.2.

### Custo do Astra high e xhigh, lido no gráfico (ESTIMATIVA, não publicado)

O dono colou o gráfico "Intelligence Index vs. Cost per Task" da AA (2026-11-17). Os pontos
cinzas sem rótulo na linha de Pareto são esforços de outros modelos. A leitura foi calibrada com
pontos de custo conhecido: Sol 6.1 xhigh (52,5; US$ 0,76), Sol 6.1 high (50,3; US$ 0,59), Sol 6.1
medium (46,3; US$ 0,36), Terra high (42,4; US$ 0,26) caem onde o gráfico os mostra. Os dois pontos
entre o Sol 6.2 max e o Astra max têm a nota exata do Astra high (60,09) e do xhigh (61,56):

| Astra | Nota (AA, decimais) | US$/tarefa (leitura do gráfico, ±10%) |
|---|---:|---:|
| high | 60,09 | ~2,1 |
| xhigh | 61,56 | ~2,5 |
| max | 62,14 | 4,00 (publicado) |

Se confirmado, o xhigh dá 99% da nota do max por ~63% do custo. O gráfico mostra só 28 modelos
selecionados: a ausência do Sol 6.2 medium nele **não** prova nada sobre o custo dele.

## O que isso diz para o polyagent

- **Sol 6.2 medium (53)** supera o nosso middle atual (Sol 6.1 medium, já deprecated) e o Terra max
  (51), mas o custo dele por tarefa em medium **não existe publicado**; só o max (US$ 1,01).
- **Astra medium (57) não se justifica:** tem a mesma nota do Sol 6.2 max (57, US$ 1,01) e o token
  do Astra custa 4× (US$ 8/40 contra 2/10). O custo do Astra medium não está publicado; só vence o
  Sol max se gastar menos de ~1/4 dos tokens do Astra max (ele usa 65,8 M tokens no índice contra
  60,9 M do Sol max). Sem esse custo, não há razão para preferi-lo. (A 1ª versão deste estudo
  propunha Astra medium; o dono apontou o erro em 2026-11-17.)
- **Astra max (62, US$ 4,00)** é o único ganho real de nota sobre o Sol max (+5), por ~4× o custo.
  Contra o Opus 5.5 max (59, US$ 10,04) é mais nota por 40% do custo. A nota do Opus 5.5 high no
  v5 não foi achada; o 54 do nível high é do índice antigo.
- Atualizar o codex global é pré-requisito; a troca em `TIERS` depende da decisão do dono.

## Reavaliar

- Depois de atualizar o codex global: conferir efforts no `models_cache.json` e medir custo real
  de cota com `bridge_stats`.
- Quando a AA publicar custo por esforço do Sol/Astra: preencher `src/costs.ts`.
- Decisão de escada (dono): ver proposta na resposta da sessão de 2026-11-17.
