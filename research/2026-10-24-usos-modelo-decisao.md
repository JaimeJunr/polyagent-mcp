# Onde o polyagent pode usar melhor os modelos de decisão

Data: 2026-10-24. Pesquisa de produtos, papers e padrões, cruzada com as decisões
heurísticas do nosso código. Ponto de partida: hoje o modelo de decisão (default Elephant 1, ver
`2026-10-24-modelos-decisao-gratis.md`) só aparece em três lugares — `decide`, o gate opcional de
consenso do `fan_out` e o shadow de nível do `delegate` — e as duas flags estão desligadas.

## O que o mercado está fazendo (repos conferidos no GitHub em 2026-10-24)

| Projeto | O que faz | Padrão |
|---|---|---|
| [jkudish/jev-mcp](https://github.com/jkudish/jev-mcp) (549★) | MCP genérico: `jev_verify`, `jev_screen`, `jev_rerank`, `jev_review`, `jev_gate` e mais | Três saídas (`auto`/`review`/`escalate`), limiares por parâmetro, confiança desconhecida = escalar |
| [JevAgentHarness](https://github.com/JevAgentHarness/JevAgentHarness) (41★) | Jev escolhe a próxima tool do agente quando a confiança passa de um limiar ajustado nas trajetórias do próprio agente; senão o LLM decide | Autores relatam 81–89% menos custo, até 2,5× mais rápido, sem perder mais de 3 pontos |
| [nanoDBA/jev-agent-kit](https://github.com/nanoDBA/jev-agent-kit) | Conjuntos de perguntas `preflight-route`, `postflight-verify`, `stop-or-continue`, `tool-call-gate` para Claude Code/Codex | Shadow primeiro; só age em modo enforce, com limiar calibrado |
| [qualixar/jev-decision-layer](https://github.com/qualixar/jev-decision-layer) | Roteia tarefa/tool/worker/skill entre candidatos dados; aprovação final fica com o usuário | Escolha fechada + auditoria |
| [hotchpotch/jev-reranker](https://github.com/hotchpotch/jev-reranker), [rag-jev](https://github.com/EmreKaplaner/rag-jev) | Filtra e reordena trechos de RAG | Corta abaixo de 0,2 de relevância |
| [Jev-Engineering/cookbook](https://github.com/Jev-Engineering/cookbook) | 60 receitas: batch de perguntas, roteamento com abstenção, score composto, cascata de extração | — |
| Respan Span-01 | Detecta comportamento em trace (injeção, alucinação, vazamento de segredo, mau uso de tool) | `p_not_observable` separado de "ausente" |

### Além do Jev: o resto da categoria

Os produtos acima são quase todos Jev porque ele saiu primeiro; a categoria já tem pelo menos oito
modelos. Levantamento por web lookup em 2026-10-24 — várias linhas vêm de páginas de terceiros ou
do próprio fornecedor, então tratar números como indicativos (o contexto do Mercury Decide, por
exemplo, aparece como 32K no OpenRouter e 65K em outra fonte).

| Modelo | Pesos | API | Nota publicada | Uso documentado |
|---|---|---|---|---|
| OpenAI Decisions API (GPT-6 Luna), GA 22/10 | fechado | própria (`predicate`/`choice`/`score`), não `/v1/systemone` | sem linha nos índices | classificação, roteamento, escolha de ação |
| Microsoft-Decision-1 (Qwen3.5-9B) | **abertos** | `/v1/systemone` no Foundry; também no OpenRouter | AA: atrás do Jev e do GLiDE | Xbox, controle de qualidade do Copilot, jailbreak e injeção |
| Mercury Decide (Inception), 30/09 | fechado | própria `/v1/decisions`; `/v1/systemone` via OpenRouter | AA 53 (fonte secundária) | integração MemberJunction |
| Mammoth 1 / Elephant 1 (Baseten), 21/10 | **abertos** (HF `baselabs/`) | `/v1/systemone` via OpenRouter (medido aqui) | Jev Index 71,24 / 62,65 (fornecedor) | nenhum produto achado |
| Perplexity Decider V1.2 / Flash | fechado | própria + OpenRouter | Jev Index 69,42 (relatório da Baseten) | nenhum produto achado |
| Respan Span-01 | fechado | própria `/api/v1/scores` | F1 0,843 (fornecedor) | Behaviors: monitorar trace de agente |
| Liquid d1 (e d1-3B aberto) | hospedado fechado; variantes abertas | compatível com System One | AA d1-ultra 65 | exemplos do próprio Liquid |

Consequências para nós: (a) o código fala `/v1/systemone`, então troca de modelo é uma variável —
a API da OpenAI e a própria da Inception ficam fora sem um adaptador; (b) Elephant, Mammoth e
Microsoft-Decision-1 têm pesos abertos, então rodar local é possível, mas o estudo do Laya local
(2026-09-28) mostrou que modelo local sem a calibração do fornecedor pode piorar o shadow — e esta
máquina não tem RAM sobrando; (c) Span-01 é o único com "não observável" separado de "ausente",
útil se um dia o verificador ler traces em vez do texto final.

Papers que embasam o desenho: cascata com verificador (AutoMix, NeurIPS 2024: >50% menos custo),
roteamento + cascata unificados (Dekoninck et al., ICML 2025), abstenção cedo na cascata (arXiv
2502.09054: −13% custo, −5% erro), abstenção conformal (CAP, PMLR 2025). Recado comum: separar
**aceitar / escalar / abster**, calibrar o limiar com o histórico do próprio sistema, e preferir
evidência determinística (teste, tipo) quando ela existe. O Artificial Analysis Decision Index
avisa que esses modelos costumam ser confiantes demais em conhecimento e raciocínio.

API: até 32 perguntas por chamada sobre o mesmo `state` (batch sai pelo preço de uma), tipos
`noul`/`choice`/`score`; o Router recomenda revalidar limiares ao trocar de modelo.

## Lição para nós

Ferramenta genérica de decisão (verificar, reordenar, triar) o `jev-mcp` já entrega. O polyagent
só ganha usando o modelo onde ele tem um contexto que mais ninguém tem: **o resultado do worker,
o roteamento entre níveis e o histórico de `rate`** para calibrar.

## Ideias, da maior para a menor relação valor/custo

1. **Verificador do resultado do worker (postflight), em shadow.** Depois de `delegate`/
   `fast_delegate`, uma chamada com 3–4 `noul` sobre prompt + resultado: "o resultado afirma
   sucesso?", "traz o denominador (quantos itens checou)?", "a afirmação de sucesso tem evidência
   concreta (comando, saída, arquivo:linha)?", "atende o pedido?". Ataca nosso problema registrado
   do verde vazio (`evidenceNote`): a nota pede o denominador, mas nada confere se veio. Começa só
   gravando no log; validar cruzando com `rate`. Depois, opcional: anexar uma linha
   `[check: sem evidência do denominador]` no rodapé.
2. **Cascata: escalar quando o verificador reprova.** Com o item 1 calibrado, sugerir no rodapé
   `follow_up` ou o próximo nível (padrão AutoMix). Nunca reexecutar sozinho.
3. **Nível do `delegate` com três saídas.** O shadow existe; trocar "sugerir nível" por
   aceitar/escalar/abster com limiar ajustado nas notas `rate` (padrão JevAgentHarness). Antes,
   ligar `POLYAGENT_JEV_SHADOW` com o Elephant para juntar dados reais (hoje são 12 registros, do Jev).
4. **Roteamento de prompt do hook por `choice`.** `promptRouteContext` decide por regex entre
   `fan_out`/`web_lookup`/`run_filtered`/`explore`. Um `choice` com "nenhum" como opção pode
   substituir ou confirmar a regex; medir com `bench/adoption-eval.mjs`. Custo: ~0,5 s em todo
   prompt do usuário e cota `:free` diária.
5. **Triagem de injeção no `web_lookup`.** O texto da web entra no contexto do host; um `noul`
   de injeção com `block`/`review` (padrão `jev_screen`) antes de devolver.

Descartados: substituir `classifyQuotaError` (o código registra que classificar errado é pior que
não classificar) e `isFullFileRequest` (a regex já tem a rede do prompt; ganho pequeno).

## Restrições

- Cota `:free`: 20 req/min; 50/dia, ou 1000/dia com ≥ US$ 10 de crédito. As 244 chamadas do
  bench de hoje passaram sem 429, o que sugere a conta já no patamar de 1000/dia (não confirmado).
  Usar batch (várias perguntas numa chamada) e só nos pontos acima.
- Tudo começa em shadow e com fallback para o caminho atual; nada bloqueia sem limiar calibrado.

## Item 1 implementado (2026-10-24)

`POLYAGENT_JEV_VERIFY=1` liga `withDelegateVerify` (`src/jevDecisions.ts`) em `delegate` e
`fast_delegate`: não aguardado, só grava `delegate_result_verify_shadow`. Smoke com Elephant 1, seis
casos escritos à mão (tarefa de achar skills órfãs e tarefa de renomear):

| Caso | Esperado | 1ª redação | Depois de reescrever 2 perguntas |
|---|---|---|---|
| "Check passed", sem números | unsupported | unsupported 0,99 | unsupported 0,99 |
| 14 invocações varridas, 0 órfãs, com saída | supported | **unsupported** 0,60 | supported 0,60 |
| Não conseguiu rodar | no_claim | no_claim 1,00 | no_claim 0,99 |
| Sucesso de outra tarefa | unsupported | **no_claim** 0,55 | unsupported 0,99 |
| Renomeou, diff e 6 testes | supported | — | supported 0,99 |
| "Done. Renamed and tests pass." | unsupported | — | unsupported 1,00 |

Mudanças que corrigiram: `claims_success` passou a valer "independente de a obra bater com a
tarefa", e `addresses_task` aceita "achar nada" como resposta. Latência ~0,4–1,1 s, fora do caminho
do host. Seis casos são smoke, não calibração.

## Reavaliar

Depois de ligar `POLYAGENT_JEV_VERIFY` em uso real, juntar ≥ 30 registros com `rate` e medir se o
verificador separa notas ≤ 3 de notas ≥ 4. Só então pensar no item 2.
