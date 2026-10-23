# Radar: inferência rápida (DeepSeek V4.1 Flash no Fireworks, Liquid RIPL)

Nota de radar, sem medição nossa. Junta dois anúncios de 2026-10-22 que podem tocar o projeto,
pra decidir depois se vale um bench. Nada aqui mudou código.

## Resultado

Nenhuma mudança agora. Cada anúncio tem um lugar possível no bridge, e os dois dependem de medir no
caminho real (`runCursor` + bwrap) antes de qualquer decisão:

| Anúncio | Onde poderia entrar | Concorre com |
|---|---|---|
| DeepSeek V4.1 Flash no Fireworks Ultrafast | 3ª posição do `FAST_CANDIDATES` (pay-per-token, depois das duas assinaturas) | mercury-2 via OpenRouter |
| Liquid RIPL + LFMs / modelos de decisão d1 | Papel do Jev: gate de consenso do `fan_out` e shadow de nível do `delegate` | Jev (OpenRouter) e Laya local |

## DeepSeek V4.1 Flash no Fireworks Ultrafast

Fonte: post de @FireworksAI_HQ no X, 2026-10-22 (lista de espera: https://bit.ly/3UA0wKq).
Números do fornecedor, não conferidos:

- 1.521+ tok/s no Fireworks Ultrafast;
- "Tetris em 11 segundos", 7x mais rápido que o Claude Opus 5.5.

Por que não muda nada sozinho:

1. **Tok/s não é o gargalo do nosso caminho.** O mercury-2 já gera muito rápido e mesmo assim teve
   mediana de 14,8 s e um timeout de 240 s no bench de 2026-09-23, pior que o Haiku 5.5 (mediana
   5,6 s, ver [2026-10-07-haiku-5-5.md](2026-10-07-haiku-5-5.md)) e o Luna medium (8,6 s). Pesam a
   subida do CLI, o loop de tool calls e o acerto no uso de tools.
2. **A comparação é com o Opus 5.5**, que não está na fila rápida. O concorrente real é o
   mercury-2; Haiku 5.5 e Luna (assinatura) seguem na frente por custo.
3. **Pay-per-token e Ultrafast em lista de espera.**

Encaixe provável: engine `opencode` com id `provider/model`, sem engine nova, se o modelo estiver no
OpenRouter ou o opencode aceitar o provedor Fireworks. Não conferido.

## Liquid RIPL (Real-time Inference Pipeline)

Fonte: thread de @liquidai no X, 2026-10-22. Números do fornecedor, todos em B200, não conferidos:

- resposta completa de ponta a ponta abaixo de 50 ms, estável sob carga contínua;
- LFMs até 20x mais rápidos no RIPL; suporta LFMs multimodais e os modelos de decisão d1;
- casos: adtech 32 in → 32 out (LFM2.5-350M); classificação de busca 128 in → 1 out, só prefill
  (LFM2.5-350M); reranker 1k in → 1 out abaixo de 8 ms (LFM2.5-350M); pagamentos 512 in → 16 out
  com saída estruturada (LFM2.5-1.2B).

Leitura pro projeto: o RIPL em si é infraestrutura de servidor (B200), fora do alcance deste
notebook. O que interessa é o formato: decisão curta e estruturada com poucos tokens de saída é
exatamente o que o Jev faz (`decide`, gate de consenso, shadow de nível e de clareza de prompt). Um
modelo de decisão pequeno (d1 ou LFM2.5) seria candidato a substituir o Jev, como o Laya foi
testado em [2026-09-28-laya-local.md](2026-09-28-laya-local.md). O limite que derrubou o Laya
(janela de contexto estourada no `fan_out` longo) vale conferir primeiro aqui também.

Não conferido: se d1/LFM2.5 têm pesos abertos ou API pública, e o tamanho da janela de contexto.

## Descartado

- Trocar o mercury-2 ou o Jev só pelos números do anúncio: nenhum dos dois foi medido no nosso caminho.

## Reavaliar

- **DeepSeek V4.1 Flash:** quando sair da lista de espera ou aparecer no OpenRouter. Rodar
  `npm run bench` (skill `run-bench`) contra o mercury-2. Entra no lugar dele se tiver mediana menor,
  sem timeout e nota (`rate`) igual ou maior.
- **Liquid d1 / LFM2.5:** quando houver API ou pesos acessíveis. Rodar o mesmo bench do Jev
  ([2026-09-24-jev-decisions-bench.md](2026-09-24-jev-decisions-bench.md)) via `POLYAGENT_JEV_URL`.
  Substitui o Jev se acertar o gate a 0,85 sem falso pulo e couber a saída longa do `fan_out`.
