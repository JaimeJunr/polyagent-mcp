# Spike — dialeto das CLIs candidatas a engine nova

Data: 2026-09-14 · Método: `--help` / `models` / `auth list` de cada binário no PATH do host.
Objetivo: saber se cada CLI candidata é spawnável headless pelo bridge (prompt por arg, saída
parseável, resume por id, autonomia por flag) ANTES de escrever user stories sobre ela.

## Veredito por candidata

| CLI | Headless | Saída | Resume | Autonomia | Modelo | Efeito | Veredito |
|---|---|---|---|---|---|---|---|
| `opencode` | `run <msg>` | `--format json` (raw JSON events) | `-s <id>` / `-c` | `--auto` | `-m provider/model` | `--variant` | **viável** |
| `agy` (Google) | `-p/--print` | `--output-format json\|stream-json` | `--conversation <id>` / `-c` | `--dangerously-skip-permissions` | `--model` | `--effort low\|medium\|high` | **viável** |
| `kimi` | `-p <prompt>` | `--output-format stream-json` | `-S <id>` / `-c` | `--auto` / `-y` | `-m <alias>` | (não exposto) | **viável** |
| `muse` | `exec` | (a confirmar) | `resume --last\|<uuid>` | (a confirmar) | (a confirmar) | (a confirmar) | **viável, menos mapeado** |
| `antigravity` | não | app Electron/IDE: sobe DevTools + language_server | — | — | — | — | **DESCARTADO** |

`antigravity` é a IDE; a CLI headless equivalente é `agy` (`~/.local/bin/agy`).

## Encaixe com o bridge

- `opencode` e `agy` mapeiam quase 1:1 no `RunOpts` atual (prompt/model/effort/resume/force/agentPrompt).
- `agy` tem `--sandbox` e `--mode plan`, candidatos a read-only das tools auxiliares — mas NÃO são
  `-s read-only` do codex; a garantia read-only continua vindo do bwrap (US-008), não do engine.
- `kimi` é o dialeto do `claude` com outros nomes de flag.
- `opencode` aceita `--dir`, então o `cwd` não depende só do spawn.
- Todos leem config global do HOME → cada um precisa da sua entrada em `SANDBOX_ENGINE_RO/RW`.

## Achado que muda o critério: assinatura × API key

Os rankings medem **$/task de API pay-per-token**. As engines do bridge hoje (codex, grok, claude)
rodam em **assinatura**, custo marginal ≈ 0 por chamada. Das candidatas:

- `agy`: login Google (assinatura) — custo marginal ≈ 0.
- `kimi`: `~/.kimi-code/{credentials,oauth}` → OAuth (assinatura) — custo marginal ≈ 0.
- `opencode`: `auth list` → **Google, Groq, OpenRouter, todos `api`** (API key) → **custo real por
  token**. Lista 383 modelos, mas só os desses 3 providers estão autenticados. Exceção observada:
  `opencode/muse-spark-1.3-contributor-free`.
- `muse`: `~/.config/muse/auth.json` (44B) via `muse auth set --api-key-stdin` → **API key**.

Consequência: ordenar os níveis por "$/task do gráfico" importaria um custo que o bridge hoje não
paga. O eixo correto é capacidade por nível DENTRO da assinatura já paga; engine de API key só se
justifica pelo que a assinatura não alcança.

## Catálogo alcançável (observado)

- codex: `gpt-5.6-sol` (default do config), `gpt-5.6-luna`; `gpt-6-astra` aparece no cache do CLI —
  **id existe, uso em runtime ainda não confirmado**.
- grok (`grok models`): `grok-4.6` (default), `grok-4.5`. Só esses dois.
- claude: opus / fable / sonnet / haiku.
- agy (`agy models`): `gemini-3.8-flash-{high,medium,low}`, `gemini-3.1-pro-{high,low}`,
  `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`.
- opencode: 383 ids, úteis só via Google/Groq/OpenRouter.

## Confiança

Alta: presença do binário, flags de `--help`, catálogo de `grok models`/`agy models`/`opencode
models`, providers de `opencode auth list`, descarte do `antigravity`.
Média: `gpt-6-astra` no codex (visto em cache, não em execução).
Baixa / não coberto: dialeto completo do `muse exec`; formato exato de session id de cada CLI;
comportamento de todas dentro do bwrap (stdin fechado, HOME isolado).

## US-2 — rework dos binds e tentativa de execução (2026-09-14)

O binário `~/.local/bin/agy` contém paths sob `.gemini/antigravity-cli/cache`,
`.gemini/antigravity/artifacts` e `.gemini/antigravity/transcript.jsonl`.
A credencial apontada pela revisão é `.gemini/oauth_creds.json` (RW para refresh).
Os binds foram restritos a esses subpaths; não incluem `.gemini` inteiro, `config/`,
`antigravity-cli/settings.json`, `antigravity-cli/hooks.json` ou `GEMINI.md`.
Os diretórios `.antigravity` e `.config/Antigravity` pertencem à IDE e foram removidos.
Essa allowlist ainda precisa de validação de execução autenticada para confirmar suficiência.

Nesta sessão, `/home/jaime/.gemini` não existe. A tentativa real via `runCursor`
do `dist/cli.js` compilado, com `engine: "agy"`, `force: true` e sandbox ligado,
usou o spawn existente com `stdio: ["ignore", "pipe", "pipe"]` e produziu:

```text
{"sandboxOn":true,"agyBinds":[]}
bwrap: No permissions to create new namespace, likely because the kernel does not allow non-privileged user namespaces. See <https://deb.li/bubblewrap> or <file:///usr/share/doc/bubblewrap/README.Debian.gz>.
```

Exit code: 1, stdout vazio. O processo agy não chegou a iniciar dentro do sandbox.
Autenticação, JSON de sucesso e retomada real continuam NÃO VALIDADOS.
`response` e `conversation_id` foram observados anteriormente apenas no JSON de erro
de autenticação; isso não comprova o envelope de sucesso. O parser permanece tolerante
a esses campos, sem alegação de validação ponta a ponta.
