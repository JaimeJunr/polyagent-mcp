# Economia de cota: evidência disponível e protocolo (2026-11-15)

## Resultado e decisão

**A economia de cota do Claude Code com Polyagent não está demonstrada.** Esta é uma
avaliação documental, conferida em 2026-11-15, não uma nova rodada de benchmark.
Ausência de demonstração não prova ausência de benefício; impede anunciar o benefício como fato.

Continuação: a [auditoria histórica](2026-11-15-auditoria-historica.md) localizou uso efetivo,
comparou tarefas iguais nos benchmarks existentes e contabilizou os registros recuperáveis
de workers Claude. Ela não demonstrou economia e não substitui o protocolo controlado abaixo.

Atualização posterior no mesmo dia: o [piloto controlado](2026-11-15-piloto-controlado.md)
executou 32 + 12 tentativas corrigidas e encontrou redução no custo equivalente de API Claude
para implementação com delegação antecipada. O consumo da cota real continua sem medição
atribuível. O protocolo abaixo permanece como referência; o piloto registra seu escopo,
desvios e limites explicitamente.

O objetivo principal é concluir tarefas com qualidade equivalente consumindo menos cota Claude.
O acesso a modelos de outros fornecedores e o `fan_out` são capacidades distintas. A hipótese
de que perspectivas de modelos diferentes encontram mais erros deve ser medida separadamente,
sem pressupor independência dos erros nem usar consenso como prova de correção.

Não investir em mais mecanismos de adoção como substituto dessa avaliação. Primeiro estabelecer
uma comparação do consumo completo. A revisão documental inicial não executou chamadas de
benchmark; as rodadas posteriores com uso de assinaturas estão registradas no piloto.

## O que as evidências existentes sustentam

| Evidência | O que mede | O que não prova |
|---|---|---|
| [Bench auxiliar de setembro](2026-09-23-aux-tools-bench.md), com [dados brutos](bench/2026-09-23-aux.jsonl) | Acerto e latência de workers em tarefas pequenas, no caminho real do bridge | Economia do host, consumo agregado ou desempenho em tarefas grandes |
| [Eval de adoção de setembro](2026-09-30-adoption-handoff.md), com [dados brutos](bench/2026-09-30-adoption.jsonl) | Ferramentas escolhidas pelo host e custo reportado nas sessões disponíveis | Que escolher Polyagent reduz cota ou melhora o resultado final |
| [Redirecionamento de edição](2026-10-23-edit-redirect.md), com [dados brutos](bench/2026-10-23-adoption.jsonl) | Resultado negativo da tentativa de induzir delegação antes da edição | Ineficácia de toda delegação; o estudo tem poucas repetições |
| [`UsageEntry`](../src/usage.ts) e `bridge_stats` | Caracteres retornados, chamadas, duração, engine, resultado e avaliações | Tokens completos do host/workers, cota consumida ou economia contra controle |
| [Custos por modelo](2026-09-24-custo-por-tarefa.md) | Proxies externos para comparar modelos | Consumo observado por tarefa real do usuário |

O eval de setembro registra implementação feita pelo host antes de chamar `delegate`.
Isso é evidência histórica de trabalho potencialmente duplicado, não causa confirmada do
consumo recente. O parser atual de `bench/adoption-eval.mjs` coleta `total_cost_usd` do host;
não estabelece que esse valor inclua CLIs externos iniciados pelo bridge.

Uma inspeção exploratória dos 30 transcripts principais mais recentemente modificados no
ambiente local não encontrou tools com `polyagent` no nome. A seleção por modificação,
exclusão de subagentes e ausência de controle por tarefa impedem uma comparação antes/depois.
Ela não integra uma prova de eficácia; conteúdo privado desses transcripts não é publicado aqui.

## Fundamento externo e limites de transferência

- [Claude Code: custos](https://code.claude.com/docs/en/costs): distingue estimativa de API
  de cobrança de assinantes e recomenda gestão de contexto, modelos e instruções sob demanda.
- [Claude Code: prompt caching](https://code.claude.com/docs/en/prompt-caching): contexto
  repetido pode ser lido de cache; subagentes têm conversas/cache próprios. Contar todos os
  tokens como entrada nova distorce a análise. Os CLIs externos do bridge também devem ser
  contabilizados, sem presumir compartilhamento de cache com o host.
- [The Complexity Trap](https://arxiv.org/abs/2508.21433), Lindenbauer et al.:
  experimentos com SWE-agent/SWE-bench Verified encontraram economia com ocultação de
  observações antigas, competitiva com sumarização por LLM. Isso justifica testar filtragem
  simples; não demonstra economia no Claude Code nem no Polyagent.
- [Anthropic: incorporar subagentes ao loop principal](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop):
  recomenda comparar desempenho com e sem intermediários, usando skills e ferramentas quando
  apropriado. É orientação de arquitetura, não benchmark deste projeto.

Fontes consultadas em 2026-11-15. Registrar versões locais na execução: documentação corrente
pode descrever recursos ausentes no Claude Code instalado.

## Protocolo proposto — ainda não executado

### Comparação de economia

Comparar três condições, com as mesmas tarefas e critérios de aceitação:

1. Claude Code com configuração habitual, sem Polyagent nem instruções/hooks de roteamento.
2. Claude Code com contexto permanente enxuto, sem Polyagent.
3. A mesma configuração enxuta, com Polyagent e sua configuração de roteamento registrada.

A comparação 3 contra 2 estima o ganho adicional do Polyagent; 2 contra 1 estima o ganho de
enxugar a configuração. Uma comparação 3 contra 1 sozinha mistura os dois efeitos.

Antes de executar, versionar fixtures, critérios de qualidade, configurações saneadas e
plano de análise. Incluir localização/leitura, comandos volumosos, implementação e diagnóstico;
usar tarefas de mais de um projeto, sem credenciais ou dados privados no material publicado.
O controle pode usar ferramentas nativas eficientes: não exigir leitura integral artificial.

Usar o mesmo commit inicial por tarefa, modelo/esforço do host e limites de execução.
Registrar versões dos CLIs, commit do bridge, engines disponíveis, flags, cache e contexto
carregado. Alternar a ordem das condições e repetir os pares em sessões isoladas. Registrar
se houve cache compartilhado entre execuções; não misturar resultados frios e quentes sem informar.
Manter execuções pesadas seriais e seguir os limites de recursos do projeto.

### Dados necessários por tentativa

- ID da tarefa, condição, repetição, horários, versões e critérios de aceitação.
- Resultado verificável: testes/artefatos, falhas, timeout, correções e intervenção humana.
- Tokens de entrada nova, criação de cache, leitura de cache e saída, separados por modelo,
  host e worker Claude; capturar os demais fornecedores separadamente.
- Sequência de ferramentas, posição da primeira delegação e leituras/edições anteriores a ela.
- Tempo total e custo equivalente de API, com tabela de preços datada e método explícito.
- Quando observável, variação da cota da assinatura e janela de reset. Marcar concorrência
  de outras sessões e granularidade do indicador; amostra contaminada não atribui cota ao bridge.

Deduplicar eventos de streaming por chamada/mensagem; não somar snapshots de uso como se
fossem requisições distintas. Não publicar prompts privados, respostas ou segredos nos logs.
Execuções incompletas continuam no denominador. Somar também o consumo das tentativas que
falharam e do retrabalho até chegar ao resultado aceito.

### Análise e critério de decisão

Resultado principal: consumo Claude por tarefa aceita, incluindo host, workers Claude e
retrabalho. Mostrar também taxa de conclusão e consumo de todas as tentativas para não
premiar abandono precoce. Consumo deslocado para Codex/outro fornecedor deve ficar visível.

Tokens por categoria e custo equivalente de API são indicadores auxiliares. Sem medição
atribuível de cota, concluir apenas sobre esses indicadores; não convertê-los em percentual
de economia da assinatura por uma fórmula presumida.

Definir antes da rodada a redução mínima útil, a tolerância de qualidade e a amostra,
considerando o custo de medir. Publicar diferenças pareadas, dispersão e incerteza, além
dos agregados; não escolher esses limites depois de ver os resultados. Este documento
não define um limiar numérico sem dados e sem decisão sobre o benefício mínimo desejado.

Uma alegação de economia exige redução consistente na métrica declarada, qualidade dentro
da tolerância predefinida e custos externos explícitos. Se o resultado for inconclusivo,
publicar como inconclusivo. Se não houver ganho útil, interromper a evolução voltada à economia
e reavaliar a continuidade com base nos benefícios que forem demonstrados.

### Comparação de qualidade entre modelos

Comparar agente único com `fan_out` em casos com defeitos conhecidos ou critérios verificáveis.
Incluir um controle de múltiplas tentativas do mesmo modelo, com orçamento comparável, para
separar diversidade de modelos de simplesmente gastar mais tentativas/tokens.
Avaliar acertos adicionais, falsos positivos, tempo e consumo total, com julgamento cego
à condição quando viável. Discordância, volume de achados e concordância não são o gabarito.

## O que foi descartado como prova

Mais chamadas ao bridge, menos caracteres retornados, aprovação do próprio worker e proxies
de leaderboard não substituem o teste de economia. Também não usar um resultado externo
de paper como percentual esperado do projeto, nem comparar totais de sessões com tarefas diferentes.

## Reavaliar

Atualizar este estudo quando houver a primeira rodada controlada com dados brutos saneados,
comando reproduzível, configurações e critérios definidos antes da execução. Até lá, a
formulação pública é: o Polyagent permite delegação entre CLIs e retorno filtrado de resultados;
a economia de cota Claude e o ganho de qualidade por diversidade de modelos estão em avaliação.
