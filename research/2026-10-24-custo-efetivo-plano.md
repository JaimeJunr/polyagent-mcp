# Custo efetivo por plano e modelos chineses no nível low — 2026-10-24

Sem medição própria: só pesquisa. Anota o que se achou depois da decisão dos três níveis
([2026-10-23-tres-niveis.md](2026-10-23-tres-niveis.md)), pra não refazer a busca.

## Resultado

- **Nada mudou nos níveis.** Pelo Artificial Analysis (AA), o Luna max segue o mais barato por
  tarefa e nenhum modelo aberto bate o Sol 6.1 medium em nota pelo mesmo custo. Fora do AA o
  quadro é menos claro (ver abaixo), e não há comparação direta confiável "Luna contra X".
- **O custo que importa pro bridge é cota de plano, não preço de API.** Ninguém publica quanto
  custa 1M de tokens do Luna ou do Sol dentro do plano ChatGPT. O único dado oficial é a razão
  entre modelos na tabela de créditos do Codex.
- **O único plano com tokens publicados é o do GLM (Z.ai).** Ele sai muito mais barato por token
  do que qualquer API.

## Modelos chineses contra a escada (AA, out/2026)

| Modelo | Índice AA | $/tarefa | tok/s |
|---|---:|---:|---:|
| GPT-6 Luna max (low) | 38 | 0,07 | 136,5 |
| GPT-6.1 Sol medium (middle) | 48 | 0,21 | 47,8 |
| DeepSeek V4.1 Flash 1017 max | 45 | 0,26 | 198,4 |
| GLM-5.3 max | 45 | 2,01 | 85,0 |
| Kimi K3.1 Pro | 55 | 2,11 | 80,7 |
| Claude Opus 5.5 high (high) | 54 | 1,82 | — |
| Qwen3.8 Max 0902 | 45 (ou 56) | 5,41 (ou 1,14) | 42,4 |
| MiniMax-M3 | 29 | 0,51 | 84,3 |

Fontes: <https://artificialanalysis.ai/models/open-source>,
<https://artificialanalysis.ai/models/deepseek-v4-1-flash-1017>,
<https://artificialanalysis.ai/models/kimi-k3-1-pro>, <https://artificialanalysis.ai/models/glm-5-3>,
<https://artificialanalysis.ai/models/qwen3-8-max>. O Qwen tem conflito não resolvido: a página
mostra 45 / $5,41, um post do AA no X (<https://x.com/ArtificialAnlys/status/2085270415614828675>)
diz 56 / $1,14 após rodar de novo pela API da Alibaba.

Leitura:

- **low:** trocar o Luna pelo DeepSeek Flash deixaria o low quase tão bom quanto o middle e mais
  caro que ele; aí o Sol medium dominaria os dois níveis.
- **high:** o Kimi K3.1 Pro é o único rival real do Opus 5.5 high (55 contra 54, $2,11 contra
  $1,82), com plano fixo e engine `kimi` já suportada. Tiraria o high da cota Claude do host.
  Não testado no bridge.

## Fora do AA

O AA é bom, mas o $/tarefa depende do effort e da forma como ele roda cada modelo. Outras fontes:

| | Luna | DeepSeek V4.1 Flash | GLM-5.3 Flash |
|---|---|---|---|
| $/1M entrada / saída (OpenRouter) | 0,10 / 0,50 | 0,12 / 0,48 | 0,075 / 0,25 |
| Código | sem SWE-bench nem Terminal-Bench publicado | DeepSWE 74,2 contra 66,6 do Luna | Terminal-Bench 2.1 84,3 (fabricante) |

- Por token, Luna e DeepSeek Flash empatam; o GLM-5.3 Flash custa cerca de metade. O $/tarefa
  maior do DeepSeek no AA vem de gastar mais tokens no effort max.
- O DataLearner põe o DeepSeek Flash à frente do Luna em 12 testes compartilhados.
- Quase tudo vem de agregadores que misturam versões (Luna com gpt-5.6-luna, V4 com V4.1) e se
  contradizem (SWE-bench Verified do DeepSeek V4 Flash: 79,0 num site, 88,8 noutro).
- Nenhuma discussão Luna contra modelo chinês no Reddit ou Hacker News.

Fontes: <https://openrouter.ai/compare/deepseek/deepseek-v4.1-flash/openai/gpt-6-luna>,
<https://openrouter.ai/compare/qwen/qwen3.8-flash/z-ai/glm-5.3-flash>,
<https://www.datalearner.com/en/ai-models/compare/gpt-6-luna/vs/deepseek-v4-1-flash>,
<https://regolo.ai/deepseek-v4-flash-vs-qwen3-8-flash-next-vs-glm-5-3-flash-the-real-leader-in-quality-to-price-in-2026.md>.

## Custo dentro do plano

**Codex (ChatGPT Plus/Pro).** Tabela de créditos por 1M de tokens (entrada / cache / saída),
lida só por trecho de busca porque a página oficial devolveu 403
(<https://help.openai.com/en/articles/20001106-codex-rate-card>,
<https://help.openai.com/en/articles/11481834-chatgpt-rate-card-business-enterprise-edu-credit-based-pricing>):

- Luna: 5 / 0,5 / 30.
- Sol: 100 / 10 / 500 numa fonte, 125 / 12,5 / 750 noutra.
- Logo, no plano o Luna gasta de 20 a 25 vezes menos cota que o Sol.
- Ressalvas: os trechos falam de "GPT-5.6", não de GPT-6; o valor do crédito em dólar não é
  publicado, então não dá $/1M.
- Limites: o Plus voltou a ter janela de 5 h em 2026-08-25; blogs estimam 15 a 150 mensagens do
  Sol por janela (<https://standardcompute.com/codex-usage-limits>). Nada oficial.

**GLM Coding Plan (Z.ai)** — único com tokens oficiais (<https://docs.z.ai/devpack/overview>):

- GLM-5.3, por semana (95% de cache): Lite 48–97M, Pro 290–580M, Max 676–1.352M.
- GLM-5.3-Flash, por semana: Lite 146–292M, Pro 877–1.755M, Max 2.047–4.095M.
- Preço: Lite US$18 confirmado; Pro US$72 ou US$80 (sem confirmação oficial).
- Conta nossa: Pro a US$72 com 290–580M/semana dá cerca de US$0,03–0,06 por 1M; Lite, US$0,04–0,09.

**Outros planos:** Kimi Code (a partir de US$19), MiniMax (US$20/50/120) e Alibaba Coding Plan
Pro (US$50, 6.000 requisições por 5 h) publicam preço e requisições, não tokens. Claude Max não
publica limite; só relatos, como um dia de Claude Code que daria US$220 a preço de API contra
US$200/mês do Max 20x.

## Reavaliar

- **Medir a cota no nosso plano:** rodar as mesmas tarefas no Luna max e no Sol medium, ler o %
  do limite de 5 h e da semana antes e depois, e dividir pelos tokens. Possível sinal: o `codex`
  talvez informe o % usado nos eventos JSON (não conferido).
- **Bench real do low:** Luna max contra DeepSeek V4.1 Flash e GLM-5.3 Flash via `opencode`
  (OpenRouter), medindo acerto, tempo e custo.
- **Bench real do high:** Kimi K3.1 Pro contra Opus 5.5 high pela engine `kimi`.
- Se o Qwen3.8 Max se confirmar em 56 por $1,14, ele vira candidato ao high.
