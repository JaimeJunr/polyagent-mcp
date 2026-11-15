# Auditoria histórica de uso e consumo (2026-11-15)

## Resultado e decisão

**Os registros históricos disponíveis não demonstram economia de cota Claude.** No recorte
mais próximo de uma comparação por tarefa, cinco tarefas que passaram de ferramentas nativas
para Polyagent tiveram aumento agregado de **10,1% no custo equivalente de API reportado pelo
host**. Uma das cinco ficou mais barata. Não é uma medição da assinatura nem um ensaio controlado.

Foi possível recuperar registros de workers Claude, mas os benchmarks não guardam os vínculos
necessários para somá-los com segurança a cada um desses pares. Portanto, não há percentual
confiável de economia ou aumento do consumo completo por tarefa.

Decisão: manter a economia como hipótese não demonstrada e seguir o
[protocolo controlado](2026-11-15-evidencia-economia-cota.md), sem promover adoção a prova de eficácia.
Nenhum agente, build, teste do produto ou benchmark pago foi executado nesta auditoria.

## Fontes e método

Conferido em 2026-11-15, por leitura dos arquivos locais:

- Transcripts em `~/.claude/projects/**/*.jsonl`; inventário inicial: 4.784 arquivos principais
  (7,132 GB) e 2.054 arquivos de subagentes (1,338 GB). O inventário é um snapshot, não log imutável.
- `~/.claude/polyagent-usage.jsonl`: 5.864 registros, de julho a novembro; formatos antigos
  omitem engine/session e o formato atual não contém tokens. Inclui outros hosts, logo não é
  um denominador exclusivo do Claude Code.
- [Bench de adoção de setembro](bench/2026-09-30-adoption.jsonl), condições `after-r2` e `hook-r1`.
- Análise anterior em `~/.claude/polyagent-test-20261104/{medir.py,baseline.txt}`: preservada,
  não executada nem alterada. Não foi executado o script de restauração; Polyagent não foi religado.

Os [dados derivados saneados](bench/2026-11-15-historical-audit.json) contêm contagens,
tokens agregados e os pares do benchmark público do repo. Não contêm prompts, respostas,
identificadores de sessões privadas nem credenciais.

### Localizar uso efetivo

O filtro inicial foi `rg -l '"name":\s*"mcp__polyagent[^" ]*"'` nos JSONL locais. Ele também
encontra definições em attachments e não conta como prova de chamada. Dos 1.773 arquivos
principais candidatos, somente 465 continham eventos `type=assistant` com blocos
`message.content[].type=tool_use` cujo nome contém `polyagent`.

Históricos copiados/reabertos aparecem em mais de um arquivo. Para contagem de chamadas,
deduplicar globalmente por `tool_use.id`, usando o UUID do evento como fallback se necessário.
Não chamar os 465 arquivos de 465 sessões independentes. O filtro por nome cobre o alias
`mcp__polyagent__*` encontrado no ambiente, não garante localizar aliases antigos diferentes.

### Vincular workers Claude

Para cada chamada identificada, procurar blocos `tool_result` com o mesmo `tool_use_id`.
Extrair somente handles `engine:id` após `session_id` no resultado; procurar transcripts
cujo nome-base seja o ID Claude. Não usar simples menção a um ID em texto de outra ferramenta.

Nos transcripts encontrados, ler eventos assistant com `message.usage`. Deduplicar por
`(model, message.id)` e tomar o máximo observado de cada campo de tokens quando a mensagem
se repete. Isso evita somar snapshots parciais de streaming e cópias como novas mensagens.
Esse procedimento mede o uso registrado; não recupera mensagens ausentes nem raciocínio
não exposto pela API. Não somar categorias de cache como se fossem entrada nova.

## Período de uso encontrado

2.224 chamadas únicas entre **14/09/2026 e 04/11/2026**; última registrada em
04/11 às 20:01 no horário de São Paulo (23:01 UTC). Não equivale a provar a hora exata
do desligamento em todos os hosts.

| Tool | Chamadas únicas |
|---|---:|
| delegate | 607 |
| explore | 505 |
| web_lookup | 312 |
| rate | 289 |
| read_slice | 232 |
| follow_up | 127 |
| run_filtered | 85 |
| fan_out | 36 |
| fast_delegate | 23 |
| bridge_stats | 5 |
| generate_image | 2 |
| decide | 1 |

As contagens incluem avaliações e consultas de estatísticas; não são 2.224 tarefas concluídas.
Os números mensais no JSON usam UTC e não devem ser interpretados como volume mensal de trabalho.

## Comparação de tarefas iguais já existentes

`after-r2` e `hook-r1`, ambas em 30/09/2026, têm 18 IDs de tarefa em comum. O
[estudo original](2026-09-30-adoption-handoff.md) registra o mesmo host Opus 5.5 medium.
Ambas permitem Polyagent: a mudança é o hook de roteamento, não ativar/desativar o servidor.

Há custo reportado nos dois lados em **14/18 pares**. Os outros quatro têm pelo menos um
timeout e custo ausente; permanecem declarados no denominador, não são custo zero.
Nos 14 completos, o custo reportado soma US$ 10,5730 antes e US$ 10,8828 depois (**+2,9%**).

Nos cinco pares abaixo, `bridge` passou de zero para maior que zero. É uma seleção
retrospectiva para investigar o mecanismo; não um grupo de teste definido antes da medição.

| ID da tarefa | Host antes, US$ equiv. API | Host depois, US$ equiv. API | Variação |
|---|---:|---:|---:|
| h-find | 0,6212 | 0,6696 | +7,8% |
| impl-rename | 0,6499 | 0,7865 | +21,0% |
| impl-test | 0,7139 | 0,7908 | +10,8% |
| locate | 0,6152 | 0,8911 | +44,9% |
| read | 0,8327 | 0,6426 | −22,8% |
| **Soma** | **3,4330** | **3,7807** | **+10,1%** |

Reprodução do cálculo a partir do JSON derivado:

```bash
python3 - <<'PY'
import json
from pathlib import Path
root = Path('/mnt/xs1000/me/polyagent-mcp')
audit = json.loads((root / 'research/bench/2026-11-15-historical-audit.json').read_text())
pairs = audit['paired_benchmark']['pairs_with_cost_on_both_sides']
selected = [p for p in pairs if p['before_bridge'] == 0 and p['after_bridge'] > 0]
before = sum(p['before_host_api_equivalent_usd'] for p in selected)
after = sum(p['after_host_api_equivalent_usd'] for p in selected)
print(f'pares={len(selected)}; antes={before:.7f}; depois={after:.7f}; variação={(after / before - 1) * 100:.3f}%')
PY
```

Limites: uma execução por condição, cache/ambiente não controlados para este objetivo,
qualidade final não julgada por gabarito independente e custos externos ausentes. O `hit`
original mede a escolha da tool, não a conclusão correta da tarefa. Não concluir que Polyagent
causou +10,1% de gasto nem que sempre aumenta consumo.

## Consumo recuperável de workers Claude

1.488 chamadas têm handles de workers recuperáveis. São 1.089 handles Codex, 164 Claude,
127 Grok e 20 OpenCode únicos; um mesmo worker pode atender várias chamadas/follow-ups.
Foram encontrados transcripts de **154/164 workers Claude**; dez não foram localizados.

Nesses 154 arquivos, após deduplicação, há:

| Campo | Tokens registrados |
|---|---:|
| Entrada nova | 7.836 |
| Criação de cache | 10.790.717 |
| Leitura de cache | 286.289.645 |
| Saída | 2.403.708 |

São 2.746 mensagens assistant com uso. O JSON discrimina por modelo; inclui Opus, Haiku,
Sonnet e Fable. Logo, parte da execução delegada continua sendo feita por modelos Claude.

**Esse total não é consumo adicional atribuível aos cinco pares acima.** Abrange o histórico
inteiro recuperado dos workers vinculados, inclusive possíveis continuações. Não limita cada
sessão à janela exata de uma chamada e não inclui subagentes nativos desses workers. Os
registros não provam o pool de autenticação/cota usado por cada execução. Não converter
esses tokens em cobrança ou cota sem verificar essas condições.

## Por que a comparação semanal anterior não resolve

O script local anterior usa preços fixos por família como proxy de API e compara semanas,
não tarefas equivalentes. Ao inspecioná-lo, há ainda limitações a corrigir antes de reutilizar:

- Prompts humanos não são deduplicados globalmente entre históricos copiados.
- A classificação de prompt é heurística e pode incluir mensagens de automação ou excluir texto legítimo.
- Uso assistant mantém a primeira ocorrência do ID, sem reconciliar snapshots posteriores.
- Sessões de workers principais podem entrar no denominador como se fossem sessões humanas.
- Não separa projetos/tipos de tarefa nem garante comparabilidade de qualidade, modelo ou cache.

Por isso, os números de custo por prompt da análise anterior não são adotados como prova
de economia, neutralidade ou regressão. Remover ruído da medição é necessário antes de
comparar o período ligado ao desligado.

## Reavaliar

O histórico permite localizar o período e investigar mecanismos, mas não completar uma
comparação confiável de cota por tarefa aceita. Para fechar essa lacuna, executar o protocolo
controlado com vínculo entre tarefa, host e todos os workers, qualidade verificável e registro
separado de cache. Até lá, apresentar este resultado como **auditoria descritiva sem economia demonstrada**.
