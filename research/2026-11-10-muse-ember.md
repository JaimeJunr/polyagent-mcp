# Muse Ember (Meta) e o gráfico contra GPT-6.1 Terra (2026-11-10)

Sem medição nossa, nada aplicado. O Muse Ember foi **descartado sem bench**: a conta do Muse Code
exige forma de pagamento (cerca de R$ 26) e o dono não quis pagar só para testar.

## O modelo

- Id anunciado: `muse-ember-1.0`, no Muse Code (CLI `muse`) e na Meta Model API. **Não confirmado
  em execução real** (ver "Tentativa de bench").
- Preço de API (VENDOR, anúncio da Meta): US$ 0,10 por milhão de tokens de entrada, US$ 0,004 de
  entrada em cache e US$ 0,50 de saída. Acima de 200 mil tokens de prompt: US$ 0,30 / 0,012 / 1,50.
- Contexto de 1M tokens, saída até 512K.
- É **pay-per-token**: não pode entrar nos níveis do `delegate` (todos de assinatura) sem decisão
  explícita do dono. A única vaga natural seria a 3ª do `FAST_CANDIDATES`, hoje do mercury-2.

## Números de terceiros

AA = Artificial Analysis, Intelligence Index **v5**. Atenção: as notas do `CLAUDE.md` (Luna max
AA 38, Sol medium 48, Opus high 54) são de uma versão anterior do índice; no v5 o Luna max aparece
com 27,8. Compare só números da mesma versão.

| Modelo e esforço | Nota AA v5 | US$/tarefa | Fonte |
|---|---:|---:|---|
| Muse Ember max | 36 (35,8) | 0,14 (0,136) | INDEPENDENT (AA) |
| Muse Ember xhigh | 34 | 0,12 | INDEPENDENT (AA) |
| Claude Haiku 5.5 max | 36 | 0,41 | INDEPENDENT (AA, via mlq.ai) |
| GPT-6 Luna max | 27,8 | ≈0,135 | INDEPENDENT (AA, via mlq.ai e gráfico) |
| GPT-6.1 Terra low | ≈29,5 | ≈0,07 | gráfico AA, valor lido a olho |
| GPT-6.1 Terra medium | ≈38,5 | ≈0,165 | gráfico AA, valor lido a olho |

- Vals AI (INDEPENDENT): Ember é o mais barato do Vals Index, US$ 0,15 por teste, e o mais rápido
  do top 12 (~15 min).
- O gráfico "Intelligence vs. Cost Per Task" (AA, 9/11/2026), postado em resposta ao anúncio,
  mostra o **Terra acima da fronteira do Ember**: Terra medium tem nota maior por pouco mais de
  custo, e Terra low supera o Luna max pela metade do custo. Os valores do Terra não estão em
  texto em nenhuma fonte achada; vieram da leitura do gráfico.
- Ressalva de terceiros: o Ember responde "não sei" com frequência (1023jack.com).

## O que isso diz para o polyagent

- O Terra roda na assinatura do Codex (custo marginal zero). Mesmo se o Ember fosse grátis, o
  gráfico o coloca abaixo do Terra; pago, perde de vez.
- O bench das auxiliares de 2026-11-03 (commit `15d3554`, `research/bench/2026-11-03-aux.jsonl`)
  mediu Terra low 11/12 (mediana 8,5 s), medium 11/12 (9,3 s), xhigh 10/12 (9,9 s) contra Luna max
  12/12 (8,7 s). Todos os erros do Terra foram no `web_lookup`. Esse bench só tem leitura, então não
  decide o nível low do `delegate`: falta bench de implementação.

## Tentativa de bench (2026-11-10)

1. O `muse` não estava instalado (nem aqui nem na note2). Instalado pelo instalador oficial
   (`https://dev.meta.ai/install.sh`, conferido antes): Muse Code 1.4.15 em `~/.local/bin/muse`.
2. `muse exec --model muse-ember-1.0` → `missing meta credential in ~/.config/muse/auth.json`.
3. `muse login` (device flow) gravou a credencial e a removeu em seguida:
   `Muse Code requires a payment method — subscribe at https://accountscenter.meta.com/muse_code/?ep=no_payg`.
4. Dono recusou pagar. Os candidatos `ember-*` saíram do `bench/aux-bench.mjs` e o binário foi
   para a lixeira.

Consequência para a engine `muse` já integrada (`research/2026-09-18-muse-engine.md`): sem conta
paga ela não roda nenhum modelo da Meta; só o `--provider echo` (teste sem custo) funciona.

## Fontes

- Meta, anúncio (VENDOR): https://research.meta.ai/blog/muse-ember
- AA, artigo (INDEPENDENT): https://artificialanalysis.ai/articles/meta-s-muse-ember-is-the-cheapest-model-scoring-36-on-the-intelligence-index
- mlq.ai (comparações com Haiku e Luna): https://mlq.ai/news/meta-releases-muse-ember-a-10-cent-per-million-token-model-for-high-volume-agent-work/
- 1023jack.com (ressalva do "não sei"): https://1023jack.com/market/meta-s-muse-ember-scores-36-for-0-14-a-task-the-catch-it-often-says-i-don-t-know/
- Instalação do Muse Code: https://developer.meta.com/ai/lp/muse-code/
- Posts no X de @alexandr_wang, @ValsAI e @DavidSZD1 (gráfico AA com o Terra), 9/11/2026, colados pelo dono.

## Reavaliar

- Se a Meta liberar o Muse Code sem forma de pagamento ou com cota grátis.
- Se a AA publicar o Terra em texto: substituir os valores lidos do gráfico.
- Antes de mexer no nível low: bench de implementação Terra low/medium contra Luna max.
