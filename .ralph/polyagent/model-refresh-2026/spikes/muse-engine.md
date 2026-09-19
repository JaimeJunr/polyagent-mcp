# Spike — engine `muse`: dialeto, envelope JSONL e estado persistente

Data: 2026-09-19 · Status: **dialeto e envelope capturados no host em execução real**.

Este doc registra fatos coletados pelo orquestrador em execução real no host e fornecidos ao
agente. Não são execuções locais do agente. O worker roda dentro do bwrap com HOME isolado:
qualquer `ls ~/...` nessa visão mente. A lição do [spike OpenCode](opencode-engine.md) aplica-se
aqui — em especial os dois diretórios de estado e o filtro `existsSync` em `buildSandboxSpec`.

## Dialeto confirmado (`muse exec --help` + execuções reais)

Binário: `muse` no PATH, com override `POLYAGENT_MUSE_BIN`.

- Headless: `muse exec <PROMPT>` — o prompt é **posicional**.
- Saída: `--json` (JSONL de eventos).
- Modelo: `--model <ID>`.
- Effort: `--reasoning-effort <EFFORT>`. Valores válidos:
  `none|minimal|low|medium|high|xhigh|max|ultra` (default `high`).
- Autonomia headless: `--approval-mode never` (valores: `untrusted|on-request|never`, default
  `on-request`). **Não usar `--yolo`**: ele desliga o approval **e** o sandbox interno do muse.
  O bridge já isola com bwrap; desligar uma camada de segurança sem necessidade é o oposto do
  que este projeto faz. `--approval-mode never` basta para não travar em headless.
- Resume: `--session-id <UUID>` no próprio `exec`. Existe também o subcomando `muse resume
  <uuid>`, mas ele é interativo (abre picker sem argumento) — **não usar**.
- Workspace: `--workspace <PATH>`.
- Provider: `--provider meta|echo` (default `meta`). `echo` é um provider de teste que **não
  chama API** — exercita o dialeto sem custo de token. Informação útil para validar o parser
  e o resume sem gastar a key.
- Persona: a CLI expõe `--agents <JSON>`, mas o formato do JSON **não foi confirmado**. Inventar
  o formato já foi FAIL num review anterior nesta branch. O bridge injeta a persona como
  **prefixo do prompt**, igual a cursor e opencode. Não emite `--agents`.

O prompt posicional vai por último, depois de `--`, para não ser lido como valor de flag.

## Envelope real do `--json` (capturado)

Cada linha é um evento com estas chaves de topo: `schema_version`, `id`, `stream`, `sequence`,
`recorded_at`, `record_type`, `durability`, `causation_id`, `payload_type`,
`payload_schema_version`, `payload`.

- **Session id:** vive em `stream.id`, nos eventos com `stream.kind == "session"`.
- **Texto da resposta:** eventos com `payload_type == "run.output.delta"`, texto em
  `payload.text`. São **deltas** — podem vir vários e precisam ser concatenados na ordem.
- **Fim do run:** `payload_type == "run.terminal.completed"`.
- O prompt do usuário também aparece, em `payload_type == "turn.input.user"` com
  `payload.prompt` — **não** é a resposta; não entra no texto devolvido.

Sequência típica observada: `runtime.command.accepted`, `session.run.linked`,
`turn.input.user`, `run.lifecycle.started`, `task.lifecycle.*`, `run.output.delta`,
`run.terminal.completed`.

stderr traz avisos **benignos** que não são erro (não tratar como falha):

```text
workspace root: …
warning: rules file at …/AGENTS.md exists, but the workspace is untrusted
Skills: N loaded
```

## Prova do `--session-id` (execução real)

Passar o id de uma sessão anterior devolve o **mesmo** id e o `sequence` dos eventos continua
de onde parou (2, 3, …) em vez de reiniciar em 1. O resume é flag no `exec`, não subcomando.

## Layout real no host (confirmado pelo orquestrador)

- `~/.config/muse/` → `auth.json` (a API key), `settings.json`, `trust.json`
- `~/.local/share/muse/` → `sessions/`, `skills/`, `plugins/`, `runtime/`, `local-tracing/`,
  `session-index.db`

São **dois** diretórios de estado. A credencial (`auth.json`) vai RW pelo mesmo motivo das
outras engines: o CLI pode renovar, e montada RO o refresh falha com `EROFS` e queima a
credencial do HOST.

`SANDBOX_HOME_RO` monta `~/.local` **inteiro** em RO, então qualquer subpath gravável ali
precisa ser declarado em `SANDBOX_ENGINE_RW` para sobrepor. Foi exatamente isso que custou
uma rodada inteira na engine OpenCode (share sem state → `UnknownError` / EROFS no lock).
Aqui o segundo diretório é `~/.local/share/muse`, não um `state/` — bindar só
`~/.config/muse` deixaria sessões e o SQLite invisíveis ou read-only.

O HOME inteiro não é montado. O filtro `existsSync` em `buildSandboxSpec` cria os subpaths
RW da engine antes de sondar, senão um diretório ainda inexistente some da lista e a falha
volta genérica.

## Pay-per-token

`muse` autentica por API key em `~/.config/muse/auth.json` (`muse auth set --api-key-stdin`).
Como o OpenCode, cobra por token: **não** entra em `TIERS` nem em `FAST_CANDIDATES`; entra em
`quotaCandidates`; **não** entra em `FALLBACK_ENGINE_ORDER` (aquela lista é retry de falha de
ambiente do codex, e `fallbackOpts` descarta o `mode`, o que derrubaria a garantia read-only).

Sem padrão de cota/rate-limit observado: a falha propaga crua. Classificar errado é pior que
não classificar.

## Read-only

Muse tem sandbox próprio, mas **não** tem equivalente ao `-s read-only` do codex. A garantia
do bridge vem do bwrap. `ENGINE_CAPABILITIES.muse.engineReadOnly` é `false`. Não afrouxar para
passar em `AUX_TOOL_REQUIREMENTS`.

## Validação dentro do bwrap, sem gastar token

`--provider echo` é um provider de teste que não chama API. Isso permite exercitar o dialeto inteiro
— args, envelope JSONL, session id e retomada — a custo zero, inclusive **dentro do sandbox do
bridge**, apontando `POLYAGENT_MUSE_BIN` para um wrapper que injeta a flag.

Resultado, via `runCursor` com sandbox ligado e stdin fechado:

```
1) text: "echo: Say BANANA"  session: 01a0b745-fdb7-74a1-8af6-d46cd50173c0
2) session: 01a0b745-fdb7-74a1-8af6-d46cd50173c0   <- MESMA sessão
```

Ou seja: os dois binds (`~/.config/muse`, `~/.local/share/muse`) bastam, o parser extrai texto e
session id do envelope real, e `--session-id` retoma de verdade.

**Pegadinha que custou uma tentativa:** o prompt é posicional **depois de `--`**, então qualquer flag
acrescentada no fim da linha de comando vira parte do prompt, não opção. Um wrapper que injete flag
precisa fazê-lo logo após o subcomando `exec`, antes do `--`. O sintoma foi enganoso: a CLI reclamou
de credencial (`missing meta credential`) porque caiu no provider `meta` default, e não porque o bind
de auth estivesse errado.

## Pendência: credencial do provider `meta`

O que NÃO foi exercitado é uma chamada real ao provider `meta` (pago, API key em
`~/.config/muse/auth.json`). Com o provider default a CLI responde
`missing meta credential in ~/.config/muse/auth.json: run 'muse login' or set META_API_KEY` — o
arquivo existe mas não tem credencial meta válida. Portanto o caminho pago do muse permanece
**não validado**, e o que está provado é o dialeto, o parser, o sandbox e a retomada.
