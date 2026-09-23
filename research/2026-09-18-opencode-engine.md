# Spike — engine `opencode`: estado persistente e resume

Data: 2026-09-14 · Status: **validado no host dentro do bwrap**.

Este doc registra fatos coletados pelo dono do projeto em execução real no host. O ambiente do
agente não permite rodar bwrap aninhado; os resultados abaixo não são execuções locais do agente.

## O que JÁ FUNCIONA (não precisa ser redescoberto)

### Formato de saída (captura real, campos abreviados)

O `--format json` emite eventos JSONL neste envelope. As reticências abaixo representam campos
omitidos na captura fornecida, não JSON literal para uma fixture:

```text
{"type":"step_start","timestamp":...,"sessionID":"ses_f5daaef...","part":{...,"type":"step-start"}}
{"type":"text","timestamp":...,"sessionID":"ses_f5daaef...","part":{"id":"prt_...","messageID":"msg_...","sessionID":"ses_...","type":"text","text":"PONG","time":{...}}}
{"type":"step_finish",...,"part":{...,"tokens":{...},"cost":0}}
```

`part.text` e `sessionID` são os campos certos. O parser já acertava esse formato; os eventos
`step_start` e `step_finish` cercam o evento `text` e não devem virar texto de resposta.

### Resume fora do sandbox

`opencode run ... -s <id>` devolveu o **mesmo sessionID** e lembrou o segredo **BANANA**.
O dialeto `-s` está confirmado. Isso ainda não comprova resume dentro do sandbox corrigido.

## A falha observada dentro do sandbox

Antes de executar a tarefa, o bridge falhou com exitCode 1:

```text
Unknown: FileSystem.open (/home/jaime/.local/share/opencode/log/opencode.log)
```

Bindar somente `auth.json` não basta: logs e store de sessão também precisam estar acessíveis e
graváveis. A captura prova a falha no log; não houve nessa execução uma retomada silenciosamente vazia.

## Layout real no host (confirmado por ls)

- `~/.opencode/`: somente `bin/`, `node_modules/`, `package.json`, `bun.lock` — instalação.
- `~/.local/share/opencode/`: `storage/session/`, `storage/message/`, `storage/part/`,
  `storage/project/`, `log/`, `opencode.db` (1.1MB), `opencode.db-wal` (3.9MB), `auth.json`.

## Correção e armadilhas

O sandbox monta `~/.local/share/opencode` inteiro em RW. Assim sessões, logs, credencial e a família
SQLite (`opencode.db`, `-wal`, `-shm` quando criado) ficam juntos e persistem entre runs.
`~/.opencode` fica RO para disponibilizar o binário e suas dependências. O HOME inteiro não é montado.

Personas resolvidas em `.claude/agents` entram apenas como prefixo do prompt: seus nomes não
pertencem ao catálogo nativo selecionado por `opencode --agent`. O prompt posicional vem depois de
`--`, preservando textos que começam com hífen.

## Binds de sandbox: os dois diretórios de estado (descoberto por execução real)

`~/.opencode` é **só instalação** (`bin/`, `node_modules/`, `package.json`). Bindar só ele não basta,
e o modo de falha engana em dois níveis:

1. Sem `~/.local/share/opencode` em RW: morre cedo com
   `Unknown: FileSystem.open (.../log/opencode.log)`.
2. Com `share` mas **sem `~/.local/state/opencode`** em RW: o CLI sobe, cria sessão, e falha com
   `UnknownError: Unexpected server error` — mensagem genérica que não diz nada. A causa real só
   aparece no log da própria engine:
   `EROFS: read-only file system, mkdir '~/.local/state/opencode/locks/<hash>.lock'`.

O motivo é o `SANDBOX_HOME_RO` montar `~/.local` inteiro como read-only: cada subpath gravável
precisa ser declarado depois, em `SANDBOX_ENGINE_RW`, para sobrepor o bind RO. Os dois são
necessários — `share` (sessões, SQLite + WAL/SHM, auth, log) e `state` (locks).

Com os dois montados, a retomada real passa dentro do bwrap:

```
1) text: "OK"      session: ses_f5da5af56ffeVzhFtf2ha1wDTD
2) text: "BANANA"  session: ses_f5da5af56ffeVzhFtf2ha1wDTD   <- mesma sessão, contexto preservado
```

Lição transferível para as engines restantes: uma mensagem de erro genérica do CLI (`UnknownError`)
não é motivo para adivinhar bind — o log da engine, uma vez montado, nomeia o path exato que faltou.
