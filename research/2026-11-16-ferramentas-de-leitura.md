# Ferramentas de leitura: `explore`, `read_slice`, `run_filtered`, `web_lookup` (2026-11-16)

Status: **estudo, nada aplicado.** Nenhuma linha de `src/` mudou.

Pergunta: as quatro tools de leitura valem a pena? O host as usa, elas economizam contexto/cota
frente a Read/Grep/Bash/WebSearch, a qualidade é boa, e quanto custam em tempo?

**Resposta curta:** a economia de cota **não está demonstrada** para nenhuma das quatro. O que está
medido é adoção, tamanho do que volta ao contexto, latência e nota de qualidade. `web_lookup` e
`explore` têm o caso mais plausível; `read_slice` e `run_filtered` têm o mais fraco.

## O que é medido e o que é estimado

| Dado | Fonte | Status |
|---|---|---|
| Chamadas, chars devolvidos, engine, latência | `~/.claude/polyagent-usage.jsonl` (5.864 linhas, 03/07 a 04/11/2026, 5.788 únicas) | **medido** |
| Nota de qualidade (1–5) | 319 `rate`, ligados à última chamada da mesma sessão | **medido**, amostra pequena (n por tool abaixo) |
| Custo do host em tarefas pareadas | [auditoria histórica](2026-11-15-auditoria-historica.md): 5 pares, 1 execução cada | **medido, fraco** (n=3 para leitura) |
| Cota gasta pelo worker (Codex/Claude) | não existe por chamada | **não medido** |
| Custo do mesmo trabalho com ferramenta nativa | não existe | **não medido** |
| Tokens ≈ chars/4 | conversão aproximada | **estimado** |

O log para em 04/11/2026 (a auditoria registra a última chamada nessa data, sem provar o desligamento).
Contagens desde 14/09 (499/242/89/354) ficam próximas das da auditoria (505/232/85/312), mas não
idênticas: a auditoria deduplica entre cópias do log e usa outra janela. Antes de 23/09 o log só tem
`ts`, `tool` e `outChars`: sem engine nem latência. Engine, latência e nota abaixo valem desde então.
Agregados reproduzíveis: [`bench/leitura-agregados.mjs`](../bench/leitura-agregados.mjs) gera
[`bench/2026-11-16-leitura-agregados.json`](bench/2026-11-16-leitura-agregados.json) (com contagem de
linhas e sha256 do log); teste em `bench/leitura-agregados.test.mjs`.

## Números por ferramenta

Chars devolvidos ao contexto do host (`outChars`), latência de parede do worker e nota.

| Tool | Chamadas (único, total do log) | Chars por chamada (mediana / p90) | ≈ tokens por chamada | Latência (mediana / p90) | Nota média (n) |
|---|---:|---|---:|---|---|
| `explore` | 1.373 | 3.197 / 8.345 | ~800 | 48,7 s / 136,9 s | 4,83 (24) |
| `read_slice` | 1.116 (+32 recusas por pedir arquivo inteiro) | 4.037 / 15.270 | ~1.000 | 23,5 s / 69,1 s | 4,67 (15) |
| `run_filtered` | 309 | 353 / 1.295 | ~90 | 20,8 s / 56,7 s | 4,17 (6) |
| `web_lookup` | 525 | 2.588 / 6.012 | ~650 | 39,7 s / 90,2 s | 4,21 (70) |

Latência: só as 930 linhas das quatro tools com `durationMs` (de 23/09 em diante). Uma busca com `Grep` nativo
leva milissegundos; a menor mediana aqui é 20 s.

**Quem executou** (linhas com engine registrado): `explore` 348 Codex Luna, 42 Claude, 6 OpenCode;
`web_lookup` 224 Codex, 54 Claude, 46 Grok; `read_slice` 121 Codex, 22 Claude; `run_filtered` 50 Codex.
Quando a cascata cai no Claude (11% a 17% das chamadas de `explore`/`web_lookup`), o worker gasta a
**mesma assinatura Claude do host**. Em `explore`, Haiku 5.5 foi 1,8× mais lento que Luna
(83 s contra 47 s; o alias `haiku` antigo, 99 s). Em `read_slice` o Haiku 5.5 foi mais rápido
(16 s contra 23 s, n=11). As 46 chamadas de `web_lookup` com engine `grok` e modelo `gpt-6-luna` (mediana
83,6 s) são uma combinação estranha no log; não investigada.

## Adoção (o host usa?)

Chamadas por mês, únicas:

| Tool | jul | ago | set | out | nov (até 04) |
|---|---:|---:|---:|---:|---:|
| `explore` | 260 | 538 | 242 | 317 | 16 |
| `read_slice` | 282 | 477 | 255 | 91 | 11 |
| `run_filtered` | 118 | 96 | 62 | 33 | 0 |
| `web_lookup` | 54 | 93 | 88 | 272 | 18 |

- `explore` e `web_lookup` são usadas de forma estável ou crescente. `web_lookup` triplicou em
  outubro. O hook em `redirect` (padrão) nega `WebSearch`/`WebFetch`; **parte desse uso pode ser
  induzida por ele, não escolha do host** (não separei as duas causas). O hook agora está em `nudge` (PR de nudge): o
  volume deve cair, e isso diz qual era o uso espontâneo.
- `read_slice` e `run_filtered` caem mês a mês. Mesmo com o hook, o host prefere `Read` com
  `offset`/`limit` e `Bash` com `| tail`.
- O estudo de adoção ([2026-09-30](2026-09-30-adoption-handoff.md)) mostrou que sem hook o host
  localiza código com `grep` em 0/2 casos; com redirect, 3/3. Ou seja, adoção de localização
  depende do hook.

## Economiza contexto/cota?

**Contexto do host.** O que volta ao contexto é pequeno: ~90 tokens (`run_filtered`) a ~1.000
(`read_slice`) por chamada. Mas a comparação certa é com a alternativa nativa disciplinada, que não
foi medida:

- `read_slice` devolve **as próprias linhas pedidas** (invariante do projeto). `Read` com
  `offset`/`limit` devolve o mesmo texto, sem 23 s de espera. O worker só poupa o host de achar o
  trecho; para isso `Grep -n` + `Read` resolve em dois passos baratos. Ganho de contexto: perto de zero.
- `run_filtered` devolve ~350 chars. `cmd | tail -20` devolve algo de tamanho parecido. O ganho
  existe quando o host não sabe onde está o resumo na saída; ele é pequeno em termos absolutos.
- `explore` devolve ~800 tokens de localização que, nativamente, custariam várias idas de
  `Grep`/`Read` com resultados parciais no contexto. É onde o ganho de contexto é mais plausível,
  e o único par pago com leitura direta (`locate`) deu **+44,9%** no custo do host, 1 execução.
- `web_lookup` troca páginas e snippets no contexto por ~650 tokens de resposta. Plausível, não medido.

**Cota.** Quando o worker é Codex (maioria), a leitura sai da assinatura Codex em vez da Claude:
esse é o benefício real, e o único que as quatro têm em comum. Ele **não foi medido**. Contra: cada
chamada soma custo de turno do host (descrever a tarefa + ler a resposta + eventual releitura
nativa para editar), e as chamadas que caem no Claude gastam a mesma cota. Dos 154 workers
Claude recuperados na auditoria: 286 M tokens de leitura de cache, 10,8 M de criação, 2,4 M de saída
(histórico inteiro, **não atribuível** a estas quatro tools).

**Dado pareado existente** (auditoria, 30/09, host Opus 5.5 medium, 1 execução por lado), tarefas em
que a ferramenta de leitura entrou: `locate` +44,9%, `h-find` +7,8%, `read` −22,8%. n=3, sem
controle de qualidade nem de cache. Não concluir nada além de "sem sinal claro de economia".

## Qualidade

- `explore` 4,83 (n=24, 20 notas 5, nenhuma abaixo de 4); `read_slice` 4,67 (n=15; uma nota 2:
  devolveu só a assinatura, sem o corpo); `run_filtered` 4,17 (n=6; uma nota 1: o worker rodou sem o
  diretório temporário e relatou como falhas todos os `rc=1`); `web_lookup` 4,21 (n=70; duas notas 2).
- Falhas de `web_lookup` são erros de fato: preço errado do Opus 5 (US$ 3,90/19,50 contra 5/25
  oficial), página que existia dada como inexistente, leitura errada de "cents per $1 of API".
  Mesmo tipo de erro que `WebSearch` nativo comete, mas aqui o host não vê a fonte; a nota do
  worker é o único filtro.
- Só 24/499, 15/242, 6/89, 70/354 chamadas (desde 14/09) têm nota. Viés provável: nota é dada em
  chamadas que o dono olhou.
- Os benches de 23/09 ([aux-bench](2026-09-23-aux-tools-bench.md)): 8/8 de acerto de Luna medium em
  tarefa pequena do próprio repo, mediana 10,8 s, pior caso 13,1 s. Em produção a mediana é 1,8× a 4,4×
  maior (tarefas reais, repos grandes), e o p90 passa de 1 minuto em três das quatro tools
  (`run_filtered` fica em 57 s).

## Recomendação por ferramenta

| Tool | Veredito | Motivo |
|---|---|---|
| `explore` | **Manter** | Única com ganho de contexto plausível (várias leituras viram ~800 tokens), nota 4,83, uso estável. Latência mediana de 49 s: não usar para achar um símbolo único (`Grep` resolve). Registrar que, no Claude, ela gasta a cota do host. |
| `web_lookup` | **Manter, com ressalva de verificação** | Tira a busca da assinatura Claude (Codex tem web search), resposta curta, nota 4,21 em n=70. Erros de fato existem: número citado (preço, limite) deve ser conferido na fonte antes de virar decisão. Reavaliar o volume depois do hook em `nudge`. |
| `read_slice` | **Mudar (rebaixar)** | Devolve as mesmas linhas que `Read` com `offset`/`limit`, com 23 s de espera; adoção caiu de 477 (ago) para 91 (out). Sugestão: tirar o `alwaysLoad` e o redirect do `Read` grande, deixá-la como opção para arquivo enorme. Remover se, após rebaixar, o uso ficar abaixo de ~1 por dia. |
| `run_filtered` | **Manter sem promover** | Custo baixo, saída de ~90 tokens, mas a alternativa `| tail` entrega algo equivalente e o uso caiu (118 para 33 por mês). O caso de uso real é build/teste com saída enorme e sem formato conhecido. Amostra de qualidade (n=6) não sustenta mais que isso. |

Nada disso exige código agora. Se o Jaime quiser aplicar `read_slice`: é edição de `src/index.ts` (metadata
`alwaysLoad`) e do hook (`hooks/prefer-polyagent.mjs`, redirect do Read grande), com ajuste em
`test/tools.test.ts` e `test/hook.test.ts`.

## Limites

- Economia de cota **não demonstrada**; as conversões em tokens são estimadas (chars/4).
- Notas cobrem 5% a 20% das chamadas (4,8% a 19,8% desde 14/09) e vêm do próprio dono; podem inflar.
- O log mistura períodos com modelos e hooks diferentes (cursor/Grok em jul–set, Luna depois).
- O volume de `web_lookup` em outubro está contaminado pelo hook em `redirect`.
- Não foi possível medir o tamanho bruto de saída de teste: `heavy-run` estava ocupado por outra
  sessão; a comparação `run_filtered` contra `| tail` ficou por fazer.

## Reavaliar

1. Após 2 semanas com hook em `nudge`: refazer a tabela de adoção; o uso que sobrar é escolha do host.
2. Rodar o protocolo controlado de [economia de cota](2026-11-15-evidencia-economia-cota.md) nas
   quatro tools: mesma tarefa de leitura com e sem Polyagent, custo do host + do worker separados.
3. Medir a cota real do Codex por chamada de `explore`/`web_lookup` (hoje é uma suposição de que
   sai da assinatura Codex).
4. Se `read_slice` for rebaixada: revisar em 30 dias; remover se o uso não passar do limiar acima.
5. Se `web_lookup` com notas 1–2 passar de ~5% em n ≥ 100: escalar para `claude` com web search
   nativo na cascata, ou exigir URL de fonte em cada afirmação numérica.

## Conferência

Cada número deste estudo foi conferido contra o JSON gerado pelo script em 2026-11-16
(log com 5.864 linhas válidas, 0 malformadas, 5.788 únicas; sha256
`218722bbc31b55627319f0e09966610aca126698252d3195afec5b5cc6ec81cb`).

**Bateram** (sem alteração): chamadas totais por tool; chamadas por mês das quatro tools; mediana e
p90 de `outChars` e de latência; notas (média, n e distribuição, incluindo as notas 1 e 2);
contagem por engine de `explore`, `web_lookup`, `read_slice` e `run_filtered`; medianas por
engine/modelo (Luna 47 s, Haiku 5.5 83 s, Grok 83,6 s); tokens estimados por chars/4; o início e o
fim do log.

**Divergiram e foram corrigidos (8):**

1. "2.479 linhas com `durationMs`" era o total de **todas** as tools; nas quatro são 930.
2. A latência começa em 23/09, não em 14/09 (idem engine). O texto dizia 14/09.
3. "Contagens batem com a auditoria" era falso: 499/242/89/354 contra 505/232/85/312.
4. "Haiku 2× a 4× mais lento que Luna em `explore`": são 1,8× (Haiku 5.5) a 2,1× (alias `haiku`); em
   `read_slice` o Haiku 5.5 foi mais rápido.
5. "Mediana em produção 2× a 4× o bench": são 1,8× a 4,4×.
6. "p90 passa de 1 minuto": só em três das quatro tools (`run_filtered` tem 57 s).
7. "Notas cobrem 3% a 20%": o menor valor é 4,8%, logo 5% a 20%.
8. Contagem de notas desde 14/09 (24/499 etc.) passou a vir do JSON (`chamadasDesde14Set`).

**Não conferido neste script** (vêm de outros arquivos): os 154 workers Claude e os tokens de cache
(auditoria de 15/11), os pares de custo do host, o bench de 23/09 e o texto das notas citadas
(lido direto do log, fora do script).
