# Spike — engine `kimi`: dialeto, estado persistente e validação pendente

Data: 2026-09-15 · Status: **login feito; cota mensal esgotada; só meta confirmado no stream; texto/session id e resume pendentes**.

Este doc registra fatos coletados pelo orquestrador em execução real no host e fornecidos ao
agente. Não são execuções locais do agente. O worker roda dentro do bwrap com HOME isolado:
a ausência aparente de `~/.kimi-code` nessa visão NÃO demonstra ausência no host. A investigação
anterior que concluiu isso era inválida.

## Dialeto confirmado por --help no host

Binário: `~/.kimi-code/bin/kimi`. O bridge usa `kimi` no PATH, com override
`POLYAGENT_KIMI_BIN`.

- Prompt não-interativo: `-p <prompt>` / `--prompt`.
- Saída: `--output-format text|stream-json`; o bridge usa `stream-json`.
- Modelo: `-m <alias>`; exige configuração local do alias (ver abaixo).
- Sessão: `-S <id>` / `--session [id]`; continuar a última: `-c` / `--continue`.
- Autonomia: `--auto` ou `-y/--yolo`, mas incompatíveis com `-p`.
- Workspace extra: `--add-dir <dir>`.

A persona resolvida no host entra como prefixo do prompt; não há flag aditiva de system prompt.
A presença de opções no help não comprova que suas combinações sejam aceitas.

## Incompatibilidade de autonomia com prompt (captura real)

```text
$ kimi -p "Reply with exactly: PONG" --output-format stream-json --auto
error: Cannot combine --prompt with --auto.

$ kimi -p "Reply with exactly: PONG" --output-format stream-json -y
error: Cannot combine --prompt with --yolo.

$ kimi -p "Reply with exactly: PONG" --output-format stream-json
error: failed to run prompt: No model configured. Run `kimi` and use /login to sign in, then retry; or set default_model in config.toml.
```

Na captura anterior ao login, o terceiro comando passa da validação de flags e falha depois por falta de login/configuração.
O modo prompt já é não-interativo: `buildKimiArgs` nunca deve emitir `--auto`, `-y` ou
`--yolo`, mesmo sob `force`, `mode` ou ambos. A garantia read-only vem do bwrap.

## Layout real no host: dois diretórios de estado

Listagem fornecida pelo orquestrador:

```text
~/.kimi-code/ → bin/ credentials/ logs/ oauth/ sessions/ telemetry/ updates/ user-history/ config.toml device_id session_index.jsonl tui.toml workspaces.json
~/.kimi/      → credentials/ logs/ sessions/ user-history/ config.toml   (11 arquivos)
```

Ambos entram em `SANDBOX_ENGINE_RW`. Ambos contêm `credentials/`: o CLI precisa persistir
a renovação OAuth em RW. Montar credenciais RO pode causar `EROFS` após a rotação e queimar
a credencial do HOST, não só a do worker. O HOME inteiro não é montado.

A lição do [spike OpenCode](opencode-engine.md) aplica-se aqui: omitir um segundo diretório de
estado pode produzir falhas genéricas difíceis de diagnosticar. O preparo dos diretórios RW
antes do filtro `existsSync` em `buildSandboxSpec` deve continuar cobrindo os dois paths.

## Modelo exige configuração local

Antes do login, o `config.toml` não continha seções `[models.*]`. Passar `-m kimi-k3`
não resolvia:

```text
Model "kimi-k3" is not configured in config.toml. Add a [models."kimi-k3"] entry with max_context_size
```

O parâmetro `model` seleciona um alias declarado em `[models."<alias>"]` com
`max_context_size` no `config.toml`; ele não configura um modelo apenas pelo nome.
O login/configuração precisa existir antes de delegar com esse alias.

Após o login, o orquestrador confirmou quatro entradas e um default em `~/.kimi-code/config.toml`:

```toml
default_model = "kimi-code/kimi-for-coding"
[models."kimi-code/kimi-for-coding"]
[models."kimi-code/kimi-for-coding-highspeed"]
[models."kimi-code/k3"]
[models."kimi-code/k3-256k"]
```

Os aliases observados levam o prefixo `kimi-code/`. `-m k3` é recusado:

```text
Model "k3" is not configured in config.toml
```

O bridge passa `model` cru, sem validar prefixo: o conjunto válido depende do config do usuário,
que pode declarar outros aliases legítimos. A lista acima não é uma regra fixa nem um config completo.

## Stream-json: primeira linha confirmada

Única linha do envelope observada em execução real no host:

```json
{"role":"meta","type":"system.version","version":"0.43.0"}
```

Esse evento tem `role` e `type` e informa a versão, não texto de resposta.
O evento de texto e a localização do session id continuam **NÃO confirmados**.
Também apareceu no stderr este aviso benigno; é ruído de depreciação, não erro:

```text
Warning: [loop_control] 'max_retries_per_step' is deprecated ...
```

## Cota mensal esgotada (captura real, 2026-09-14)

Após o login, a inferência falhou com:

```text
error: failed to run prompt: provider.auth_error: 403 You've reached your monthly usage limit for this billing cycle. Your quota will be refreshed in the next cycle. To continue now, purchase extra usage or upgrade your plan: https://www.kimi.com/membership/subscription?tab=quota
```

Confiança **ALTA**, observado em runtime pelo orquestrador. Apesar de `provider.auth_error`,
a causa é cota mensal: `QUOTA_PATTERNS` casa apenas as expressões específicas `monthly usage limit`
ou `usage limit for this billing cycle`, nunca o prefixo de auth ou `403` isolado.
Fonte dos padrões: [ADENDO 4 do spike de cota](../../../mcp-bridge-v2/spikes/quota-patterns.md).

## Validação pendente

O login da CLI **FOI feito** e os aliases/default estão configurados. O bloqueio atual é a
cota mensal esgotada, não ausência de autenticação.

1. Aguardar disponibilidade de cota para executar uma inferência bem-sucedida.
2. Capturar o envelope completo de `--output-format stream-json`, identificar os campos de texto
   e session id e confrontá-los com o parser.
3. Exercitar retomada real com `-S <id>` dentro do bwrap, verificando o mesmo id e a lembrança
   do contexto anterior com os dois diretórios persistentes.

Essas validações seguem pendentes porque a cota impede a inferência. Só a linha meta/versão
foi observada: nenhum evento de texto/session id e nenhuma retomada foram comprovados.
O parser permanece tolerante; os casos sintéticos preexistentes dos testes não são capturas reais.
