# Calibração do proxy de custo contra a cota real da assinatura

Data: 2026-11-21. Issue [#108](https://github.com/JaimeJunr/polyagent-mcp/issues/108), partes 2 e 3.

Pergunta: quanto da cota real (Claude Max: janela de 5 h e semanal; Codex prolite: janela semanal) cada unidade do
proxy usado nos estudos de custo consome? Sem essa conversão, "−31% de custo do host" não diz quanto de cota sobra.

## Protocolo (escrito antes de rodar)

### Fontes de leitura da cota

- **Claude.** O `claude -p --output-format stream-json` emite `rate_limit_event` com
  `rate_limit_info.unifiedWindows.five_hour.utilization` e `seven_day.utilization` (fração com duas casas, ou seja,
  % inteiro) e o `resetsAt` de cada janela. Achado nesta sessão nos trials antigos da note2; isso troca a leitura manual
  pelo `get_usage` da sessão desktop por uma leitura automática por trial. O `get_usage` desta sessão continua como
  leitura de controle antes e depois de cada bloco.
- **Codex.** Todo evento `token_count` do rollout (`~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl`) traz
  `rate_limits.primary.used_percent` (inteiro, janela 10080 min, `resets_at`) e `last_token_usage`. O
  `session_meta` traz `creator_account_id`, que separa contas.

### Uso (o lado x da regressão)

- **Claude:** todos os transcripts `~/.claude/projects/**/*.jsonl` deste PC, da note2 e da note3, mensagens do
  assistente deduplicadas por `message.id`, com timestamp, modelo e os quatro campos de token. Proxy = equivalente
  de API em US$ pelo preço de lista. Os preços do Sonnet 5.5 foram ajustados nos 140 resultados do bench
  (`modelUsage.costUSD`, resíduo máximo 3e-16): US$ 2 entrada, 10 saída, 0,1 leitura de cache, 4 escrita de cache
  de 1 h, por milhão. Outros modelos entram como coeficiente próprio na regressão, sem supor preço.
- **Codex:** soma de `last_token_usage` de todos os rollouts da mesma conta (dedup por arquivo e `ordinal`),
  separada por modelo e por tipo (entrada sem cache, entrada em cache, saída).

### Modelo

Dentro de uma mesma janela (mesmo `resetsAt`), a cota é acumulada: `util(t) = a + k · U(t)`, onde `U(t)` é o uso
acumulado até a leitura `t`. Ajuste por mínimos quadrados por janela; `k` é a conversão (%/US$ no Claude, %/milhão de
tokens no Codex). Erro: erro-padrão do coeficiente mais a quantização de ±0,5 ponto da leitura inteira, e a dispersão
de `k` entre janelas independentes. Só entra janela com pelo menos 5 pontos de variação de `util`.

### Fase A — retrospectiva (custo zero)

Reaproveita o que já está gravado: as leituras dos trials do bench de 2026-11-15 e 2026-11-16 na note2 e todos os
rollouts do Codex das três máquinas.

### Fase B — blocos ao vivo (gasta cota, só com ok do Jaime)

- Blocos de trials `claude -p` idênticos (braço `lean` do `bench/quota-eval.mjs`), um bloco com host Sonnet 5.5 e um
  com host Opus 5.5, cada um grande o bastante para mover a janela de 5 h em pelo menos 5 pontos.
- Leitura `get_usage` antes e depois de cada bloco; `rate_limit_event` em cada trial.
- O braço `coarse` com worker Codex dá o lado Codex na mesma rodada.

### Contaminação

- Uso de outras sessões locais (este PC, note2, note3) **não** é contaminação: entra em `U(t)` pelos transcripts.
- Contaminação é o que não aparece nos transcripts locais: claude.ai web e celular, sessões na nuvem, outras
  máquinas (o box), Codex na nuvem ou na IDE de outra máquina. Sinal: salto de `util` sem uso local correspondente.
  Ela só pode inflar `k`. Mitigação: rodar a fase B sem outra sessão ativa (conferido com `list_sessions`) e
  descartar a janela com salto inexplicado de 3 pontos ou mais.
- Esta própria sessão (Opus, interativa) consome cota e entra em `U(t)` pelo seu transcript.

### Critério de parada

- Para antes de passar de 85% na janela de 5 h ou do teto semanal aprovado.
- Para no primeiro erro de infraestrutura (MCP sem conectar, cota, timeout) e investiga.
- Para quando `k` tiver erro relativo abaixo de 10% em duas janelas independentes, ou quando o orçamento aprovado
  acabar; nesse caso documenta o erro obtido.

### Emenda antes da fase B (2026-11-21, 03:40, antes de gastar cota)

Dois fatos achados na fase A mudam o desenho:

- **São duas contas.** O `claude -p` deste PC e da note2 usa a conta Team (`rateLimitTier: default_claude_max_5x`
  no `.credentials.json`); o app desktop usa outra conta, plano Max. No mesmo minuto (03:31), a sonda `claude -p`
  leu 12% na janela de 5 h e 12% na semanal, e o `get_usage` do app leu 64% e 39%. Os transcripts separam as duas
  pelo campo `entrypoint` (`claude-desktop` contra `sdk-cli`/`cli`). O bench (e o experimento da issue #110) gasta a
  conta Team; o uso do dia a dia com host Opus gasta a conta do app. A conversão é medida para cada conta.
- **A leitura do bench é automática:** cada trial traz um `rate_limit_event`, então a fase B não depende do
  `get_usage`, que fica como controle da conta do app.

Desenho da fase B, conta Team, numa única janela de 5 h:

| Bloco | Trial | Modelo | Para quando |
|---|---|---|---|
| S-med | `MEDIUM_TASK` braço `lean` (mistura igual à do bench) | Sonnet 5.5 medium | +8 pontos na janela de 5 h |
| S-out | texto longo sem ferramentas (quase só saída) | Sonnet 5.5 medium | +8 pontos |
| O-med | `MEDIUM_TASK` braço `lean` | Opus 5.5 medium | +8 pontos |

S-med contra S-out testa se a cota pesa os tipos de token como o preço; S-med contra O-med testa o peso do modelo.
Runner: `bench/quota-calibration-run.mjs`, 4 trials em paralelo, teto de 85% na janela de 5 h. O gasto fica limitado
em pontos pelo próprio critério de parada, não em dólar. Sem worker Codex: o lado Codex sai da fase A.
A conta do app é calibrada passivamente: leituras do `get_usage` desta sessão contra os transcripts `claude-desktop`.

## Resultado

**A conversão saiu, com erro de 1% a 2%, nas duas pontas que importam: Codex (cota semanal) e Claude conta Team
(janela de 5 h).** A cota do Claude não pesa os tipos de token como o preço de lista: a saída pesa cerca de 1,8 vez
mais por dólar do que o cache, e o Opus pesa menos por dólar do que o Sonnet. A conta Max do app só tem estimativa
passiva, sem erro confiável.

### Codex (fase A, sem gasto)

| | Valor |
|---|---|
| Conversão | **5,46 M tokens-equivalentes por 1% da cota semanal** (prolite) |
| Unidade | `sem cache + 0,1 × entrada em cache + 8 × saída`, soma de `last_token_usage` |
| Erro-padrão | 1,5% (resíduo 0,18 ponto) |
| Dados | 12 leituras novas de `used_percent` entre 2026-11-17 e 2026-11-21, uma conta (`creator_account_id`), Sol, Luna e Astra somados |

- Os pesos 0,1 e 8 não são identificáveis: a mistura de tipos de token ficou estável no período. Outros pesos
  ajustam quase igual (0,1/4 → 4,74 M; 0,25/8 → 9,66 M; 0,1/0 → 4,01 M), então a conversão vale para a mistura do
  uso atual do worker. Peso 0 para o cache piora o resíduo (0,33), então o cache conta.
- Sol contra Luna separados: 0,178 e 0,211 %/M, erro-padrão 0,02 e 0,11. Inconclusivo.
- Antes de 2026-11-17 a cota subiu sem uso local (5 → 8 e 9 → 13 pontos): Codex usado fora destas máquinas.
  Essas janelas ficaram fora.
- Escala: uma chamada típica de worker (cerca de 27 mil tokens-equivalentes) gasta uns 0,005% da cota semanal.
  Por isso não houve bloco Codex ao vivo.

### Claude, conta Team (fase B, ao vivo)

Os três blocos rodaram em 2026-11-21, entre 14:11 e 14:58 UTC, todos na mesma janela de 5 h (`resetsAt`
1795288200). Foram 431 trials, sem nenhuma falha, US$ 44,10 de proxy e 0 → 25 pontos.

| Bloco | Trials | Proxy (US$) | Janela de 5 h | %/US$ | Erro-padrão | US$ por ponto |
|---|---|---|---|---|---|---|
| S-med (Sonnet, tarefa média) | 186 | 13,13 | 0 → 8 | 0,574 | 0,0055 (1,0%) | 1,74 |
| S-out (Sonnet, saída longa) | 120 | 11,63 | 8 → 16 | 0,761 | 0,0079 (1,0%) | 1,31 |
| O-med (Opus, tarefa média) | 125 | 19,34 | 17 → 25 | 0,411 | 0,0043 (1,0%) | 2,43 |

O resíduo foi de 0,29 a 0,30 ponto em todos os blocos, o desvio esperado só pelo arredondamento da leitura para %
inteiro (0,29). Não apareceu salto sem uso local, e o intercepto de cada bloco bate com o fim do anterior, então não
há contaminação detectável. O proxy de cada trial é o `total_cost_usd` do próprio CLI (preço de lista).

Regressão conjunta, com 495 leituras e resíduo de 0,297:

| Coluna (US$ a preço de lista) | %/US$ na janela de 5 h | Erro-padrão |
|---|---|---|
| Sonnet 5.5, saída | **0,827** | 0,0065 |
| Sonnet 5.5, cache e entrada (leitura, escrita, entrada sem cache) | **0,458** | 0,0089 |
| Opus 5.5, mistura da tarefa média | **0,415** | 0,0035 |

- **Saída contra cache:** por dólar, a saída gasta 1,80 vez o que o cache gasta. Um corte de proxy que vem de
  leitura de cache economiza menos cota do que o proxy diz; um corte de saída economiza mais.
- **Opus contra Sonnet:** o preço do Opus 5.5 é 2 vezes o do Sonnet em todos os tipos (ajuste nos 125 trials:
  US$ 4 entrada, 20 saída, 0,2 leitura de cache, 8 escrita de cache de 1 h, por milhão; resíduo 3e-15). Na mesma
  tarefa, porém, o Opus gasta só 1,43 vez a cota do Sonnet por token (0,411 × 2 / 0,574).
- **Leitura contra escrita de cache:** não separa. Com as duas em colunas próprias, o erro-padrão passa de 0,24
  %/US$ (o coeficiente da leitura sai negativo). Os blocos não variaram o bastante essa proporção.
- **Semanal:** subiu de 12 para 16 pontos nos mesmos US$ 44,10, ou seja, cerca de 0,09%/US$. O arredondamento de
  ±0,5 ponto em cada ponta dá um erro de cerca de ±18%. A janela de 5 h anda umas 6 vezes mais rápido que a semanal
  (25 contra 4 pontos).
- A estimativa da fase A para esta conta (cerca de 1,25%/US$, a única janela antiga limpa) era 2,2 vezes a medida.
  Fica descartada: era um limite superior inflado por uso de fora, como o protocolo previa.

### Claude, conta Max do app (passiva)

A janela de 5 h da conta do app abriu às 14:10 UTC. A leitura do `get_usage` deu 2% às 14:11 e 16% às 14:58, com 42
e 44% na semanal. No mesmo intervalo, os transcripts locais das sessões do app somam US$ 23,7 de proxy, a maior
parte depois de 14:11. Desse total, US$ 13,7 são de Opus (esta sessão e duas outras) e US$ 10,0 de Sonnet. Também
houve 9 mensagens de Haiku, sem preço conhecido e fora da conta.

- O resultado é cerca de **0,67%/US$**: subiu 14 pontos para cerca de US$ 20,8 depois da primeira leitura. Os pesos
  da conta Team aplicados à mesma mistura preveem cerca de 10,3 pontos. Então a conta do app gasta cerca de 1,35
  vez a cota da conta Team por dólar.
- Isso vem de duas leituras com arredondamento de ±0,5 ponto. Não descarta uso pelo claude.ai ou celular nessa
  conta. Fica como ordem de grandeza, sem erro confiável. As leituras da madrugada (0,8 a 0,96%/US$, mistura com
  mais Opus) têm a mesma ordem.

### O que isso muda nos estudos de custo

- Para converter um resultado em proxy (`bench/quota-eval.mjs`, US$ do host) em cota da conta Team, use
  `pontos de 5 h ≈ 0,827 × saída Sonnet + 0,458 × resto Sonnet + 0,415 × US$ Opus`. Um "−31% de proxy" vira menos
  que −31% de cota se a economia veio de leitura de cache.
- Para o Codex, `1% semanal ≈ 5,46 M` de `sem cache + 0,1 × cache + 8 × saída` na mistura atual do worker.

### Armadilhas achadas

- **`entrypoint` é herdado.** Um `claude -p` lançado de dentro do app sai nos transcripts com `entrypoint:
  claude-desktop`, embora use a conta do CLI. Os 431 trials da fase B saíram assim. Para separar contas, use a
  pasta do projeto do transcript. Os trials antigos da note2 (lançados por ssh) saíram como `sdk-cli` e não foram
  afetados.
- **O `claude -p` do runner escreve fora do workspace.** Trials da tarefa média gravaram `impl.bak` dois níveis
  acima do workspace. Não houve dano (pasta temporária), mas o runner não isola com sandbox.
- **A parada conta a partir da primeira leitura do bloco.** O bloco O-med começou com a leitura em 17, porque o fim
  do S-out ainda pesava, e parou em 25. A fase B gastou 25 pontos, 1 a mais que os 24 aprovados.
- Os 4 primeiros trials de S-med custaram cerca de US$ 0,21 cada (escrita de cache fria); os seguintes, cerca de
  US$ 0,07.

### Dados brutos

- [`bench/2026-11-21-calibracao-faseB-trials.jsonl`](bench/2026-11-21-calibracao-faseB-trials.jsonl): um trial
  por linha, com `modelUsage`, custo e as leituras da cota no início e no fim.
- [`bench/2026-11-21-calibracao-codex-serie.jsonl`](bench/2026-11-21-calibracao-codex-serie.jsonl): as 12 leituras
  do Codex, com o uso acumulado por família de modelo e tipo de token desde 2026-11-17.
- [`bench/2026-11-21-calibracao-app-leituras.jsonl`](bench/2026-11-21-calibracao-app-leituras.jsonl): as leituras do
  `get_usage` da conta do app.
- Para reproduzir, a coleta é `node bench/quota-calibration.mjs collect`, um bloco é
  `node bench/quota-calibration-run.mjs`, e o ajuste das tabelas acima é
  `node bench/quota-calibration-fit.mjs research/bench/2026-11-21-calibracao-faseB-trials.jsonl claude-sonnet-5-5`
  (uso no cabeçalho de cada script).

## Reavaliar

- **Modelo ou preço novo** (Sonnet ou Opus 6, mudança de preço de lista): os pesos por modelo mudam. Um bloco de
  8 pontos por modelo, como S-med, custa cerca de 8 pontos de 5 h e 1,3 ponto semanal.
- **Mudança de plano** (Team 5x para outro, Max do app, prolite do Codex): a escala muda inteira. Refaça um bloco
  S-med.
- **Separar leitura e escrita de cache:** precisa de um bloco com mistura diferente, com muita escrita e pouco
  reuso (prompts longos e distintos).
- **Pesos do Codex:** só saem com um bloco de mistura diferente (muita saída ou entrada sem cache). Vale fazer se a
  economia de cota do Codex virar decisão.
- **Conta do app:** a conversão com erro exige várias leituras do `get_usage` numa janela sem outro uso da conta.
- **Sinal de que a medida envelheceu:** uma janela com resíduo acima de 0,5 ponto, ou um bloco S-med fora de
  0,55 a 0,60 %/US$.
