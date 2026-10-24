# Bloquear a primeira edição não faz o host delegar (2026-10-23)

**Resultado negativo — não aplicado.** A mudança ficou guardada em
[`2026-10-23-edit-redirect.patch`](2026-10-23-edit-redirect.patch) (`git apply` na raiz) e não foi
mergeada.

## Contexto

O [eval de adoção de 2026-09-30](2026-09-30-adoption-handoff.md) mostrou que, em prompts de
implementação, o host lê e edita os arquivos sozinho e chama o `delegate` só no fim, ou nunca. No
mesmo eval, negar uma vez o `grep` no `Bash` levou localizar código de 0/3 a 3/3. A hipótese testada:
o mesmo mecanismo na primeira `Edit`/`Write`/`MultiEdit` da sessão empurraria a implementação para o
`delegate`.

## O que foi testado

No modo `redirect` do hook, a primeira `Edit`/`Write`/`MultiEdit` da sessão com `file_path` dentro do
`cwd` recebia deny uma vez (fail-open, chave de dedup `edit-delegate`), com o texto: implementação
autocontida vai para `delegate`/`fast_delegate`; "if this is a quick one-off edit you are already
positioned for, retry and it will be allowed". Fora do `cwd` ficava só o aviso (o worker não alcança
esses caminhos). A suíte passou (560/560) antes da medição.

## Como rodou

`node bench/adoption-eval.mjs edit-r1`, os mesmos 18 prompts, host `claude-opus-5-5` effort `medium`,
numa worktree limpa do `master`, com o `~/.claude/settings.json` apontando temporariamente para o hook
da branch. Custo reportado: $14,15 (16/18). Bruto:
[`bench/2026-10-23-adoption.jsonl`](bench/2026-10-23-adoption.jsonl). Comparado com `hook-r1`
(2026-09-30), a rodada do hook que só bloqueia o `grep`.

## Resultado — 12/18, contra 14/18

| Prompt | hook-r1 | edit-r1 | O que o host fez em edit-r1 |
|---|---|---|---|
| `impl-test` | acerto | **falha** (timeout) | levou o deny, repetiu a `Edit` e seguiu sozinho |
| `impl-rename` | acerto | **falha** (timeout) | só `Bash` (provável `sed`), que o deny de edição não cobre |
| `impl-feature` | acerto | acerto | editou sozinho e chamou `delegate` no fim |
| `h-impl-flag` | falha | acerto | 5 `Edit` sozinho e só depois `delegate` |
| `h-design-choice` | acerto | falha | `Bash`/`read_slice` sem `fan_out` (não usa edição: variação) |
| handoff (2) | 0/2 | 0/2 | `Agent`/`Skill` nativos |
| demais 10 | 9/10 | 9/10 | igual (`web` segue por `npm view`) |

Implementação 3/4 → 2/4. Nenhum prompt passou a **começar** pelo `delegate`: nos dois acertos o
`delegate` veio depois de o host já ter editado.

## Leitura

- O texto do deny oferece a saída ("retry and it will be allowed") e o host a usa. No `grep` o deny
  funcionou porque o `explore` faz a mesma tarefa na hora; na edição o host já leu os arquivos e
  repetir é mais barato para ele que reescrever a tarefa como prompt de worker.
- O `sed`/heredoc no `Bash` escapa de qualquer regra sobre `Edit`/`Write`.
- O custo para o usuário é real: toda sessão perde a primeira edição. Sem ganho medido, não compensa.
- n = 1 rodada por condição: a queda de 14 para 12 pode ser variação; a ausência de melhora não é.

## Reavaliar

- Texto do deny sem convite a repetir (ainda fail-open), medido de novo — só se houver outra razão
  para acreditar que o host desistiria de repetir.
- Atacar o momento anterior à edição (quando o host decide como fazer a tarefa), não a edição em si:
  por exemplo, `UserPromptSubmit` reconhecendo pedido de implementação.
- Nunca medido aqui: bloquear a edição **sem** fail-open. Quebraria edições legítimas; não testar
  sem desenho próprio.
