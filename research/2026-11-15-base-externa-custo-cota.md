# Base externa de custo e cota (antes de medir a cota real)

Complementa [2026-11-15-evidencia-economia-cota.md](2026-11-15-evidencia-economia-cota.md) e
[2026-11-15-piloto-controlado.md](2026-11-15-piloto-controlado.md). Reúne o que já está publicado
sobre custo de subagentes/delegação no Claude Code, para servir de base comparativa enquanto não
medimos a cota real da assinatura do dono. Fontes lidas em 2026-11-15; dados oficiais primeiro,
blogs de terceiros depois, marcados como tal.

## Fontes oficiais (Anthropic/Claude Code)

Lidas na íntegra (página de custos) ou em ~69% verbatim + resumo de modelo para o restante
(página de subagentes — ver nota no final).

- [docs.anthropic.com/en/docs/claude-code/costs](https://docs.anthropic.com/en/docs/claude-code/costs)
  (redireciona para a página abaixo)
- [code.claude.com/docs/en/costs](https://code.claude.com/docs/en/costs)
- [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents)

### O que está publicado, com número

- **Não há custo por subagente em tokens ou dólares publicado em nenhuma das duas páginas.**
  O único multiplicador numérico encontrado é de **agent teams** (modo distinto de subagente
  comum, times de IA), não de delegação simples: *"Agent teams use approximately 7x more tokens
  than standard sessions when teammates run in plan mode."*
- Cada subagente manda as próprias requisições, que contam na mesma cota do usuário: *"It also
  sends its own requests, which count toward the same usage limits as your main conversation."*
- Overheads de contexto publicados (verbatim):
  - Aviso de startup acima de 15.000 tokens de descrições combinadas de subagentes.
  - `MEMORY.md`: só as primeiras 200 linhas ou 25 KB entram no prompt do subagente.
  - Skills pré-carregadas: até as primeiras 32 distintas da lista.
  - Janela de auto-compact por subagente (`autoCompactWindow`): de 100.000 a 1.000.000 tokens.
- Cache entre pai e filho: a página de custos diz só que as estatísticas de `/usage` **não cobrem
  subagentes**. A página de subagentes (na parte resumida, não confirmada verbatim) distingue fork
  ("Shared with the parent conversation") de subagente não-fork ("Separate cache"), com a frase
  *"a fork costs less than a fresh subagent for tasks that need the same context"* — sem fator
  numérico de desconto.
- Custo médio reportado por empresas usando Claude Code: *"around $13 per developer per active
  day and $150-250 per developer per month, with costs remaining below $30 per active day for 90%
  of users."* Isso é consumo agregado de produto, não isola o efeito de delegação.
- Limite de TPM/RPM por organização cai com o número de usuários (tabela da página de custos):
  200k-300k TPM / 5-7 RPM por usuário para 1-5 usuários; 10k-15k TPM / 0,25-0,35 RPM por usuário
  para 500+. Relevante porque mostra que "cota" no Claude Code é um orçamento agregado da conta,
  não um contador isolado por chamada de subagente.
- Quando a documentação recomenda delegar: tarefa que inundaria a conversa principal com
  resultado de busca, log ou conteúdo de arquivo que não será referenciado de novo; trabalho
  autocontido que pode devolver um resumo. Quando recomenda NÃO delegar (parte lida como resumo de
  modelo, não confirmada verbatim): tarefa que precisa de ida e volta frequente, mudança pontual
  rápida, ou quando latência importa (subagente que não é fork começa do zero).

### O que isso confirma do piloto controlado deste projeto

Bate com o achado do piloto ([2026-11-15-piloto-controlado.md](2026-11-15-piloto-controlado.md)):
não existe economia automática por ter a ferramenta de delegação disponível — a documentação
oficial também não promete isso, só fala em **conter o crescimento da janela principal**, e avisa
que cada subagente soma na mesma cota. A vantagem de custo aparece só quando a tarefa delegada é
grande e autocontida o bastante pra valer o overhead de iniciar outro agente — o que também é o
padrão medido aqui (delegar a implementação inteira antes de explorar reduziu custo; delegação
forçada em tarefas pequenas aumentou).

## Fontes de terceiros (não oficiais, tratar como estimativa)

Buscadas para contexto, não como prova — números de blogs e guias sem metodologia publicada:

- [The Economics of Claude Code — Part 2: The Agent Tradeoff](https://www.zivtech.com/blog/economics-of-claude-code-part-2-agent-tradeoff)
- [Claude Code Subagents vs. Agents (joinleland.com)](https://www.joinleland.com/library/a/claude-subagents)
- [Why Claude Code Sub-Agents Cost 7x More Tokens (MindStudio)](https://www.mindstudio.ai/blog/claude-code-subagents-cost-tokens)
- [Subagentes no Claude Code economizam contexto ou multiplicam o gasto? (horadecodar.com.br)](https://horadecodar.com.br/?p=43291)
- [Claude Code Subagent Token Usage (claude-skills-guide)](https://claude-skills-guide-3lc.pages.dev/claude-code-subagent-token-usage-control-costs/)
- [Multi-Agent Token Budgeting (claude-skills-guide)](https://claude-skills-guide-3lc.pages.dev/multi-agent-token-budgeting-allocate-subagents/)

Pontos recorrentes nessas fontes (sem confirmação oficial, úteis só como hipótese a testar):

- Overhead por subagente estimado em ~5.000 tokens; delegação só compensaria a partir de
  tarefas grandes (~20K tokens), com sobretaxa de ~50% numa tarefa de 10K e ~10% numa de 50K.
  **Não testamos esse limiar especificamente** — o piloto deste projeto usou poucas tarefas
  (pequena e lote transacional), não uma curva por tamanho de tarefa.
  **Reavaliar:** rodar o piloto com tarefas de tamanho crescente para achar esse limiar com dados
  próprios, em vez de usar a estimativa de terceiros.
- A afirmação específica "subagentes custam 7x mais tokens" citada pelo MindStudio **não foi
  localizada verbatim** nas páginas oficiais lidas — a única cifra 7x oficial é de agent teams em
  modo plano, um recurso diferente. Não usar esse número para subagente comum.
- Um guia modela economia de ~47% num workflow de 5 subagentes após otimização — número
  modelado, não medido, mesma ressalva.

## Reavaliar

Quando: antes de declarar a economia de cota "comprovada" num relatório formal, ou se a Anthropic
publicar número oficial de custo por subagente/delegação. Enquanto isso não existir, qualquer
percentual de terceiro aqui é hipótese, não evidência — a evidência própria deste projeto é a do
piloto controlado, que mede o fluxo real do Polyagent, não subagentes nativos do Claude Code.

## Nota de leitura

A página de subagentes (116.580 caracteres) foi lida verbatim nos primeiros ~69% e resumida por
modelo no restante; os pontos marcados acima como confirmados vieram do trecho verbatim. Os limites
de 20 subagentes simultâneos, 3 níveis de aninhamento e a tabela de cache fork/não-fork vieram do
resumo e não foram confirmados caractere a caractere — releia a página direto se for citá-los em
algo público.
