# Piloto controlado: resultados e melhoria experimental (2026-11-15)

## Estado

**Concluído: 32 tentativas na matriz inicial e 12 no experimento focado, após as correções
de runtime e avaliador descritas abaixo.** O pedido inclui investigar e medir melhorias,
não somente decidir se o produto deve continuar. Este piloto testa uma intervenção concreta:
delegar a tarefa inteira antes de o host explorar seu conteúdo.

O [plano registrado](bench/2026-11-15-quota-plan.json) fixa tarefas, gabaritos, ordem,
repetições, modelo, tolerância de qualidade e redução mínima útil de 15% no indicador
auxiliar de custo equivalente de API. Esse limiar é uma escolha operacional do piloto,
não um limiar estatístico nem conversão em economia de assinatura.

## Condições

1. `habitual-instructions`: instruções globais do usuário, sem Polyagent.
2. `lean`: instruções curtas, sem Polyagent; ferramentas nativas eficientes são permitidas.
3. `bridge`: mesmas instruções curtas, com o servidor Polyagent e escolha livre de ferramentas.
4. `coarse`: mesmo servidor, com instrução para delegar a tarefa inteira antes da exploração
   e depois verificar o resultado com uma checagem nativa dirigida.

Quatro tarefas (localização, saída volumosa, correção de código e diagnóstico), duas
repetições por condição: 32 tentativas planejadas. Host explícito `claude-sonnet-5-5`,
effort `medium`; workers Codex `gpt-6-luna`. Outros engines e caminhos pagos desabilitados.
Modelos/escopo não reproduzem automaticamente o host usado em todas as sessões históricas.

A primeira condição reproduz **somente instruções globais**, não a instalação inteira de
plugins, hooks e MCPs do usuário. Há um snapshot de código real e fixtures Node sintéticas;
não representam a distribuição de tarefas de produção. Não interpretar esse piloto como
prova geral sobre a configuração habitual completa.

## Método e verificações

Implementação: [runner](../bench/quota-eval.mjs), [fixtures](../bench/quota-eval-fixtures.mjs),
[análise](../bench/quota-eval-core.mjs) e [testes](../bench/quota-eval.test.mjs).
Os quatro braços têm a mesma configuração de isolamento por flags; variam as instruções
e a presença do MCP. Os workers mantêm o sandbox obrigatório do bridge.

O host usa `--setting-sources project`, `--strict-mcp-config`, `--disable-slash-commands`,
`CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` e `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. As instruções
de cada braço entram por `--append-system-prompt`. O controle da descoberta de memória
consta na [documentação oficial de variáveis](https://code.claude.com/docs/en/env-vars),
consultada em 2026-11-15. O harness usa os caminhos originais de autenticação para preservar
a renovação. Separadamente, por autorização explícita do usuário, `auth.json` do Codex foi
sincronizado por SSH para a conta `jaime` na note2, com backup anterior e permissões 0600.
Credenciais não integram os dados publicados.

O runner captura uso do host por categoria de tokens, custo reportado, ferramentas,
resultados de workers e handles. Procura os transcripts dos workers para contabilizar
seu uso separadamente. No caso de edição, executa cinco verificações externas de comportamento
(débito normal, zero, saldo exato, negativo e saldo insuficiente), além do JSON final.
Os demais casos comparam campos contra gabarito prefixado, sem juiz LLM.

Falha de worker não pode ser convertida em sucesso da condição `coarse` só porque o host
resolveu a tarefa depois. Erro de infraestrutura interrompe a rodada para inspeção;
tentativa é preservada e não vira observação de eficácia. Erros de qualidade também são
preservados, não excluídos por resultado.

Validação do harness: dez testes passaram, incluindo snapshots de streaming, campos de cache,
resposta incorreta, erro de API, custo ausente e falha de delegação com recuperação pelo host.
Foi observado red antes de implementar os helpers; nenhum comportamento do produto foi alterado.

## Preparação na note2

Conferido em 2026-11-15: SSH como `jaime` funcional, alimentação externa ligada, 55 GB livres,
Claude Code 2.1.323 autenticado via assinatura Team, Codex CLI 0.153.4. Execução serial em
`tmux`, com `MemoryMax=4G` e `CPUQuota=200%` via `systemd-run --user --scope`.

Dois problemas foram encontrados antes de iniciar a rodada válida:

- Um protótipo que isolava também o host em bwrap impediu namespaces aninhados do worker.
  O isolamento do host foi substituído pelas flags acima; o sandbox do worker foi mantido.
- O preflight seguinte chegou ao Codex, mas recebeu **401 / invalid_refresh_token**.
  A execução foi interrompida; não houve loop de tentativas nem troca silenciosa para worker Claude.

A sincronização autorizada resolveu a autenticação. O CLI global 0.153.4 não disponibilizava
Luna nessa conta; uma cópia isolada do CLI local 0.165.0 passou a ser usada no benchmark,
sem substituir a instalação global.

### Correção do runtime e invalidação das primeiras matrizes

A cópia inicial do CLI isolado continha apenas `codex`, omitindo o executável irmão
`codex-code-mode-host`. Um preflight que pedia somente `OK` sem ferramentas passou, mas não
provava execução. Nas primeiras matrizes, os workers relataram bloqueio e os hosts terminaram
as tarefas sozinhos. O avaliador inicial aceitou o resultado final e o handle, o que era
insuficiente para comprovar delegação.

As duas matrizes inteiras foram preservadas separadamente como
[inicial inválida](bench/2026-11-15-quota-invalid-helper-results.jsonl) e
[focada inválida](bench/2026-11-15-quota-focused-invalid-helper-results.jsonl).
Nenhuma integra os resultados válidos. Os campos anteriores e as respostas corretas
recuperadas pelo host não são apresentados como sucesso do worker. Os percentuais de
delegação anunciados durante essas rodadas foram retirados.

O bundle completo foi instalado isoladamente em
`~/.local/share/polyagent-quota/cli-0.165.0/bin`. Um novo preflight exigiu criar e ler um
arquivo real dentro do sandbox, com checagem externa do arquivo; passou. O avaliador passou
a conferir também o JSON do worker contra o gabarito, além da resposta final e da checagem
externa do comportamento. As matrizes completas foram reiniciadas em diretórios novos.

### Correção da contagem de tokens

Foi observado um caso real com 160 tokens de saída nos eventos parciais contra 1.049 no
`result.modelUsage` final. Agora o total final do CLI é a fonte primária; os valores parciais
ficam preservados em `hostTokensFromStream`. Um teste reproduz essa divergência. O custo
usado nas comparações sempre veio de `total_cost_usd` final e não mudou com essa correção.

### Experimento de melhoria, registrado separadamente

O [plano focado](bench/2026-11-15-quota-focused-plan.json) compara controles novos nas
condições `lean`, `coarse` e `slim`, com duas repetições de uma correção pequena e de um lote
transacional maior: 12 tentativas. `slim` é um proxy experimental que expõe só `delegate`,
fixando Codex/modelo/esforço e reaproveitando a execução real do bridge. Não altera defaults.

Na inspeção MCP sem LLM, a superfície completa anunciou 23.833 caracteres de schemas e 1.921
de instruções; a experimental anunciou 462 e 187, respectivamente. São caracteres, não
tokens nem economia demonstrada. O preflight do proxy também completou o round-trip real.
Os controles da rodada focada não são misturados aos da matriz inicial.

Os [sete registros de preparação](bench/2026-11-15-quota-preparation.json) foram preservados
separadamente, com custo reportado agregado do host de **US$ 0,679072 equivalente de API**.
Não é cobrança adicional da assinatura nem custo completo dos processos. Nenhum deles
integra uma comparação válida. A preparação também revelou um bug no avaliador: ele aceitava
a resposta correta após a delegação falhar. O critério foi corrigido e recebeu testes.

Não foi religado Polyagent na configuração habitual do usuário. Os arquivos remotos desta
tarefa estão em `~/scratch/polyagent-quota-20261115/`, separados dos projetos contínuos.

## Reavaliar e buscar economia

As duas matrizes foram concluídas; resultados e limites estão abaixo. A próxima validação
deve partir das melhorias que reduziram custo no piloto: delegação antecipada de implementação,
interface menor e verificação por artefatos. A seleção de ferramentas precisa ser medida por
tipo de tarefa, preservando controles nativos eficientes. Não inferir cota de assinatura
a partir de preços de API.

## Resultados da matriz inicial corrigida

Medido em 2026-11-15. [Dados por tentativa](bench/2026-11-15-quota-results.jsonl),
[resumo calculado](bench/2026-11-15-quota-summary.json). Cada condição tem as mesmas quatro
tarefas com duas repetições. O custo é o `total_cost_usd` final do CLI: **equivalente de API
do host Claude**, não cobrança adicional nem percentual da cota de assinatura.

| Condição | Acertos pelo critério registrado | Custo total, US$ equiv. API | Mediana / máximo, s |
|---|---:|---:|---:|
| Instruções habituais | 8/8 | 0,207376 | 8,30 / 12,38 |
| Contexto enxuto, nativo | 8/8 | 0,153819 | 8,02 / 12,06 |
| Contexto enxuto + Polyagent disponível | 8/8 | 0,200172 | 8,39 / 12,40 |
| Contexto enxuto + delegação inteira antecipada | 8/8 | 0,174431 | 20,04 / 29,67 |

- Enxugar o contexto reduziu o proxy de custo em **25,8%** contra as instruções habituais.
  Nas duas repetições agregadas separadamente, a redução foi 28,7% e 23,0%.
- Disponibilizar o MCP aumentou o total em **30,1%** contra o controle enxuto. Nessas oito
  tentativas o host continuou usando ferramentas nativas; não houve worker nessa condição.
- Forçar delegação em todo tipo de tarefa aumentou o total em **13,4%** contra o controle enxuto.
- Na tarefa de implementação pequena, antecipar a delegação reduziu o custo em **30,8%**:
  US$ 0,052759 → US$ 0,036484, somando as duas repetições. As reduções individuais foram
  35,3% e 26,1%; ambas passaram na verificação externa do comportamento.

| Tarefa | Variação da delegação antecipada contra nativo enxuto |
|---|---:|
| Localização | +25,2% |
| Saída volumosa | −1,5% |
| Implementação pequena | −30,8% |
| Diagnóstico pequeno | +97,4% |

O resultado de saída volumosa variou entre as repetições e não sustenta uma preferência.
O controle pôde usar filtros determinísticos eficientes. A matriz mostra por que adoção
de ferramentas e economia por tarefa precisam ser avaliadas separadamente.

## Resultados do experimento focado corrigido

[Dados por tentativa](bench/2026-11-15-quota-focused-results.jsonl), mesmos modelos e
gabaritos, controles novos nesta etapa. Cada condição tem duas tarefas de implementação,
com duas repetições. A implementação maior aplica transferências sequenciais com rollback,
validação de valores/contas/IDs e conservação dos saldos.

| Condição | Acertos pelo critério registrado | Custo total, US$ equiv. API | Mediana / máximo, s |
|---|---:|---:|---:|
| Nativo enxuto | 4/4 | 0,163698 | 16,61 / 22,54 |
| Interface completa + delegação antecipada | 4/4 | 0,096242 | 45,55 / 55,53 |
| Interface menor + delegação antecipada | 0/4¹ | 0,064910 | 43,66 / 55,94 |

A interface completa, já existente no produto, reduziu o proxy de custo em **41,2%**
no conjunto focado, com quatro acertos pelo critério registrado. Por tarefa:

- Correção pequena: **−27,0%** (US$ 0,052214 → US$ 0,038110).
- Lote transacional: **−47,9%** (US$ 0,111484 → US$ 0,058132).

O tempo aumentou: a mediana do conjunto passou de 16,61 s para 45,55 s. A redução de
consumo Claude tem um custo de latência e transfere trabalho para a assinatura Codex.

¹ Nos quatro casos `slim`, a resposta final do host e o comportamento do aplicativo estavam
corretos, mas o worker respondeu em prosa em vez do JSON intermediário exigido pelo avaliador
corrigido. O critério registrado foi mantido: são **0/4**, e o protótipo não satisfaz a
tolerância zero definida para esse critério. `delegate` no produto normalmente retorna texto
livre; esse desvio é do contrato específico do experimento e não prova defeito funcional do produto.

Uma [auditoria funcional posterior](bench/2026-11-15-quota-functional-audit.json), declarada
como pós-hoc, reexecutou os gabaritos de comportamento e verificou o JSON final: **12/12**
casos funcionais passaram na etapa focada, incluindo os quatro `slim`. Também preservou
os comandos do host após a delegação: nos quatro casos `slim` eles apenas leram arquivos e
executaram testes, sem reimplementar a mudança. Essa revisão não substitui a aceitação registrada.

Os custos brutos do protótipo menor foram 46,1% inferiores ao nativo na correção pequena
e 67,0% inferiores no lote maior; todos os custos das tentativas, inclusive as quatro
reprovadas por formato, estão incluídos. São indícios de melhoria da interface, com resultado
funcional favorável e requisito experimental de formato pendente; não uma validação concluída
para alterar o default do produto.

## Consumo deslocado e rastreabilidade

As duas matrizes corrigidas registraram **16 workers Codex**, com uso recuperado em **16/16**;
nenhum worker Claude foi usado. O custo reportado dos hosts Claude nas 44 tentativas soma
**US$ 1,0606473 equivalente de API**. Não inclui um preço em dólares para o Codex: ele foi
usado pela assinatura e seu consumo aparece separado:

- `input_tokens`: 1.418.157, dos quais 1.296.256 em `cached_input_tokens`.
- `output_tokens`: 15.013, dos quais 1.056 em `reasoning_output_tokens`.
- `total_tokens`: 1.433.170.

Cache e raciocínio são subconjuntos dos campos Codex acima, não parcelas para somar novamente.
As configurações reais de engine/modelo/effort e os comandos de verificação constam na
auditoria funcional. Os campos de cache Claude e as saídas finais estão nos JSONL por tentativa.
Os [schemas completos](bench/2026-11-15-quota-schema.json) e
[schemas menores](bench/2026-11-15-quota-slim-schema.json) também estão preservados.

O resumo pode ser recalculado a partir dos JSONL: somar `costUsd` por condição dentro de
cada etapa; para diferenças pareadas usar a mesma chave `(task, rep)` e não excluir falhas.
`pairedSummary` em `bench/quota-eval-core.mjs` implementa essa comparação. Custos com denominador
zero de aceitação registrada, como `slim`, não têm custo por tarefa aceita definido.

Na raiz deste checkout, este comando confere o avaliador e recalcula as comparações sem
chamar modelos nem consumir cota:

```bash
npm test -- bench/quota-eval.test.mjs && node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
import {pairedSummary} from './bench/quota-eval-core.mjs';
for (const [file,pairs] of [
  ['2026-11-15-quota-results.jsonl',[['habitual-instructions','lean'],['lean','bridge'],['lean','coarse']]],
  ['2026-11-15-quota-focused-results.jsonl',[['lean','coarse'],['lean','slim']]],
]) {
  const rows=readFileSync(`research/bench/${file}`,'utf8').trim().split('\n').map(JSON.parse);
  for (const [before,after] of pairs) console.log({file,before,after,...pairedSummary(rows,before,after)});
}
JS
```

Para repetir as chamadas, o runner precisa ser copiado para um diretório descartável com
`bench/quota-*.mjs`, o snapshot em `src/`, `runtime/dist/`, `runtime/node_modules/` e um link
`node_modules` para as dependências do runtime. `habitual-instructions.txt` é a cópia privada
das instruções usadas no primeiro braço; só seu hash e tamanho são publicados. Esse braço
não é externamente reproduzível com as mesmas instruções sem o arquivo privado. Os braços
enxutos e todos os gabaritos estão no código publicado.

Definir `QUOTA_CODEX_BIN` para o executável do bundle **completo**, incluindo o irmão
`codex-code-mode-host`. O comando `node bench/quota-eval.mjs run` executa a matriz inicial;
`QUOTA_FOCUSED=1 node bench/quota-eval.mjs run` executa a focada. Aplicar os limites de
recursos e isolamento registrados no plano; usar diretório novo para outra amostra.
Os comandos `summarize` analisam o diretório correspondente sem chamadas de modelo.

Ao concluir, foram removidos os 109 MB de `runtime/node_modules` descartáveis na note2.
Os registros privados e snapshots somam 8,9 MB em `~/scratch/polyagent-quota-20261115/`;
o bundle CLI isolado de 369 MB foi preservado em `~/.local/share/polyagent-quota/cli-0.165.0/`.
Repetir a execução exige restaurar as dependências; recalcular os JSONL com o comando acima
não exige esse runtime. A autenticação sincronizada foi preservada.

## Limites e decisão após os resultados

São duas repetições por tarefa/condição, com contextos curtos e fixtures em grande parte
sintéticas. Não há inferência estatística de generalização, medição de sessões longas nem
ensaio representativo de toda a carga de trabalho do usuário. O host foi Sonnet 5.5 medium;
não extrapolar os percentuais para outros modelos ou esforços.

O cache não foi apagado nem fixado como frio. As preparações e matrizes invalidadas aqueceram
prefixos; nomes de diretórios de trabalho foram reutilizados após arquivar seu conteúdo.
Os resultados corrigidos representam esse ambiente com cache previamente utilizado.
Os campos por categoria permitem conferir esse efeito, mas não eliminam o limite.

Não houve observação atribuível do consumo da cota real, e outras sessões do usuário não
foram impedidas de usar a assinatura. Os percentuais acima são do indicador de API do CLI.
Também não autorizam apagar instruções globais de segurança e processo: o braço enxuto
foi adequado às fixtures; sua equivalência fora desse escopo não foi avaliada.

**Há evidência local para continuar melhorando o Polyagent com foco em delegação seletiva
de implementação.** Priorizar a passagem da tarefa inteira antes de o host ler/editar,
manter ferramentas nativas eficientes para tarefas pequenas e medir uma superfície menor
com verificação funcional na fronteira do worker. O protótipo e os prompts são experimentais;
o servidor, os modelos default e a configuração habitual do usuário não foram alterados.

O próximo estudo deve corrigir a dependência do formato intermediário com uma verificação
de artefato antes de o host retomar, preservar gabaritos independentes e incluir tarefas
reais maiores e sessões longas. A documentação pública pode citar as reduções do proxy
nas implementações testadas, com os denominadores e limites acima; economia da cota real
continua sendo uma hipótese a medir diretamente.
