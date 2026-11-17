# Relatório "host vs worker" do fim do dia (2026-11-17)

Status: **aplicado** em `bench/host-cost-core.mjs` e `bench/host-cost.mjs`. Continua o
[estudo de medição de tokens](2026-11-17-medicao-tokens-worker.md), que já cobria um transcript por vez.

## Uso

```bash
node bench/host-cost.mjs --day --log ~/.claude/polyagent-usage.jsonl          # hoje
node bench/host-cost.mjs --day 2026-11-16 --log ~/.claude/polyagent-usage.jsonl
```

Varre `~/.claude/projects/*/*.jsonl` (transcripts de nível superior, sem subagentes), recorta cada um
ao dia pedido e cruza com o log do Polyagent. Por sessão do host: tokens (input, cache read, cache
write, output), unidades de proxy e os workers do período **por engine** (codex e claude separados),
com `chamadas (medidas)`. No fim: total do host e total de cada worker, sem dupla contagem.

## Como o vínculo é feito, e o limite

O log do Polyagent não guarda o id da sessão do host. O vínculo é por **janela de tempo**
(primeiro a último evento do dia na sessão). Duas sessões abertas ao mesmo tempo disputam a mesma
chamada: ela aparece nas duas linhas e entra uma vez só nos totais; o relatório informa quantas
foram assim (`ambiguousCalls`) e quantas não caíram em nenhuma sessão (`outsideCalls`). Medido hoje:
23 sessões, 11 chamadas de worker no dia, 3 com tokens medidos (o log só passou a gravar
`workerUsage` depois do merge do PR de medição).

## O que o relatório não prova

Impresso no próprio relatório: sem baseline "host sozinho" para a mesma tarefa, economia continua não
demonstrada; host e worker estão em assinaturas diferentes e não se somam sem a conversão para cota
real (não medida); cota real não aparece. As unidades são razão de preço de entrada da API, não fatura.

## Tratamento de dado ruim

Linha JSON inválida, transcript sem timestamp, evento sem `usage`, entrada de log sem engine/ts ou com
`workerUsage` malformado são ignorados, nunca lançam. Nada de prompt ou resposta é lido para o
relatório: só `usage`, `message.id` e `timestamp` do transcript e os contadores do log.

## Reavaliar

- Se o log passar a gravar o id da sessão do host (hoje o servidor MCP não o recebe), trocar a janela
  por vínculo exato e remover `ambiguousCalls`.
- Quando houver pares "sozinho × com worker" na mesma tarefa, usar `compareHosts` para o saldo.
