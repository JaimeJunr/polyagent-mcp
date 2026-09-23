# Spike — engine `agy` (Google Antigravity CLI): implementada, validada e ADIADA

Data: 2026-09-14 · Status final: **ADIADA por decisão do dono do projeto**, não por falta de viabilidade.
Código preservado em `2026-09-18-agy-engine.patch` (450 linhas, aplicável com `git apply`).

Este doc existe para que a próxima tentativa **não repita a investigação**. Tudo abaixo foi observado
em execução real no host, não inferido.

## Por que foi adiada

Um único defeito, mas grave: **`--conversation <id>` não retoma a conversa dentro do sandbox, e falha
em silêncio**. Teste real:

1. `agy -p "Remember this secret word: BANANA. Just acknowledge with OK."` → `"OK"`, id `e3cae655-…`
2. `agy -p "What was the secret word?" --conversation e3cae655-…` → **`"None"`**, e id NOVO `e4484571-…`

Sem erro. Um `follow_up` numa sessão `agy` responderia com contexto vazio fingindo continuidade — e o
`follow_up` existe exatamente para não reenviar contexto. Erro silencioso é pior que erro barulhento,
então a engine não entrou.

## O que JÁ FUNCIONA (não precisa ser redescoberto)

Delegação real de ponta a ponta, via `runCursor`, **sandbox ligado e stdin fechado**:
`text = "PONG\n"`, session id capturado. O caminho feliz está resolvido.

### Dialeto (confirmado por `--help` e execução)

`-p/--print` · `--output-format text|json|stream-json` · `--model` · `--effort low|medium|high`
`--conversation <id>` (resume) · `-c/--continue` · `--dangerously-skip-permissions` · `--sandbox`
`--mode accept-edits|plan` · `--agent` · `--add-dir`

Sem flag nativa de system prompt: a persona vai como prefixo do prompt, igual ao cursor.

### Formato de saída (JSON real, não suposto)

```json
{"conversation_id":"ee739693-…","status":"SUCCESS","response":"PONG\n",
 "duration_seconds":4.55,"num_turns":1,"usage":{"input_tokens":13179,"output_tokens":2,…}}
```

`response` + `conversation_id` são os campos certos — `parseCliJson` os cobre. Há também `status`
(`SUCCESS`/`ERROR`), hoje não usado, candidato a detectar falha sem depender do exit code.

### Catálogo (`agy models`)

`gemini-3.8-flash-{high,medium,low}` · `gemini-3.1-pro-{high,low}` · `claude-sonnet-4-6` ·
`claude-opus-4-6-thinking` · `gpt-oss-120b-medium`. Assinatura Google, custo marginal ≈ 0.

## As três armadilhas que custaram caro (leia antes de tentar de novo)

**1. `antigravity` ≠ `agy`.** `~/.antigravity` e `~/.config/Antigravity` são a **IDE Electron**
(extensões do VSCode, Cookies, GPUCache, Crashpad). A CLI headless é `~/.local/bin/agy` e seu estado
vive em `~/.gemini`. Bindar os diretórios da IDE não dá erro — só não funciona.

**2. A credencial NÃO está em arquivo nenhum.** `~/.gemini/oauth_creds.json` existe e é uma pista
falsa: removendo o bind dele a `agy` autentica igual; mantendo o arquivo mas mascarando `/run` ela
falha. A credencial vem do **keyring do usuário, pelo Secret Service no socket DBus**
`$XDG_RUNTIME_DIR/bus`. Como o sandbox faz `--tmpfs /run`, o socket some e ela cai no login
interativo — que em headless trava até o timeout.

Provado por eliminação: sem `oauth_creds.json` mas com o socket → autentica. Com o arquivo e sem o
socket → "Please sign in". Bindar **só o arquivo `bus`** basta; o diretório traz o resto da sessão
(pipewire, systemd user) e não é necessário.

**Custo declarado:** esse bind dá ao worker acesso ao Secret Service **inteiro** — em princípio todo
o keyring do usuário, não só a credencial da `agy`. Foi aprovado conscientemente antes da engine ser
adiada por outro motivo. Se ela voltar, essa decisão precisa ser reconfirmada, não herdada em silêncio.

**3. A causa provável do resume quebrado, e a pegadinha do fix.** As conversas são SQLite em
`~/.gemini/antigravity-cli/conversations/` (30 arquivos no host). O sandbox não monta esse diretório,
então o estado morre no `isoHome` efêmero. **Mas o fix não é bindar o diretório:** assim que a árvore
`.gemini/antigravity-cli/` passa a existir no HOME isolado, a `agy` **para de consultar o keyring** e
volta a exigir login. Ela muda de comportamento ao enxergar um `.gemini` parcial. Quem retomar isto
precisa entender esse gatilho primeiro — e a saída preferível é um diretório de conversas **dedicado
do bridge**, persistente entre runs, isolado do histórico do usuário, nunca o `conversations` dele.

## Estado do código preservado (`2026-09-18-agy-engine.patch`)

Completo e verde: `Engine` + `AGY_BIN`, `buildAgyArgs` puro, dispatcher, `parseCliJson` estendido,
`formatSessionHandle`/`parseSessionHandle`, binds corrigidos para `~/.gemini`, `ENGINE_CAPABILITIES`
com `engineReadOnly: false` (o `--sandbox`/`--mode plan` dela NÃO equivalem ao `-s read-only` do
codex — a garantia read-only continua vindo do bwrap), e o campo `sessionBus` no `SandboxSpec`,
emitido **depois** do `--tmpfs /run` e preenchido só para `agy`, com o path resolvido em runtime por
`XDG_RUNTIME_DIR` (nunca hardcoded) e guard de existência.

`npm run build` limpo e 294→299 testes verdes, incluindo o invariante "nenhuma outra engine recebe o
socket DBus". O TDR independente mutou 4 pontos de risco e confirmou mecanismo genuíno, sem fake-green.

## Achado lateral, independente da agy

`assertReadOnlyEngine` está hardcoded em `engine === "codex"` e **não** lê `ENGINE_CAPABILITIES`. Um
`engineReadOnly` errado na matriz não abriria execução indevida (o guard segura), mas contaminaria a
sugestão pós-cota de `quotaCandidates`. É uma duplicação de verdade entre código e matriz que um dia
diverge — vale unificar, e não depende da `agy` voltar.
