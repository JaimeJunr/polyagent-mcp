# Como fazer o agente usar mais o polyagent (fan_out incluso) — pesquisa (2026-09-23)

Status: **3 mudanças aplicadas e medidas** (PR feat/adoption-eval) — resultado inconclusivo, ver "Medição". Pergunta do dono: como MCPs fazem o host usar
as tools deles, e como fazer o modelo se comportar como queremos — em especial usar mais o
`fan_out` e afins.

## O que funciona (fontes)

| Técnica | Como age | Evidência | Cuidado |
|---|---|---|---|
| `instructions` do servidor MCP | texto do `initialize` que o Claude Code mostra no início da sessão, mesmo com tools deferidas | [MCP lifecycle 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [Claude Code MCP](https://code.claude.com/docs/en/mcp) | truncado em 2.048 caracteres (instructions e cada description) |
| `_meta["anthropic/alwaysLoad"]` | schema carrega no início, sem depender de ToolSearch | [issue #82900](https://github.com/anthropics/claude-code/issues/82900): prompts relevantes chamaram a tool **0/9** deferida, **5/9** com alwaysLoad no cliente, **16/27** eager | a mesma issue relata alwaysLoad **do servidor** sem efeito num servidor HTTP (v2.1.219). No nosso stdio funciona: nesta sessão as tools core e o `rate` chegaram carregadas e o `fan_out` chegou deferido |
| Nome e descrição pensados para a **decisão** | a description diz *quando* usar, não só o que faz | [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents): descrições otimizadas cortaram **40%** do tempo de tarefa | sem número universal; avaliar no próprio caso |
| Hooks | `SessionStart`/`UserPromptSubmit` injetam contexto; `PreToolUse` nega a tool nativa com um motivo que o modelo lê; `PostToolUse` sugere o próximo passo | [Hooks reference](https://code.claude.com/docs/en/hooks) — "instrução orienta, hook garante" | `PreToolUse` é intervenção dura: casar estreito e sempre oferecer a alternativa |
| Negar tool nativa (`permissions.deny`, `--disallowedTools`) | tira a concorrência (ex.: `WebFetch`) | [Permissions](https://code.claude.com/docs/en/permissions) | quebra a tarefa se o MCP cair; só para rota obrigatória |
| Dica no resultado | o texto devolvido orienta a chamada seguinte | [MCP tools spec](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | afeta a próxima decisão, não a primeira |
| Subagente com lista de tools restrita | agente especializado só enxerga o MCP | [Subagents](https://code.claude.com/docs/en/sub-agents) | remove tool que pode fazer falta |
| MCP prompts/resources | viram slash commands / contexto endereçável | [MCP prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts) | chamados de propósito, não disparam sozinhos |

## Como o modelo se comporta (Anthropic)

- Seja explícito e **explique o porquê**. Modelos novos **disparam demais** com "CRITICAL: you MUST";
  prefira tom normal ("use quando ajudar"). ([Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices))
- Paralelismo: com instrução, chamadas paralelas independentes chegam a ~100%.
- Contexto é orçamento de atenção: pouco e de alto sinal; subagentes exploram em contexto separado.
  ([Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents))
- **Fan-out tem custo alto e lugar certo.** No sistema multi-agente de pesquisa da Anthropic: +90,2%
  sobre agente único, até −90% de tempo — ao custo de ~**4×** tokens (agente) e ~**15×**
  (multi-agente). Bom para trabalho amplo e independente; ruim para tarefa simples ou código muito
  acoplado. ([Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system))

## O que o polyagent já faz

| Técnica | Onde |
|---|---|
| `instructions` com a fronteira de roteamento | `new McpServer(...)` em `src/index.ts` |
| alwaysLoad nas 5 core + `fast_delegate` + `rate` | `src/index.ts` (o `fan_out` segue deferido) |
| Descriptions com "quando usar" e custo | `src/index.ts` |
| `SessionStart` + `SubagentStart` + `PreToolUse` (redirect one-shot de Read grande e Web) | `hooks/prefer-polyagent.mjs` |
| Dica no rodapé (`follow_up`, `rate`) | `format()` em `src/index.ts` |
| Medir uso | `POLYAGENT_LOG` + `bridge_stats` |

## Lacunas

1. **`fan_out` deferido** — mesmo bug do `fast_delegate` antes do alwaysLoad: sem schema carregado
   o agente quase nunca chama.
2. **Nenhum hook por prompt** (`UserPromptSubmit`): o empurrão é genérico, não reage ao pedido
   ("compara", "revisa", "pesquisa", "qual é melhor" → fan_out / delegate).
3. **Nenhuma dica pós-resultado dirigida**: um veredito arriscado de um worker só (`delegate` nível
   4/5) não sugere cruzar com `fan_out` consenso.
4. **Adoção não é medida**: o log vê as chamadas do bridge, não as nativas que o agente fez no
   lugar. Sem baseline não dá para provar que uma mudança aumentou o uso.
5. Tom do hook do host ("You are the ORCHESTRATOR… DEFAULT") no limite do que a Anthropic diz que
   faz disparar demais.

## Medição (2026-09-23)

`bench/adoption-eval.mjs`: 8 prompts fixos em `claude -p` real (config e hooks do usuário), 1 rodada
por prompt, antes e depois das 3 mudanças (`fan_out` alwaysLoad + description com quando/quando não,
hook `UserPromptSubmit` com dica por intenção, dica de cross-check após `delegate` nível 4/5).
Dado bruto: [`bench/2026-09-23-adoption.jsonl`](bench/2026-09-23-adoption.jsonl) (`label` baseline/after).

| Prompt | Antes | Depois |
|---|---|---|
| locate | ❌ Bash, Bash | ❌ Bash |
| read | ✅ read_slice | ✅ read_slice |
| web | ❌ Bash | ❌ Bash |
| noisy-cmd | ✅ run_filtered | ✅ run_filtered |
| second-opinion | ❌ delegate ×3 em série (timeout 8 min) | ✅ **fan_out**, read_slice, Bash |
| risky-verdict | ✅ ToolSearch, read_slice, delegate, rate (timeout) | ❌ Bash, Read, Bash ×3 |
| breadth | ❌ nenhuma tool (respondeu de memória) | ❌ nenhuma tool |
| control-simple | ✅ Bash | ✅ Bash |

| | Antes | Depois |
|---|---:|---:|
| acertos | 4/8 | 4/8 |
| usos de fan_out | 0 | 1 |
| timeouts | 2 | 0 |
| custo reportado | $3,89 (6/8 reportados) | $5,37 (8/8) |

Leitura:

- **Ganho claro num caso:** pedido explícito de opiniões independentes trocou 3 `delegate` em série
  (o anti-padrão que o `fan_out` existe para evitar) por um `fan_out`.
- **Dica calma é ignorada quando a tool nativa é boa o bastante:** em locate e web o host usou
  `grep`/`npm view` via Bash mesmo com a dica. `npm view` é resposta autoritativa e barata — o
  gabarito "web_lookup" pode estar exigente demais. Revisar o `expect` desses dois.
- **risky-verdict piorou**, e breadth continuou sem tool. Com **n=1** por prompt, essa troca não se
  separa de ruído.
- **Viés conhecido:** as regex da dica foram escritas conhecendo o vocabulário destes 8 prompts
  ("veredito confiável", "opiniões independentes"). O "depois" é um teto otimista.

Conclusão: nenhuma melhora líquida demonstrada; um ganho qualitativo real (fan_out no pedido
explícito). Não dá para afirmar que as mudanças aumentam a adoção.

## Reavaliar

Rodar 3–5 repetições por prompt (`node bench/adoption-eval.mjs after-rN`) e acrescentar prompts
**que a dica nunca viu** antes de decidir manter, endurecer (PreToolUse deny) ou reverter a dica.
Revisar o `expect` de locate/web (Bash com grep/npm view pode ser a escolha certa).
