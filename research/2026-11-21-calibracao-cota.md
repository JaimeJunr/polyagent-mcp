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
