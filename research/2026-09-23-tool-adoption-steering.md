# Como fazer o agente usar mais o polyagent (fan_out incluso) — pesquisa (2026-09-23)

Status: **pesquisa**, nenhuma mudança aplicada ainda. Pergunta do dono: como MCPs fazem o host usar
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

## Reavaliar

Quando houver um eval de adoção (prompts fixos rodados em `claude -p`, contando chamadas do bridge
vs nativas) para medir antes e depois de cada mudança.
