import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, extname, join } from "node:path";

/** CLIs suportados. Cada engine tem dialeto de args e parser de saída próprios. */
export type Engine = "cursor" | "grok" | "codex" | "claude" | "opencode" | "kimi" | "muse";

/** Ordem host-agnostic para recuperar uma execução quando o ambiente do codex está quebrado. */
export const FALLBACK_ENGINE_ORDER: Engine[] = ["codex", "grok", "claude"];

/**
 * Detecta falhas de ambiente do codex que nenhum retry no mesmo engine resolve: CODEX_HOME
 * apontando para um diretório de conta que sumiu (gerenciado por apps externos como o orca), ou o
 * app-server interno falhando ao inicializar por filesystem read-only (ex.: conta montada RO).
 * Distinto de erros de auth/permissão do próprio codex, que não devem disparar fallback de engine.
 */
export function isCodexEnvError(stderr: string): boolean {
  if ((stderr.includes("Error finding codex home") || stderr.includes("CODEX_HOME points to"))
    && stderr.includes("does not exist")) return true;
  return stderr.includes("failed to initialize in-process app-server client")
    || stderr.includes("Read-only file system");
}

/**
 * Falha de processo do CLI com os três canais preservados separados. `message` é idêntica à de
 * antes (quem só lê `error.message` não vê diferença), mas o JSON estruturado que os CLIs emitem em
 * stdout deixa de ser descartado sempre que o stderr tem qualquer conteúdo — é ele que permite
 * classificar a causa (cota, rate limit, auth) a jusante.
 */
export class ProcessError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "ProcessError";
  }
}

/** Formata um id de sessão com o engine que deve retomá-lo. */
export function formatSessionHandle(engine: Engine, id: string): string {
  return `${engine}:${id}`;
}

/** Extrai engine e id de um handle; ids antigos sem prefixo continuam válidos. */
export function parseSessionHandle(handle: string): { engine?: Engine; id: string } {
  const separator = handle.indexOf(":");
  if (separator === -1) return { id: handle };

  const prefix = handle.slice(0, separator);
  if (prefix !== "cursor" && prefix !== "grok" && prefix !== "codex" && prefix !== "claude" && prefix !== "opencode" && prefix !== "kimi" && prefix !== "muse") {
    return { id: handle };
  }
  return { engine: prefix, id: handle.slice(separator + 1) };
}

/**
 * Binário do Cursor CLI. Default `cursor-agent` (NÃO `agent`: no PATH do user `agent` pode ser o
 * grok — o bridge quebra ou some por acidente do sandbox). Override via POLYAGENT_CURSOR_BIN.
 */
export const POLYAGENT_CURSOR_BIN = process.env.POLYAGENT_CURSOR_BIN ?? "cursor-agent";
/** Binário do Grok CLI. Override via POLYAGENT_GROK_BIN. */
export const GROK_BIN = process.env.POLYAGENT_GROK_BIN ?? "grok";
/** Binário do Codex CLI. Override via POLYAGENT_CODEX_BIN. */
export const CODEX_BIN = process.env.POLYAGENT_CODEX_BIN ?? "codex";
/** Binário do Claude Code CLI. Override via POLYAGENT_CLAUDE_BIN. */
export const CLAUDE_BIN = process.env.POLYAGENT_CLAUDE_BIN ?? "claude";
/** Binário do OpenCode CLI. Override via POLYAGENT_OPENCODE_BIN. */
export const OPENCODE_BIN = process.env.POLYAGENT_OPENCODE_BIN ?? "opencode";
/** Binário do Kimi CLI. Override via POLYAGENT_KIMI_BIN. */
export const KIMI_BIN = process.env.POLYAGENT_KIMI_BIN ?? "kimi";
/** Binário do Muse CLI. Override via POLYAGENT_MUSE_BIN. */
export const MUSE_BIN = process.env.POLYAGENT_MUSE_BIN ?? "muse";

/**
 * Modelo default do fallback cursor (só usado quando CURSOR_ENABLED e o engine é cursor). O
 * cursor-agent atual NÃO aceita mais o bracket `[fast=true]` — os ids viraram planos com sufixo
 * (`composer-2.5-fast`). NUNCA `auto`. Override via POLYAGENT_MODEL.
 */
export const DEFAULT_MODEL = process.env.POLYAGENT_MODEL ?? "composer-2.5-fast";

/**
 * Modelo barato de leitura do `explore`/`read_slice`/`web_lookup`: GPT-6 Luna via
 * codex (keyless, pela assinatura Codex), rodando read-only (`-s read-only`). Substitui o composer do
 * cursor cancelado — localizar/ler pede o modelo mais barato e ágil. Override via
 * POLYAGENT_EXPLORE_MODEL. Só se aplica quando o chamador não passa `model`.
 * `run_filtered` NÃO usa este default: o default dele é a cascata do `resolveFastTier`.
 */
const EXPLORE_MODEL_FALLBACK = "gpt-6-luna";
export const EXPLORE_MODEL = process.env.POLYAGENT_EXPLORE_MODEL ?? EXPLORE_MODEL_FALLBACK;
/** Effort explícito das três tools de leitura quando resolvidas no codex. Override via POLYAGENT_EXPLORE_EFFORT. */
const EXPLORE_EFFORT_FALLBACK = "medium";
export const EXPLORE_EFFORT = process.env.POLYAGENT_EXPLORE_EFFORT ?? EXPLORE_EFFORT_FALLBACK;

/**
 * Modelo codex que dispara o image_gen built-in (gpt-image-2 faz o trabalho pesado; effort baixo basta).
 * Override via POLYAGENT_IMAGE_MODEL.
 */
export const IMAGE_MODEL = process.env.POLYAGENT_IMAGE_MODEL ?? "gpt-6-sol";

/** Se truthy, passa --force (roda comandos sem prompt). Default off por segurança. */
export const FORCE = ["1", "true", "yes"].includes((process.env.POLYAGENT_FORCE ?? "").toLowerCase());

/**
 * Fallback para o cursor-agent. O usuário cancelou a assinatura do Cursor, então por padrão os tiers
 * NÃO caem no cursor quando a engine preferida (codex/grok/claude) falta — erram com mensagem clara.
 * Reative o fallback (código do cursor continua íntegro) com POLYAGENT_ENABLE_CURSOR=1.
 */
export const CURSOR_ENABLED = ["1", "true", "yes"].includes(
  (process.env.POLYAGENT_ENABLE_CURSOR ?? "").toLowerCase(),
);

/**
 * Timeout padrão (ms): rede de segurança generosa contra travamentos reais, não orçamento de trabalho.
 * Override via POLYAGENT_TIMEOUT_MS.
 */
function resolveDefaultTimeoutMs(): number {
  const raw = Number(process.env.POLYAGENT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 1_800_000;
}
export const DEFAULT_TIMEOUT_MS = resolveDefaultTimeoutMs();

/** Nota de time budget anexada ao prompt de tarefas longas: o worker se auto-gerencia em vez de
 *  ser morto cego ao estourar o timeout. */
export function budgetNote(timeoutMs: number): string {
  const min = Math.max(1, Math.round(timeoutMs / 60_000));
  return `\n\n[Time budget: ~${min} min. If you are running low on time, stop and return partial results with a clear note on what remains — do not risk being cut off mid-work.]`;
}

/** Nota de evidência anexada ao prompt das tools de execução: o worker relata quantos itens a
 *  asserção encontrou. Passar sobre conjunto vazio não prova nada. */
export function evidenceNote(): string {
  return `\n\n[Evidence: report the DENOMINATOR, not just the result. If you wrote or ran a check, say HOW MANY candidates it actually scanned (e.g. "scanned 14 invocations across 6 files, 0 violations"). Scanning zero and finding zero problems looks identical to passing — if the count is 0, say so plainly. When declaring done, say WHAT was verified and HOW, never just "the tests pass".]`;
}

/** Se truthy, loga o comando spawnado e espelha o stderr do child em tempo real. Debug. */
export const DEBUG = ["1", "true", "yes"].includes((process.env.POLYAGENT_DEBUG ?? "").toLowerCase());

/**
 * Sandbox: por padrão o agent roda dentro de um bubblewrap (`bwrap`) com $HOME isolado —
 * assim o cursor-agent NÃO carrega a config global de behavior do user (~/.cursor/rules,
 * mcp.json, hooks.json, skills, cli-config), que poluía o contexto e, pior, fazia cada
 * chamada tentar subir os MCP servers do user (lentidão/timeout). Só bindamos auth +
 * toolchains. Desliga com POLYAGENT_SANDBOX=off (ou 0/false/no/vazio).
 */
const SANDBOX = (process.env.POLYAGENT_SANDBOX ?? "bwrap").toLowerCase();
export const SANDBOX_ON = !["", "off", "0", "false", "no"].includes(SANDBOX);

/** Paths de sistema montados read-only no sandbox (só os que existirem). */
const SANDBOX_SYSTEM_RO = [
  "/usr", "/bin", "/sbin", "/lib", "/lib64", "/lib32", "/etc/alternatives",
  "/etc/resolv.conf", "/etc/hosts", "/etc/ssl", "/etc/ca-certificates",
  "/etc/passwd", "/etc/group", "/etc/nsswitch.conf",
];
/** Subpaths do HOME liberados RO: SÓ auth + toolchains — nunca behavior config. */
const SANDBOX_HOME_RO = [
  ".config/cursor/auth.json", ".nvm", ".local", ".mise", ".config/mise", ".sdkman", ".gitconfig",
];
/**
 * Subpaths do HOME RO específicos por engine: SÓ o que o binário precisa (auth + libs), NUNCA a
 * config global (que carrega rules/MCP servers — o que inflava e travava). O que não é bindado cai
 * no $HOME isolado (vazio), então cada CLI roda sem sua config global. Só os que existirem entram.
 */
const SANDBOX_ENGINE_RO: Record<Engine, string[]> = {
  cursor: [], // auth do cursor já vem no SANDBOX_HOME_RO base
  grok: [], // grok precisa de RW em ~/.grok (auth, skills e cache) — ver SANDBOX_ENGINE_RW
  codex: [], // codex precisa de RW em ~/.codex (state/cache/locks/socket) — ver SANDBOX_ENGINE_RW
  // claude: NUNCA ~/.claude inteiro — isso traz settings/agents/mcp.json de volta, o que reinfla o
  // contexto (o worker roda com --bare + --append-system-prompt, então não precisa descobrir
  // agents/rules no HOME). A credencial de oauth fica em SANDBOX_ENGINE_RW: precisa ser gravável.
  claude: [".claude.json"],
  opencode: [".opencode"], // instalação (binário e dependências), sem estado de sessão
  kimi: [], // os dois diretórios de estado ficam RW abaixo
  muse: [], // os dois diretórios de estado ficam RW abaixo
};
/**
 * Subpaths do HOME RW por engine. Grok precisa de auth/skills/cache em ~/.grok; o codex tem
 * arquitetura cliente-daemon (state, cache, locks, socket do app-server) e trava se ~/.codex for
 * read-only ou ausente. A config global do codex é neutralizada por `--ignore-user-config`.
 */
const SANDBOX_ENGINE_RW: Record<Engine, string[]> = {
  cursor: [],
  grok: [".grok"],
  codex: [".codex"],
  // claude escreve estado de sessão/telemetria em ~/.claude ao rodar headless; sem RW o run pode
  // falhar. Damos RW só em subpaths de estado, nunca settings/agents (que ficam no HOME isolado).
  // .credentials.json é RW de propósito: o CLI renova o oauth da assinatura e precisa persistir o
  // par novo. Montado RO, o refresh falha com EROFS e o refresh token — já rotacionado no servidor
  // — fica queimado no disco, derrubando TODA a auth do host com "401 OAuth token has been
  // revoked", não só o worker. Quem escreve ali é o próprio CLI renovando a credencial dele.
  claude: [
    ".claude/.credentials.json",
    ".claude/statsig",
    ".claude/projects",
    ".claude/todos",
    ".claude/shell-snapshots",
  ],
  // ~/.opencode contém só a instalação. Sessões, logs, auth e SQLite (incluindo WAL/SHM)
  // vivem em ~/.local/share/opencode; o diretório inteiro precisa persistir em RW.
  // ~/.local/state/opencode guarda os locks: sem RW o CLI morre com EROFS ao criar o lock de
  // models.dev, e o erro chega ao caller como "UnknownError" genérico — $HOME/.local entra RO
  // pela base, então cada subpath gravável precisa ser declarado aqui.
  opencode: [
    ".local/share/opencode",
    ".local/state/opencode",
  ],
  // O host tem DOIS diretórios de estado: ~/.kimi-code e ~/.kimi, ambos com credentials/.
  // Ambos precisam de RW para persistir sessões e renovar OAuth: RO causa EROFS no refresh
  // e pode queimar a credencial do HOST. Nunca montar o HOME inteiro.
  kimi: [".kimi-code", ".kimi"],
  // Muse persiste em DOIS diretórios: ~/.config/muse (auth.json, settings, trust) e
  // ~/.local/share/muse (sessões, skills, plugins, runtime, SQLite). Auth é RW porque o
  // CLI pode renovar a API key; montada RO, o refresh falha com EROFS e queima a
  // credencial do HOST. ~/.local entra RO pela base (SANDBOX_HOME_RO), então o subpath
  // gravável precisa ser declarado aqui para sobrepor — mesma lição do opencode.
  muse: [".config/muse", ".local/share/muse"],
};
/** Subpaths do HOME liberados RW: caches de build (acelera runs seguidos). */
const SANDBOX_HOME_RW = [".gradle", ".m2", ".cache/uv", ".cache/pip"];
/**
 * Paths extras montados RW no sandbox além do cwd, separados por `:` em POLYAGENT_SANDBOX_EXTRA.
 * O sandbox só monta o cwd como workspace; comandos que tocam paths fora dele (ex.: additional
 * working dirs, monorepos irmãos) davam "No such file or directory". Liste-os aqui uma vez.
 */
const SANDBOX_EXTRA = (process.env.POLYAGENT_SANDBOX_EXTRA ?? "")
  .split(":")
  .map((p) => p.trim())
  .filter(Boolean);
/** Env de proxy/SSL preservado do host, se setado. */
const SANDBOX_PROXY_ENV = [
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS",
];

export interface SandboxSpec {
  home: string;
  user: string;
  path: string;
  lang: string;
  lcAll: string;
  /** dir vazio montado como $HOME (RW, efêmero). */
  isoHome: string;
  /** dir montado como /tmp dentro do sandbox (RW, efêmero). */
  tmpDir: string;
  /** cwd do run — sempre o último bind pra nunca ser sobreposto. */
  workspace: string;
  /** monta o workspace como somente leitura quando true. */
  workspaceRo: boolean;
  systemRo: string[];
  homeRo: string[];
  homeRw: string[];
  /** paths extras montados RW (POLYAGENT_SANDBOX_EXTRA), antes do workspace. */
  extraBinds: string[];
  extraEnv: Array<[string, string]>;
}

/**
 * Monta os args do `bwrap` (sem o binário nem o comando alvo). Função pura — testável.
 * Ordem crítica: `isoHome` monta o $HOME vazio ANTES dos binds de subpaths do HOME
 * (senão o overlay de auth/toolchain some), e o `workspace` é o último bind.
 */
export function buildSandboxArgs(spec: SandboxSpec): string[] {
  const args: string[] = [];
  for (const p of spec.systemRo) args.push("--ro-bind", p, p);
  args.push("--bind", spec.isoHome, spec.home);
  args.push("--bind", spec.tmpDir, "/tmp", "--tmpfs", "/run");
  for (const p of spec.homeRo) args.push("--ro-bind", p, p);
  for (const p of spec.homeRw) args.push("--bind", p, p);
  for (const p of spec.extraBinds) args.push("--bind", p, p);
  args.push(spec.workspaceRo ? "--ro-bind" : "--bind", spec.workspace, spec.workspace);
  args.push(
    "--setenv", "HOME", spec.home,
    "--setenv", "USER", spec.user,
    "--setenv", "PATH", spec.path,
    "--setenv", "LANG", spec.lang,
    "--setenv", "LC_ALL", spec.lcAll,
  );
  for (const [k, v] of spec.extraEnv) args.push("--setenv", k, v);
  args.push(
    "--proc", "/proc",
    "--dev", "/dev",
    "--share-net",
    "--unshare-pid", "--unshare-uts", "--unshare-ipc",
    "--die-with-parent", "--new-session",
    "--chdir", spec.workspace,
  );
  return args;
}

/** Procura o binário `bwrap` no PATH. Retorna o path absoluto ou null. */
function bwrapPath(): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir && existsSync(join(dir, "bwrap"))) return join(dir, "bwrap");
  }
  return null;
}

/** Mensagem única do bwrap ausente — usada no preflight e no runOnce. */
const BWRAP_MISSING =
  "polyagent-mcp: bwrap não encontrado no PATH. O sandbox é obrigatório — instale com 'sudo apt install bubblewrap', " +
  "ou desligue explicitamente com POLYAGENT_SANDBOX=off (nesse caso as tools read-only só aceitam codex).";

/**
 * Falha cedo (na inicialização do server) se o sandbox está ligado e o bwrap não existe. Antes,
 * a ausência do binário só virava um aviso em stderr que o chamador MCP nunca via, e o worker
 * rodava sem isolamento nenhum — degradação silenciosa de uma garantia de segurança.
 */
export function sandboxPreflight(sandboxOn = SANDBOX_ON): void {
  if (sandboxOn && !bwrapPath()) throw new Error(BWRAP_MISSING);
}

/**
 * Com o sandbox desligado por escolha do operador, o read-only das tools auxiliares deixa de vir
 * do `--ro-bind` do bwrap e passa a depender do engine: só o codex tem read-only próprio
 * (`-s read-only`). Grok ignora `mode` e sempre emite `--always-approve`; claude emite
 * `--dangerously-skip-permissions`. Por isso, sem sandbox, qualquer engine não-codex é recusado.
 */
export function assertReadOnlyEngine(tool: string, engine: Engine, sandboxOn = SANDBOX_ON): void {
  if (sandboxOn || engine === "codex") return;
  throw new Error(
    `${tool} é read-only e o sandbox está desligado (POLYAGENT_SANDBOX=off): engine '${engine}' recusado. ` +
    "Sem bwrap, só o codex garante read-only próprio (-s read-only) — use engine 'codex' ou religue o sandbox.",
  );
}

/** As quatro tools auxiliares, que resolvem engine/modelo próprios (as demais vão pelo tier). */
export type AuxTool = "explore" | "read_slice" | "run_filtered" | "web_lookup";

/** O que cada engine garante no nível do CLI — base das recusas por capacidade. */
export interface EngineCapability {
  /**
   * Busca web nativa. O codex liga via RunOpts.web (-c tools.web_search=true); o claude -p já traz o
   * WebSearch ligado. Os outros ignoram o campo.
   */
  webSearch: boolean;
  /** Read-only próprio do engine, independente do sandbox. Só o codex (-s read-only). */
  engineReadOnly: boolean;
  /** Read-only via bwrap: buildSandboxSpec(workspace, engine, !!mode) monta o workspace --ro-bind. Vale para todos. */
  sandboxReadOnly: boolean;
  /** O que o engine faz com RunOpts.mode no nível do CLI — documenta por que o read-only depende do sandbox. */
  modeAtEngineLevel: string;
}

/**
 * Matriz de capacidade por engine. O ponto não-óbvio que ela registra: fora do codex, `mode` NÃO
 * significa read-only no nível do engine — buildGrokArgs ignora `mode` e emite sempre
 * `--always-approve`, e buildClaudeArgs emite `--dangerously-skip-permissions`, o oposto de
 * read-only. Por isso o read-only dessas tools fora do codex depende do sandbox bwrap (obrigatório
 * desde a US-008) e assertReadOnlyEngine recusa não-codex com o sandbox desligado.
 */
export const ENGINE_CAPABILITIES: Record<Engine, EngineCapability> = {
  codex: {
    webSearch: true,
    engineReadOnly: true,
    sandboxReadOnly: true,
    modeAtEngineLevel: '-s read-only -c approval_policy="never" (buildCodexArgs, fora do bwrap)',
  },
  grok: {
    webSearch: false,
    engineReadOnly: false,
    sandboxReadOnly: true,
    modeAtEngineLevel: "mode ignorado — sempre --always-approve (buildGrokArgs)",
  },
  claude: {
    // WebSearch nativo do claude -p, liberado pelo --dangerously-skip-permissions do mode.
    // Confirmado ao vivo no bwrap em 2026-09-25 (haiku low, 14s, resposta citou WebSearch e fontes).
    webSearch: true,
    engineReadOnly: false,
    sandboxReadOnly: true,
    modeAtEngineLevel: "mode emite --dangerously-skip-permissions (buildClaudeArgs)",
  },
  opencode: {
    webSearch: false,
    engineReadOnly: false,
    sandboxReadOnly: true,
    modeAtEngineLevel: "mode ignorado — sem garantia de read-only no engine (buildOpencodeArgs); a garantia vem do bwrap",
  },
  kimi: {
    webSearch: false,
    engineReadOnly: false,
    sandboxReadOnly: true,
    modeAtEngineLevel: "mode não altera flags: -p já é não-interativo; sem read-only no engine, a garantia vem do bwrap",
  },
  muse: {
    webSearch: false,
    engineReadOnly: false,
    sandboxReadOnly: true,
    modeAtEngineLevel: "force/mode emitem --approval-mode never (buildMuseArgs); sem -s read-only no engine, a garantia vem do bwrap",
  },
  cursor: {
    webSearch: false,
    engineReadOnly: false,
    sandboxReadOnly: true,
    modeAtEngineLevel: "mode vira --mode <mode> (buildCursorArgs), sem garantia de read-only",
  },
};

/** O que cada tool auxiliar exige do engine. run_filtered não exige nada: roda com force por desenho. */
export const AUX_TOOL_REQUIREMENTS: Record<AuxTool, { readOnly: boolean; webSearch: boolean }> = {
  explore: { readOnly: true, webSearch: false },
  read_slice: { readOnly: true, webSearch: false },
  run_filtered: { readOnly: false, webSearch: false },
  web_lookup: { readOnly: true, webSearch: true },
};

/** A engine atende o que a tool exige? Mesma regra das recusas de resolveAuxTool, sem lançar. */
function meetsAuxRequirements(tool: AuxTool, engine: Engine, sandboxOn: boolean): boolean {
  const req = AUX_TOOL_REQUIREMENTS[tool];
  const cap = ENGINE_CAPABILITIES[engine];
  if (req.webSearch && !cap.webSearch) return false;
  return !(req.readOnly && !cap.engineReadOnly && !sandboxOn);
}

/** Prefixo do par de env de cada tool: <prefixo>_ENGINE e <prefixo>_MODEL. */
export const AUX_TOOL_ENV: Record<AuxTool, string> = {
  explore: "POLYAGENT_EXPLORE",
  read_slice: "POLYAGENT_READ_SLICE",
  run_filtered: "POLYAGENT_RUN_FILTERED",
  web_lookup: "POLYAGENT_WEB_LOOKUP",
};

const ENGINES = Object.keys(ENGINE_CAPABILITIES) as Engine[];

function parseEngine(raw: string, source: string): Engine {
  if ((ENGINES as string[]).includes(raw)) return raw as Engine;
  throw new Error(
    `engine inválida '${raw}' (${source}): use uma de ${ENGINES.join(", ")}.`,
  );
}

/**
 * Resolve (engine, modelo, effort) de uma tool auxiliar. Precedência: parâmetro da chamada > env própria da
 * tool (POLYAGENT_<TOOL>_ENGINE/_MODEL) > default (codex + POLYAGENT_EXPLORE_MODEL, o modelo barato
 * de leitura das três tools de leitura). `run_filtered` no handler NÃO passa por aqui no caminho
 * default — usa `resolveRunFiltered`, cuja cascata substitui esse default. Com engine não-codex e
 * sem modelo explícito devolve `undefined`: o modelo default é um id de codex, mandá-lo para
 * grok/claude falharia — melhor deixar o CLI usar o próprio default. As três tools de leitura
 * recebem `POLYAGENT_EXPLORE_EFFORT` (medium por default) só quando a engine resolvida é codex;
 * `run_filtered` não recebe esse default.
 *
 * Recusa, nomeando o motivo, engine que não atenda o requisito da tool (read-only, web search).
 * Função pura: `env` e `sandboxOn` são injetados para teste.
 */
export function resolveAuxTool(
  tool: AuxTool,
  params: { engine?: string; model?: string; effort?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
  sandboxOn = SANDBOX_ON,
): { engine: Engine; model: string | undefined; effort?: string } {
  const prefix = AUX_TOOL_ENV[tool];
  const engine = params.engine
    ? parseEngine(params.engine, `parâmetro engine de ${tool}`)
    : env[`${prefix}_ENGINE`]
      ? parseEngine(env[`${prefix}_ENGINE`] as string, `${prefix}_ENGINE`)
      : "codex";

  const req = AUX_TOOL_REQUIREMENTS[tool];
  if (req.readOnly) assertReadOnlyEngine(tool, engine, sandboxOn);
  if (req.webSearch && !ENGINE_CAPABILITIES[engine].webSearch) {
    throw new Error(
      `${tool} exige web search e a engine '${engine}' não tem: só codex (-c tools.web_search=true) ` +
      "e claude (WebSearch nativo) buscam; as demais ignoram o campo web. Use engine 'codex' ou 'claude'.",
    );
  }

  const defaultModel = engine === "codex"
    ? env.POLYAGENT_EXPLORE_MODEL ?? EXPLORE_MODEL_FALLBACK
    : undefined;
  const model = params.model ?? env[`${prefix}_MODEL`] ?? defaultModel;
  const defaultEffort = tool !== "run_filtered" && engine === "codex"
    ? env.POLYAGENT_EXPLORE_EFFORT ?? EXPLORE_EFFORT_FALLBACK
    : undefined;
  const effort = params.effort ?? defaultEffort;
  return effort === undefined ? { engine, model } : { engine, model, effort };
}

/**
 * Resolve (engine, modelo, effort) do `run_filtered`.
 *
 * Precedência igual às outras auxiliares: parâmetro da chamada > env
 * POLYAGENT_RUN_FILTERED_ENGINE/_MODEL > default. Só o default muda: em vez de
 * codex + EXPLORE_MODEL, é a cascata do fast_delegate (`resolveFastTier` /
 * FAST_CANDIDATES). Motivo: velocidade — e com a cota do codex esgotada a tool
 * antiga falhava; a cascata cai no próximo engine saudável.
 *
 * CUSTO: os dois primeiros candidatos são assinaturas (codex GPT-6 Luna medium e Claude Haiku
 * low), então o caminho comum é custo marginal zero. O 3º é pay-per-token (opencode/mercury-2),
 * usado só quando codex e claude estão ausentes, sem cota ou unhealthy. `run_filtered` passa a
 * poder gastar dinheiro apenas depois dessas duas assinaturas falharem.
 * Engine/modelo explícitos ainda vencem e não disparam a cascata.
 *
 * Engine explícito (param ou env) reusa `resolveAuxTool`: mesmo parse, mesmas
 * recusas, mesmo default de modelo no override (codex → EXPLORE_MODEL; outros
 * → undefined). Não exige read-only (`AUX_TOOL_REQUIREMENTS.run_filtered`), então
 * a cascata não esbarra em `assertReadOnlyEngine`. Roda com `force: true` e sem
 * `mode` — quem aplica isso é o handler, não esta função.
 *
 * Função pura: `env`/`has`/`cursorEnabled`/`health`/`sandboxOn` injetados para teste.
 */
export function resolveRunFiltered(
  params: { engine?: string; model?: string; effort?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
  has: (e: Engine) => boolean = hasEngine,
  cursorEnabled: boolean = CURSOR_ENABLED,
  health?: Record<string, number>,
  sandboxOn = SANDBOX_ON,
): { engine: Engine; model: string | undefined; effort?: string } {
  const prefix = AUX_TOOL_ENV.run_filtered;
  if (params.engine || env[`${prefix}_ENGINE`]) {
    const resolved = resolveAuxTool("run_filtered", params, env, sandboxOn);
    return { ...resolved, effort: params.effort };
  }
  const tier = resolveFastTier(has, cursorEnabled, health);
  return {
    engine: tier.engine,
    model: params.model ?? env[`${prefix}_MODEL`] ?? tier.model,
    effort: params.effort ?? tier.effort,
  };
}

/** As três tools de leitura, que resolvem pela cascata de resolveReadTool. */
export type ReadTool = "explore" | "read_slice" | "web_lookup";

/**
 * Resolve (engine, modelo, effort) de `explore`/`read_slice`/`web_lookup` pelo mesmo caminho do
 * `run_filtered`: a cascata FAST_CANDIDATES, pulando engine ausente, unhealthy (cota/falha recente)
 * ou que não atende a tool (read-only sem sandbox; web search no web_lookup). Antes elas ficavam
 * presas no codex e, com a cota dele esgotada, só falhavam.
 *
 * Quando a cascata escolhe o codex, o modelo/effort continuam os de leitura (POLYAGENT_EXPLORE_MODEL
 * e POLYAGENT_EXPLORE_EFFORT, ou gpt-6-luna medium) — e a env `<TOOL>_MODEL` só vale nele, porque é
 * id de codex e quebraria em claude/opencode. Engine explícita (param ou env) usa resolveAuxTool e
 * não passa pela cascata. Função pura: `env`/`has`/`cursorEnabled`/`health`/`sandboxOn` injetados.
 */
export function resolveReadTool(
  tool: ReadTool,
  params: { engine?: string; model?: string; effort?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
  has: (e: Engine) => boolean = hasEngine,
  cursorEnabled: boolean = CURSOR_ENABLED,
  health?: Record<string, number>,
  sandboxOn = SANDBOX_ON,
): { engine: Engine; model: string | undefined; effort?: string } {
  const prefix = AUX_TOOL_ENV[tool];
  if (params.engine || env[`${prefix}_ENGINE`]) return resolveAuxTool(tool, params, env, sandboxOn);

  const healthy = (e: Engine): boolean => health === undefined || (health[e] ?? 1) >= HEALTH_THRESHOLD;
  const cascade: Tier[] = cursorEnabled
    ? [...FAST_CANDIDATES, { engine: "cursor", model: DEFAULT_MODEL }]
    : FAST_CANDIDATES;
  const tier = cascade.find((c) =>
    meetsAuxRequirements(tool, c.engine, sandboxOn) && has(c.engine) && healthy(c.engine));
  if (!tier) {
    const req = AUX_TOOL_REQUIREMENTS[tool];
    const need = [req.webSearch ? "web search" : "", req.readOnly && !sandboxOn ? "read-only sem sandbox" : ""]
      .filter(Boolean).join(" + ") || "nenhum requisito extra";
    throw new Error(
      `${tool} não achou engine disponível: exige ${need}, e as que atendem estão ausentes ou ` +
      "unhealthy (cota/falha recente). Tente mais tarde ou passe engine explícita.",
    );
  }
  if (tier.engine === "codex") {
    return {
      engine: "codex",
      model: params.model ?? env[`${prefix}_MODEL`] ?? env.POLYAGENT_EXPLORE_MODEL ?? EXPLORE_MODEL_FALLBACK,
      effort: params.effort ?? env.POLYAGENT_EXPLORE_EFFORT ?? EXPLORE_EFFORT_FALLBACK,
    };
  }
  return { engine: tier.engine, model: params.model ?? tier.model, effort: params.effort ?? tier.effort };
}

/** Cota do plano acabou (trocar de engine resolve) versus throttle transitório (só esperar resolve). */
export type QuotaErrorKind = "quota_exhausted" | "rate_limited";

/** Os três canais de uma falha de processo. O sinal de cota vive em stdout, não em stderr. */
export interface CliFailureOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function stringField(obj: JsonObject | undefined, key: string): string | undefined {
  const value = obj?.[key];
  return typeof value === "string" ? value : undefined;
}

/** Aceita objeto único (grok/claude) ou JSONL (codex); linhas não-JSON são ruído e são puladas. */
function parseJsonObjects(raw: string): JsonObject[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const whole = record(JSON.parse(trimmed));
    if (whole) return [whole];
  } catch { /* pode ser JSONL */ }

  const objects: JsonObject[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const value = record(JSON.parse(line));
      if (value) objects.push(value);
    } catch { /* ruído não JSON */ }
  }
  return objects;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") { out.push(value); return; }
  if (Array.isArray(value)) { for (const item of value) collectStrings(item, out); return; }
  const obj = record(value);
  if (obj) for (const item of Object.values(obj)) collectStrings(item, out);
}

/**
 * Desaninha um JSON serializado DENTRO de uma string. É assim que o grok entrega o sinal: o
 * `http_status` real chega como texto dentro de `errors[0]` ("Internal error: { ... }"), não como
 * campo de primeiro nível — sem desaninhar, o 402 observado em runtime passa despercebido.
 */
function unnestJson(text: string): JsonObject | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return record(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return undefined;
  }
}

/** Todos os http_status visíveis: campo de primeiro nível ou aninhado como texto em qualquer string. */
function httpStatuses(objects: JsonObject[]): number[] {
  const out: number[] = [];
  const strings: string[] = [];
  for (const obj of objects) {
    if (typeof obj.http_status === "number") out.push(obj.http_status);
    collectStrings(obj, strings);
  }
  for (const text of strings) {
    const nested = unnestJson(text);
    if (nested && typeof nested.http_status === "number") out.push(nested.http_status);
  }
  return out;
}

function normalizeErrorText(value: string): string {
  return value.replace(/[‘’]/g, "'").toLowerCase();
}

/**
 * Padrões de cota esgotada por engine. Origem e confiança diferem e isso importa: o grok foi
 * OBSERVADO em runtime (2026-09-13), o codex teve a string confirmada em runtime, e o claude vem
 * só do fonte/binário — ainda sem captura. Nada de regex genérica ("exceeded", "429" solto): um
 * padrão frouxo classifica auth expirado como cota e esconde o remédio real (re-autenticar).
 */
const QUOTA_PATTERNS: Record<Engine, RegExp[]> = {
  codex: [
    /\byou've hit your usage limit\b/,
    /\byour workspace is out of credits\b/,
    /\byou hit your spend cap\b/,
  ],
  grok: [/\bgrok build usage balance exhausted\b/],
  claude: [
    /\busage limit reached\b/,
    /\byou've reached your usage limit\b/,
    /\byou've hit your (?:session|weekly|opus|sonnet) limit\b/,
    /\bspend limit reached\b/,
    /\bcredit balance (?:is )?too low\b/,
  ],
  // Nenhuma captura de cota do opencode foi observada; não classificar por aproximação.
  opencode: [],
  // Captura real em 2026-09-14 (ADENDO 4): provider.auth_error/403 sozinhos NÃO são cota.
  kimi: [/\bmonthly usage limit\b/, /\busage limit for this billing cycle\b/],
  // Nenhuma captura de cota do muse foi observada; não classificar por aproximação.
  muse: [],
  // Nenhuma captura de cota do cursor-agent existe; o que foi observado nele é erro de auth.
  cursor: [],
};

/** Throttle transitório — distinto de cota. A mensagem correspondente pede espera, nunca troca. */
const RATE_LIMIT_PATTERNS: Record<Engine, RegExp[]> = {
  codex: [/\brate limit exceeded\b/],
  grok: [],
  claude: [
    /\bserver is temporarily limiting requests\b/,
    /\brequest rejected \(429\)\b/,
  ],
  opencode: [],
  kimi: [],
  muse: [],
  cursor: [],
};

/**
 * Classifica a causa de uma falha de processo: cota esgotada, rate limit, ou nada (null).
 * Lê primeiro campos JSON estruturados e só depois aplica regex sobre as mensagens de erro
 * extraídas — os CLIs emitem o JSON útil em stdout, e o exit code só distingue sucesso de falha.
 * Um padrão que não casa devolve null e a falha propaga crua: classificar errado é pior que não
 * classificar (ver ADENDO 3 do spike — auth expirado tratado como cota mascarou um bug do bridge).
 * Função pura. Padrões: research/2026-09-14-quota-patterns.md (incluindo os adendos).
 */
export function classifyQuotaError(output: CliFailureOutput, engine: Engine): QuotaErrorKind | null {
  // Guarda contra uma resposta bem-sucedida que apenas mencione essas mensagens.
  if (output.exitCode === 0) return null;

  const objects = parseJsonObjects(output.stdout);
  const serialized = normalizeErrorText(JSON.stringify(objects));
  let structuredRateLimit = false;

  if (engine === "grok") {
    const statuses = httpStatuses(objects);
    if (statuses.includes(402)) return "quota_exhausted";
    if (statuses.includes(429)) structuredRateLimit = true;
    if (serialized.includes("subscription:free-usage-exhausted")) return "quota_exhausted";
  }
  // Campos tipados do codex: ausentes no `exec --json` de hoje, aceitos se uma versão futura os expuser.
  if (engine === "codex") {
    if (/usage_limit_exceeded|quota_exceeded/.test(serialized)) return "quota_exhausted";
    if (/rate_limit_exceeded/.test(serialized)) structuredRateLimit = true;
  }

  const messages: string[] = [output.stderr];
  for (const obj of objects) {
    const nestedError = record(obj.error);
    const payload = record(obj.payload);

    if (engine === "codex") {
      if (obj.type === "error") messages.push(stringField(obj, "message") ?? "");
      if (obj.type === "turn.failed") messages.push(stringField(nestedError, "message") ?? "");
      if (payload?.type === "error") messages.push(stringField(payload, "message") ?? "");
    }

    if (engine === "grok") {
      if (obj.type === "error") messages.push(stringField(obj, "message") ?? "");
      // O JSON headless atual não expõe o -32003 do ACP; aceita se isso voltar.
      if (obj.code === -32003) structuredRateLimit = true;
      if (Array.isArray(obj.errors)) {
        messages.push(...obj.errors.filter((v): v is string => typeof v === "string"));
      }
    }

    if (engine === "claude") {
      const isTerminalError = obj.is_error === true || obj.type === "error";
      if (obj.type === "rate_limit_event" && record(obj.rate_limit_info)?.status === "rejected") {
        return "quota_exhausted";
      }
      // system/api_retry é intermediário; sozinho não é causa terminal.
      if (isTerminalError && obj.api_error_status === 429) structuredRateLimit = true;
      if (stringField(nestedError, "type") === "rate_limit_error") structuredRateLimit = true;
      if (isTerminalError) {
        messages.push(stringField(obj, "result") ?? "", stringField(nestedError, "message") ?? "");
        if (Array.isArray(obj.errors)) {
          messages.push(...obj.errors.filter((v): v is string => typeof v === "string"));
        }
      }
    }
  }
  // Se o processo quebrou antes de emitir JSON válido, ainda permite o fallback textual.
  if (objects.length === 0) messages.push(output.stdout);

  const text = normalizeErrorText(messages.join("\n"));
  if (QUOTA_PATTERNS[engine].some((pattern) => pattern.test(text))) return "quota_exhausted";
  if (structuredRateLimit || RATE_LIMIT_PATTERNS[engine].some((pattern) => pattern.test(text))) {
    return "rate_limited";
  }
  return null;
}

/** As tools que passam por runCursor. Define a FORMA da sugestão no erro de cota. */
export type BridgeTool =
  | AuxTool | "delegate" | "fast_delegate" | "fan_out" | "generate_image" | "follow_up";

/**
 * Erro de cota/rate limit. Nunca dispara retry automático: só a falha de AMBIENTE do codex
 * (isCodexEnvError) entra no FALLBACK_ENGINE_ORDER. Trocar de engine por conta própria diante de
 * cota gastaria a próxima assinatura sem o usuário decidir; diante de rate limit, nem resolveria.
 */
export class QuotaError extends Error {
  constructor(
    readonly kind: QuotaErrorKind,
    readonly engine: Engine,
    message: string,
  ) {
    super(message);
    this.name = "QuotaError";
  }
}

/**
 * Engines que o usuário pode realmente usar depois da cota estourar: instaladas, habilitadas
 * (cursor só sob POLYAGENT_ENABLE_CURSOR) e capazes do que a tool exige — nunca sugerir uma engine
 * que a resolução daquela tool recusaria em seguida. `has`/`cursorEnabled`/`sandboxOn` injetados
 * para teste, mesmo padrão de resolveTier.
 */
export function quotaCandidates(
  tool: BridgeTool | undefined,
  exhausted: Engine,
  has: (e: Engine) => boolean = hasEngine,
  cursorEnabled: boolean = CURSOR_ENABLED,
  sandboxOn: boolean = SANDBOX_ON,
  health?: Record<string, number>,
): Engine[] {
  const isAux = tool !== undefined && tool in AUX_TOOL_REQUIREMENTS;
  const healthy = (e: Engine): boolean => health === undefined || (health[e] ?? 1) >= HEALTH_THRESHOLD;
  const canToolSelect = (engine: Engine): boolean => {
    if (tool === "follow_up") return false;
    if (tool === "fast_delegate") {
      return engine === "cursor" || FAST_CANDIDATES.some((candidate) => candidate.engine === engine);
    }
    if (tool === "fan_out") {
      return engine === "cursor" || Object.values(TIERS).some(({ primary }) => primary.engine === engine);
    }
    return true;
  };
  return ENGINES.filter((engine) => {
    if (engine === exhausted || !has(engine)) return false;
    if (engine === "cursor" && !cursorEnabled) return false;
    // Sugerir engine que também está fora (cota/falha recente) só manda o chamador errar de novo.
    if (!healthy(engine)) return false;
    if (!canToolSelect(engine)) return false;
    // generate_image roda só nas engines com tool de imagem keyless própria (image_gen/grok-build).
    if (tool === "generate_image") return IMAGE_ENGINES.includes(engine);
    return isAux ? meetsAuxRequirements(tool as AuxTool, engine, sandboxOn) : true;
  });
}

/** Engines com tool de imagem própria — as únicas que generate_image sabe usar. */
const IMAGE_ENGINES: Engine[] = ["codex", "grok"];

/** Menor nível do delegate (1-5) cuja engine primária está entre as candidatas. */
function lowestLevelFor(candidates: Engine[]): number | undefined {
  for (const level of Object.keys(TIERS).map(Number).sort((a, b) => a - b)) {
    if (candidates.includes(TIERS[level].primary.engine)) return level;
  }
  return undefined;
}

/**
 * Erro acionável: nomeia a engine que estourou, as que sobraram e COMO trocar — a sugestão segue a
 * superfície da tool (parâmetro `engine` nas auxiliares, `level` no delegate, nenhum onde a tool
 * escolhe sozinha). Rate limit não sugere troca nenhuma: é espera, não engine errada. Função pura.
 */
export function quotaErrorMessage(
  kind: QuotaErrorKind,
  engine: Engine,
  tool: BridgeTool | undefined,
  candidates: Engine[],
): string {
  if (kind === "rate_limited") {
    return `${engine} rate limited — this is a transient throttle, not an exhausted plan quota: ` +
      "wait and retry the same engine. Switching engines does not help here.";
  }
  if (tool === "follow_up") {
    return `${engine} quota exhausted — follow_up is pinned to the engine of the resumed session; ` +
      "start a new call on another engine instead of retrying here.";
  }
  if (candidates.length === 0) {
    return `${engine} quota exhausted — no other engine is available for ${tool ?? "this tool"} ` +
      "(installed, enabled and capable of what this tool requires). " +
      `Top up or switch plans on ${engine}, or install another CLI.`;
  }

  const head = `${engine} quota exhausted — available engines: ${candidates.join(", ")}`;
  if (tool === "delegate") {
    const level = lowestLevelFor(candidates);
    const tierEngines = new Set(Object.values(TIERS).map(({ primary }) => primary.engine));
    const explicit = candidates.find((candidate) => !tierEngines.has(candidate));
    if (level !== undefined && explicit) return `${head} — retry with level:${level} or engine:"${explicit}"`;
    if (level !== undefined) return `${head} — retry with level:${level}`;
    return explicit ? `${head} — retry with engine:"${explicit}"` : head;
  }
  if (tool === "fast_delegate" || tool === "fan_out") {
    return `${head} — this tool picks the engine itself and exposes no engine parameter.`;
  }
  // generate_image tem parâmetro engine, mas só entre codex e grok — a lista já está restrita a essas.
  if (tool === "generate_image") return `${head} — generate_image runs on codex or grok only.`;
  // Sem tool declarada não há superfície conhecida para sugerir — nomeia as engines e para por aí.
  return tool === undefined ? head : `${head} — retry with engine:"${candidates[0]}"`;
}

/** Cria os dirs efêmeros e sonda os paths existentes pra montar o SandboxSpec. */
export function buildSandboxSpec(
  workspace: string,
  engine: Engine,
  workspaceRo = false,
): { spec: SandboxSpec; cleanup: () => void } {
  const home = process.env.HOME ?? homedir();
  const isoHome = mkdtempSync(join(tmpdir(), "cbx-home-"));
  const tmpDir = mkdtempSync(join(tmpdir(), "cbx-tmp-"));
  const abs = (rel: string) => join(home, rel);
  const engineHomeRw = SANDBOX_ENGINE_RW[engine].map(abs);
  // O filtro por existsSync, somado ao ~/.local RO da base, omite estado novo e gera uma falha
  // genérica no CLI; crie antes os subpaths RW da engine para que o bind gravável exista.
  // Dois casos: o PAI sempre (um alvo-arquivo como .credentials.json precisa do diretório-pai,
  // senão o CLI não consegue gravar o arquivo depois); o próprio path só quando não parece
  // arquivo (extname vazio). mkdirSync no .credentials.json criaria um DIRETÓRIO e o CLI
  // falharia ao gravar a credencial ali num host ainda sem login.
  for (const path of engineHomeRw) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      if (extname(path) === "") mkdirSync(path, { recursive: true });
    } catch { /* falha de criação será filtrada abaixo */ }
  }
  const spec: SandboxSpec = {
    home,
    user: process.env.USER ?? userInfo().username,
    path: process.env.PATH ?? "/usr/bin:/bin",
    lang: process.env.LANG ?? "C.UTF-8",
    lcAll: process.env.LC_ALL ?? "C.UTF-8",
    isoHome,
    tmpDir,
    workspace,
    workspaceRo,
    systemRo: SANDBOX_SYSTEM_RO.filter((p) => existsSync(p)),
    // base (toolchains + cursor auth) + os subpaths RO específicos do engine (auth/libs do CLI)
    homeRo: [...SANDBOX_HOME_RO, ...SANDBOX_ENGINE_RO[engine]].map(abs).filter((p) => existsSync(p)),
    homeRw: [
      ...SANDBOX_HOME_RW.map(abs),
      ...engineHomeRw,
      // Apps externos (ex.: orca) roteiam múltiplas contas do codex setando CODEX_HOME pra fora do
      // ~/.codex bindado acima. Sem isso, o sandbox esconde a conta ativa (isoHome cobre $HOME) e o
      // codex falha ao inicializar (CODEX_HOME inexistente, ou "Read-only file system" — ver
      // isCodexEnvError). Só o engine codex precisa enxergá-lo, e só se o path existir de fato.
      ...(engine === "codex" && process.env.CODEX_HOME ? [process.env.CODEX_HOME] : []),
    ].filter((p) => existsSync(p)),
    // só os que existem e não são o próprio workspace (esse já é o último bind)
    extraBinds: SANDBOX_EXTRA.filter((p) => p !== workspace && existsSync(p)),
    extraEnv: SANDBOX_PROXY_ENV
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k] as string]),
  };
  const cleanup = () => {
    try { rmSync(isoHome, { recursive: true, force: true }); } catch { /* efêmero */ }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* efêmero */ }
  };
  return { spec, cleanup };
}

export interface RunOpts {
  prompt: string;
  /** Qual CLI usar. Default "cursor". Cada engine tem dialeto e parser próprios. */
  engine?: Engine;
  model?: string;
  effort?: string;
  resume?: string;
  /** read-only mode para discovery/analyze: "plan" | "ask". No codex vira `-s read-only`. */
  mode?: "plan" | "ask";
  /**
   * Habilita a busca web da engine (codex: `-c tools.web_search=true`). Usado por web_lookup.
   * O claude não precisa de flag: o WebSearch nativo do `claude -p` já vem ligado.
   */
  web?: boolean;
  /** Auto-aprova as tools deste run (--force), independente do env global. web_lookup precisa. */
  force?: boolean;
  cwd?: string;
  /** Timeout deste run (ms). Sobrepõe DEFAULT_TIMEOUT_MS — tarefas que rodam build precisam de mais. */
  timeoutMs?: number;
  /** Imagens de entrada anexadas ao prompt (codex -i). Usado por generate_image para edição. */
  images?: string[];
  /**
   * Persona/system-prompt de um agent especializado, injetada pelo canal aditivo de cada engine
   * (claude --append-system-prompt, grok --rules, codex -c developer_instructions,
   * cursor/opencode/kimi/muse prefixo).
   * Resolvida no host por resolveAgent (src/agents.ts). Cross-engine — não é exclusiva do claude.
   */
  agentPrompt?: string;
  /**
   * Tool que originou o run. Não muda a execução: define a forma da sugestão no erro de cota
   * (parâmetro `engine` nas auxiliares, `level` no delegate, nenhuma onde a tool escolhe sozinha).
   */
  tool?: BridgeTool;
  /**
   * Saúde das engines no momento da chamada. Também não muda a execução: só tira do erro de cota
   * as engines unhealthy, pra não sugerir trocar por outra que também está fora.
   */
  health?: Record<string, number>;
}

/**
 * Always-on terse-style addendum injected into every worker's native additive system-prompt
 * channel (agentPrompt) to reduce output token cost — the project's core context-economy goal.
 * LITE intensity: keeps articles/full sentences, drops filler/hedging/narration.
 */
export const TERSE_STYLE = [
  "Reply tersely: drop filler, hedging, pleasantries, and narration of what you are about to do",
  "before doing it. Fragments are fine. Short synonyms over long phrasing. Keep ALL technical",
  "substance verbatim — code blocks, function/API names, CLI commands, exact error strings. No",
  "emoji, no decorative tables. Never announce or name this style. For security warnings or",
  "irreversible-action confirmations, answer normally then resume terseness.",
].join(" ");

/** Prepends TERSE_STYLE to an optional existing agent persona prompt. */
export function withTerseStyle(agentPrompt?: string): string {
  return agentPrompt ? `${TERSE_STYLE}\n\n${agentPrompt}` : TERSE_STYLE;
}

/** Codifica uma string como TOML basic string (aspas + escapes) para `-c key=value` do codex. */
export function tomlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "")}"`;
}

/**
 * Resolve o nome do modelo. `effort` só vira bracket em modelos parametrizados —
 * `auto` ignora effort (não aceita override). Função pura para teste.
 * @example resolveModel("gpt-5.2", "high") // "gpt-5.2[effort=high]"
 * @example resolveModel(undefined, "high") // "auto"
 */
export function resolveModel(model?: string, effort?: string): string {
  const base = model ?? DEFAULT_MODEL;
  if (effort && base !== "auto") return `${base}[effort=${effort}]`;
  return base;
}

/**
 * Monta os argumentos do `agent -p`. Função pura — isolada para teste.
 */
export function buildCursorArgs(opts: RunOpts): string[] {
  const args = ["-p", "--output-format", "json", "--trust", "--model", resolveModel(opts.model, opts.effort)];
  if (opts.mode) args.push("--mode", opts.mode);
  if (opts.resume) args.push("--resume", opts.resume);
  if (FORCE || opts.force) args.push("--force");
  // cursor-agent não tem canal de system-prompt aditivo; a persona vai como prefixo do prompt (fallback).
  args.push(opts.agentPrompt ? `${opts.agentPrompt}\n\n---\n\n${opts.prompt}` : opts.prompt);
  return args;
}

/**
 * Args do Grok CLI (`grok`). Dialeto próprio: prompt é VALOR de `--single`, effort é flag separada
 * (`--effort` — o xAI CLI atual renomeou `--reasoning-effort` → `--effort`), autonomia é
 * `--always-approve` (não `--force`). Função pura — testável.
 */
export function buildGrokArgs(opts: RunOpts): string[] {
  const args = ["--single", opts.prompt, "--output-format", "json"];
  if (opts.model) args.push("-m", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.agentPrompt) args.push("--rules", opts.agentPrompt); // canal aditivo de system prompt do grok
  args.push("--always-approve");
  if (opts.resume) args.push("-r", opts.resume);
  return args;
}

/**
 * Args do Codex CLI (`codex exec`). Dialeto próprio: subcomando `exec`, saída JSONL (`--json`),
 * effort via config override (`-c model_reasoning_effort=...`), autonomia via bypass. Função pura.
 */
export function buildCodexArgs(opts: RunOpts, sandboxed = false): string[] {
  // --ignore-user-config: NÃO carrega ~/.codex/config.toml (que traz MCP servers externos — o codex
  // pendurava tentando conectá-los até timeout, subindo N processos). --ignore-rules: idem para .rules.
  // Auth continua via CODEX_HOME. Isso complementa o sandbox (defense-in-depth).
  const flags = ["--json", "--ignore-user-config", "--ignore-rules"];
  // read-only (explore/read_slice/web_lookup). Se o cursor-bridge JÁ envolve o codex em bwrap
  // (`sandboxed`), o read-only vem do `--ro-bind` do workspace (buildSandboxArgs): usar o sandbox
  // INTERNO do codex (`-s read-only`) aninharia um namespace DENTRO do bwrap e quebra com
  // "bwrap: No permissions to create new namespace". Então bypass o sandbox do codex e confia no
  // bwrap externo. SEM bwrap externo (sandbox off), usa o `-s read-only` do codex (não há o que
  // aninhar). Sem mode (delegate/generate_image) → bypass total.
  if (opts.mode && !sandboxed) flags.push("-s", "read-only", "-c", 'approval_policy="never"');
  else flags.push("--dangerously-bypass-approvals-and-sandbox");
  if (opts.web) flags.push("-c", "tools.web_search=true"); // busca web (web_lookup)
  if (opts.model) flags.push("-m", opts.model);
  if (opts.effort) flags.push("-c", `model_reasoning_effort="${opts.effort}"`);
  // persona aditiva do codex: developer_instructions (developer-role), TOML-encoded. NÃO usamos
  // AGENTS.md nem model_instructions_file (esse último SUBSTITUI as instruções do codex).
  if (opts.agentPrompt) flags.push("-c", `developer_instructions=${tomlString(opts.agentPrompt)}`);
  if (opts.images?.length) {
    for (const file of opts.images) flags.push("-i", file);
  }
  // -i/--image é variádico (`<FILE>...`): sem o terminador `--`, o clap engole o prompt posicional
  // como se fosse mais um arquivo e o codex cai no stdin (fechado) → "No prompt provided via stdin".
  const sep = opts.images?.length ? ["--"] : [];
  // resume é subcomando próprio: `codex exec resume [OPTIONS] <id> <prompt>` (id e prompt posicionais).
  if (opts.resume) return ["exec", "resume", ...flags, ...sep, opts.resume, opts.prompt];
  return ["exec", ...flags, ...sep, opts.prompt];
}

/** Valida o formato exigido pelo OpenCode: o id sempre inclui o provider antes de `/`. */
function assertOpencodeModel(model: string): void {
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    throw new Error(
      `invalid model: received ${JSON.stringify(model)}, expected "provider/model" ` +
      `(e.g. "google/gemini-3.8-flash")`,
    );
  }
}

/**
 * Args do OpenCode CLI (`opencode run`). Dialeto próprio: prompt posicional, JSONL via
 * `--format json`, modelo com provider, variant como effort, e sessão via `-s`. A persona
 * resolvida no host é injetada apenas como prefixo do prompt,
 * porque o CLI não oferece um canal aditivo de system prompt. Função pura.
 */
export function buildOpencodeArgs(opts: RunOpts): string[] {
  if (opts.model !== undefined) assertOpencodeModel(opts.model);
  const args = ["run", "--format", "json"];
  if (opts.model !== undefined) args.push("-m", opts.model);
  if (opts.effort) args.push("--variant", opts.effort);
  if (opts.resume) args.push("-s", opts.resume);
  // Em headless, mode também precisa de auto-aprovação; o read-only real continua no bwrap.
  if (FORCE || opts.force || opts.mode) args.push("--auto");
  if (opts.cwd) args.push("--dir", opts.cwd);
  args.push("--", opts.agentPrompt ? `${opts.agentPrompt}\n\n---\n\n${opts.prompt}` : opts.prompt);
  return args;
}

/**
 * Args do Kimi CLI. Dialeto confirmado no host para o prompt headless, stream-json, modelo e
 * resume. O prompt já é não-interativo; o Kimi não oferece flag de system prompt aditivo, então a
 * persona resolvida no host entra como prefixo do prompt. `--add-dir` disponibiliza o workspace
 * explicitamente quando o caller fornece cwd. Função pura — testável.
 */
export function buildKimiArgs(opts: RunOpts): string[] {
  const prompt = opts.agentPrompt ? `${opts.agentPrompt}\n\n---\n\n${opts.prompt}` : opts.prompt;
  const args = ["-p", prompt, "--output-format", "stream-json"];
  // No host, os aliases precisam do prefixo kimi-code/ e existir em config.toml; a CLI recusa
  // nomes não configurados. Passar cru: o config do usuário define aliases, não uma regra fixa.
  if (opts.model) args.push("-m", opts.model);
  if (opts.resume) args.push("-S", opts.resume);
  // -p já é não-interativo e RECUSA autonomia, mesmo com force/mode:
  // "error: Cannot combine --prompt with --auto."
  // "error: Cannot combine --prompt with --yolo."
  // Não emitir --auto/-y/--yolo; o read-only de mode continua garantido pelo bwrap.
  if (opts.cwd) args.push("--add-dir", opts.cwd);
  return args;
}

/**
 * Args do Muse CLI (`muse exec`). Dialeto confirmado no host: prompt posicional, JSONL via
 * `--json`, modelo/effort/resume por flag, autonomia via `--approval-mode never`. NÃO usar
 * `--yolo`: ele desliga o sandbox interno do muse além do approval, e o bwrap já cobre o
 * isolamento. `--agents` existe na CLI, mas o JSON não foi confirmado — persona entra só
 * como prefixo do prompt, igual a cursor/opencode. Função pura — testável.
 */
export function buildMuseArgs(opts: RunOpts): string[] {
  const prompt = opts.agentPrompt ? `${opts.agentPrompt}\n\n---\n\n${opts.prompt}` : opts.prompt;
  const args = ["exec", "--json"];
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--reasoning-effort", opts.effort);
  if (opts.resume) args.push("--session-id", opts.resume);
  // Headless trava no default on-request. force OU mode precisam de auto-aprovação;
  // o read-only de mode continua no bwrap (muse não tem -s read-only).
  if (FORCE || opts.force || opts.mode) args.push("--approval-mode", "never");
  // Prompt posicional por último, depois de `--`, para não ser lido como valor de flag.
  args.push("--", prompt);
  return args;
}

/**
 * Args do Claude Code CLI (`claude -p`). Dialeto próprio: `--print` headless, prompt posicional,
 * autonomia via `--dangerously-skip-permissions`, resume via `--resume <id>`. Saída `--output-format
 * json` tem a forma `{result, session_id}` (mesma do cursor → parseCliJson).
 *
 * NÃO usar `--bare`: ele quebra a resolução de auth (a CLI retorna "Not logged in"). Em vez disso
 * isolamos a config do usuário como o sandbox faz para os outros engines: `--strict-mcp-config` (sem
 * `--mcp-config` → ZERO MCP servers, o codex/cursor não sobem os MCP do user e o claude também não) e
 * `--setting-sources project` (ignora ~/.claude/settings, o HOME isolado do sandbox já está vazio).
 * Função pura — testável.
 */
export function buildClaudeArgs(opts: RunOpts): string[] {
  const args = [
    "-p", "--output-format", "json",
    "--strict-mcp-config",
    "--setting-sources", "project",
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.agentPrompt) args.push("--append-system-prompt", opts.agentPrompt); // canal nativo do claude
  // Headless PRECISA auto-aprovar ou pendura esperando confirmação (inclusive `--permission-mode plan`,
  // que trava pedindo aprovação do plano). force (delegate) e mode read-only rodam não-interativos →
  // skip-permissions. O read-only "duro" do mode fica com o codex (-s read-only); no claude ele é
  // read-only por prompt + sandbox (o worker é instruído a não editar e o sandbox contém o raio ao cwd).
  if (FORCE || opts.force || opts.mode) args.push("--dangerously-skip-permissions");
  if (opts.resume) args.push("--resume", opts.resume);
  args.push(opts.prompt);
  return args;
}

/** Despacha a montagem de args pelo engine. `sandboxed` = o bridge vai envolver em bwrap (afeta codex). */
export function buildArgs(engine: Engine, opts: RunOpts, sandboxed = false): string[] {
  if (engine === "grok") return buildGrokArgs(opts);
  if (engine === "codex") return buildCodexArgs(opts, sandboxed);
  if (engine === "claude") return buildClaudeArgs(opts);
  if (engine === "opencode") return buildOpencodeArgs(opts);
  if (engine === "kimi") return buildKimiArgs(opts);
  if (engine === "muse") return buildMuseArgs(opts);
  return buildCursorArgs(opts);
}

export interface CliResult {
  text: string;
  sessionId?: string;
  engine?: Engine;
}

/**
 * Extrai texto e session id do JSON headless. Tolerante aos dois dialetos de objeto único:
 * cursor (`{result, session_id}`) e grok (`{text, sessionId}`). Degrada para texto cru.
 */
export function parseCliJson(raw: string): CliResult {
  const trimmed = raw.trim();
  try {
    const obj = JSON.parse(trimmed) as {
      result?: unknown; text?: unknown; session_id?: unknown; sessionId?: unknown;
    };
    const text = typeof obj.result === "string" ? obj.result
      : typeof obj.text === "string" ? obj.text : trimmed;
    const sessionId = typeof obj.session_id === "string" ? obj.session_id
      : typeof obj.sessionId === "string" ? obj.sessionId : undefined;
    return { text, sessionId };
  } catch {
    return { text: trimmed };
  }
}

/**
 * Parser do Codex `exec --json`: stdout é JSONL de eventos (com ruído de log entremeado). A resposta
 * final é o último evento `item.completed` cujo `item.type === "agent_message"`. Best-effort: linhas
 * não-JSON são ignoradas, nunca lança.
 */
export function parseCodexJsonl(raw: string): CliResult {
  let text = "";
  let sessionId: string | undefined;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const ev = JSON.parse(t) as {
        item?: { type?: unknown; text?: unknown }; session_id?: unknown; thread_id?: unknown;
      };
      if (ev.item?.type === "agent_message" && typeof ev.item.text === "string") text = ev.item.text;
      // o codex emite o id como `thread_id` no evento `thread.started`; `session_id` fica de fallback
      if (typeof ev.session_id === "string") sessionId = ev.session_id;
      else if (typeof ev.thread_id === "string") sessionId = ev.thread_id;
    } catch { /* linha de log não-JSON — ignora */ }
  }
  return { text: text || raw.trim(), sessionId };
}

/**
 * Parser do OpenCode `run --format json`: cada linha é um evento, e os eventos `text` carregam a
 * resposta em `part.text`. Best-effort: ruído e linhas malformadas são ignorados; sem evento de
 * texto, o stdout cru é devolvido para não perder diagnóstico.
 */
export function parseOpencodeJsonl(raw: string): CliResult {
  let text = "";
  let sessionId: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = record(JSON.parse(trimmed));
      if (!event) continue;
      const part = record(event.part);
      const payload = record(event.payload);
      const properties = record(event.properties);
      const nested = [part, payload, properties];
      const ids = [event, ...nested]
        .map((obj) => stringField(obj, "sessionID") ?? stringField(obj, "sessionId") ?? stringField(obj, "session_id"))
        .filter((id): id is string => id !== undefined);
      if (!sessionId && ids.length) sessionId = ids[0];

      const type = stringField(event, "type");
      const partType = stringField(part, "type");
      const isTextEvent = type === "text" || type === "message.delta" || type === "text.delta" || partType === "text";
      if (!isTextEvent) continue;
      const chunk = stringField(part, "text")
        ?? stringField(event, "text")
        ?? stringField(event, "delta")
        ?? stringField(payload, "text")
        ?? stringField(payload, "delta")
        ?? stringField(properties, "text");
      if (chunk !== undefined) text += chunk;
    } catch { /* linha malformada — mantém o melhor resultado já extraído */ }
  }
  return { text: text || raw.trim(), sessionId };
}

interface KimiTextEvent {
  text: string;
  final: boolean;
}

function kimiEventType(obj: JsonObject): string | undefined {
  for (const key of ["type", "event", "kind", "name"]) {
    const value = stringField(obj, key);
    if (value) return value.toLowerCase();
  }
  return undefined;
}

function kimiSessionId(value: unknown, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  const obj = record(value);
  if (!obj) return undefined;

  for (const key of ["session_id", "sessionId", "sessionID"]) {
    const id = stringField(obj, key);
    if (id) return id;
  }

  const type = kimiEventType(obj);
  if (type?.includes("session")) {
    const id = stringField(obj, "id");
    if (id) return id;
  }

  const session = obj.session;
  if (typeof session === "string" && session) return session;

  for (const key of ["session", "data", "payload", "event", "message"]) {
    const id = kimiSessionId(obj[key], depth + 1);
    if (id) return id;
  }
  return undefined;
}

function kimiIsNonAssistant(role: string | undefined, type: string | undefined): boolean {
  if (role && role !== "assistant") return true;
  return type !== undefined && /^(?:user|system|tool|tool[_-]|thinking|reasoning|approval|error)/.test(type);
}

function kimiTextFromValue(
  value: unknown,
  key: string,
  role?: string,
  type?: string,
  depth = 0,
): string {
  if (depth > 8 || kimiIsNonAssistant(role, type)) return "";

  if (typeof value === "string") {
    const normalizedKey = key.toLowerCase().replace(/-/g, "_");
    const directTextKey = ["text", "output_text", "result", "delta", "content"].includes(normalizedKey);
    const auxiliaryTextKey = ["data", "value", "output"].includes(normalizedKey)
      && (type === undefined || /assistant|content|delta|message|text/.test(type));
    const messageText = normalizedKey === "message"
      && (role === "assistant" || type === undefined || /assistant|content|message|result|text/.test(type));
    return directTextKey || auxiliaryTextKey || messageText ? value : "";
  }

  if (Array.isArray(value)) {
    return value.map((item) => kimiTextFromValue(item, key, role, type, depth + 1)).join("");
  }

  const obj = record(value);
  if (!obj) return "";
  const ownRole = stringField(obj, "role")?.toLowerCase();
  const ownType = kimiEventType(obj);
  const nextRole = ownRole ?? role;
  const nextType = ownType ?? type;
  if (kimiIsNonAssistant(nextRole, nextType)) return "";

  for (const childKey of ["text", "output_text", "result", "delta", "content", "message", "data", "output", "payload", "event"]) {
    if (obj[childKey] === undefined) continue;
    const text = kimiTextFromValue(obj[childKey], childKey, nextRole, nextType, depth + 1);
    if (text) return text;
  }
  return "";
}

function kimiFinalText(value: unknown, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  const obj = record(value);
  if (!obj) return undefined;
  const type = kimiEventType(obj);
  if (typeof obj.result === "string" && (!type || /result|complete|finish|final|done/.test(type))) {
    return obj.result;
  }
  for (const key of ["data", "output", "payload", "event", "message"]) {
    const nested = kimiFinalText(obj[key], depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function parseKimiEvent(event: JsonObject): KimiTextEvent {
  const final = kimiFinalText(event);
  if (final !== undefined) return { text: final, final: true };
  return { text: kimiTextFromValue(event, "event"), final: false };
}

/**
 * Parser do Kimi `--output-format stream-json`. Só system.version (role meta) foi observado no
 * host; texto/session id ainda não foram confirmados. Aceitamos variantes e mantemos o
 * comportamento best-effort: linha malformada nunca interrompe o resultado.
 */
export function parseKimiJsonl(raw: string): CliResult {
  let text = "";
  let finalText: string | undefined;
  let sessionId: string | undefined;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = record(JSON.parse(trimmed));
      if (!event) continue;
      sessionId ??= kimiSessionId(event);
      const parsed = parseKimiEvent(event);
      if (parsed.final) finalText = parsed.text;
      else text += parsed.text;
    } catch { /* linha malformada — preserva o melhor resultado já extraído */ }
  }

  return { text: finalText !== undefined ? finalText : text || raw.trim(), sessionId };
}

/** Nome alternativo explícito para callers que preferem o nome do formato de saída. */
export const parseKimiStreamJson = parseKimiJsonl;

/**
 * Parser do Muse `exec --json`: cada linha é um evento com `payload_type` e `stream`.
 * Texto vive em deltas `run.output.delta` (`payload.text`) — concatenar na ordem.
 * Session id vive em `stream.id` quando `stream.kind === "session"`.
 * `turn.input.user` é o prompt, não a resposta — ignorar. Best-effort: linha malformada
 * nunca lança; sem delta, devolve o stdout cru.
 */
export function parseMuseJsonl(raw: string): CliResult {
  let text = "";
  let sessionId: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = record(JSON.parse(trimmed));
      if (!event) continue;

      const stream = record(event.stream);
      if (stringField(stream, "kind") === "session") {
        const id = stringField(stream, "id");
        if (id) sessionId ??= id;
      }

      const payloadType = stringField(event, "payload_type");
      if (payloadType === "turn.input.user") continue;
      if (payloadType !== "run.output.delta") continue;
      const chunk = stringField(record(event.payload), "text");
      if (chunk !== undefined) text += chunk;
    } catch { /* linha malformada — preserva o melhor resultado já extraído */ }
  }
  return { text: text || raw.trim(), sessionId };
}

/** Despacha o parse de saída pelo engine. */
export function parseOutput(engine: Engine, raw: string): CliResult {
  if (engine === "codex") return parseCodexJsonl(raw);
  if (engine === "opencode") return parseOpencodeJsonl(raw);
  if (engine === "kimi") return parseKimiJsonl(raw);
  if (engine === "muse") return parseMuseJsonl(raw);
  return parseCliJson(raw);
}

/** true se `bin` é um path existente ou um nome encontrável no PATH. */
export function binExists(bin: string): boolean {
  if (bin.includes("/")) return existsSync(bin);
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir && existsSync(join(dir, bin))) return true;
  }
  return false;
}

/** true se o CLI do engine está instalado. cursor é sempre assumido presente. */
export function hasEngine(engine: Engine): boolean {
  if (engine === "cursor") return true;
  if (engine === "grok") return binExists(GROK_BIN);
  if (engine === "codex") return binExists(CODEX_BIN);
  if (engine === "claude") return binExists(CLAUDE_BIN);
  if (engine === "opencode") return binExists(OPENCODE_BIN);
  if (engine === "kimi") return binExists(KIMI_BIN);
  return binExists(MUSE_BIN);
}

export interface Tier {
  engine: Engine;
  model: string;
  effort?: string;
}

/** Entrada da matriz de tiers: engine/modelo preferido + o id equivalente no cursor (fallback). */
interface TierEntry {
  primary: Tier;
  /** Modelo cursor-agent equivalente, usado só quando CURSOR_ENABLED e a engine preferida falta. */
  cursorModel: string;
}

/**
 * Matriz do `delegate`: decisão do dono com dados Artificial Analysis de 2026-09-24/25 — ver
 * research/2026-09-24-custo-por-tarefa.md (substitui o nível 4 de 2026-09-23-tier-pareto.md).
 * Escada $0,07 → $0,37 (~5×) → $1,06 (~3×) → $1,82 (~1,7×) → $5,98 (~3,3×),
 * como proxy de cota. Tudo por assinatura (codex/claude): pay-per-token fica fora de propósito.
 * Em 2026-09-24, Opus 5.5 high substitui Astra max: índice geral 54 vs. 53, custo 44% menor.
 * O motivo de 2026-09-23 para manter Astra (topo medido em código) caducou: Opus 5.5 max
 * tem 66 vs. 62. Ainda NÃO há índice de código de Opus high; reavaliar com AA e rate.
 * Grok 4.6 saiu em 2026-09-23 (mesma nota do Sol xhigh a 3,5× o custo).
 * Cota aceita: codex concentra 3 de 5 níveis (1-3); claude concentra 4-5 e compartilha a
 * assinatura do host Claude Code — esgotá-la derruba os dois níveis e o host juntos.
 * O cursor saiu do caminho padrão (assinatura cancelada) — fallback só sob CURSOR_ENABLED.
 * Leitura barata (explore/read_slice) reaproveita o modelo do nível 1.
 */
const TIERS: Record<number, TierEntry> = {
  1: { primary: { engine: "codex", model: "gpt-6-luna", effort: "max" }, cursorModel: "gpt-5.6-luna-max-fast" },
  2: { primary: { engine: "codex", model: "gpt-6-sol", effort: "high" }, cursorModel: "gpt-5.6-sol-xhigh-fast" },
  3: { primary: { engine: "codex", model: "gpt-6-sol", effort: "max" }, cursorModel: "grok-4.6-high-fast" },
  // IDs primários confirmados em execução real: gpt-6-luna, gpt-6-sol e claude-opus-5-5
  // (2026-09-23, Opus com max); gpt-6-astra (2026-09-14, histórico). Opus com effort high
  // confirmado em 2026-09-26 (modelUsage = claude-opus-5-5). O alias `opus` ainda resolve
  // para o claude-opus-5 antigo — use sempre o id completo claude-opus-5-5.
  // Os cursorModel NÃO acompanham o refresh: o cursor é legado (assinatura cancelada) e os ids
  // dele ficaram como estavam — deduzidos do padrão dos vizinhos, nunca verificados.
  4: { primary: { engine: "claude", model: "claude-opus-5-5", effort: "high" }, cursorModel: "gpt-6-astra-max-fast" },
  5: { primary: { engine: "claude", model: "claude-opus-5-5", effort: "max" }, cursorModel: "claude-fable-max-fast" },
};

/**
 * Health mínimo (0-1) pra considerar uma engine viável num tier. Abaixo disso, trata como indisponível.
 * Exportado só pra teste: um teste de invariante em test/usage.test.ts prova que LATENCY_FLOOR
 * (src/usage.ts) fica acima disso, senão latência sozinha (sem nenhuma falha) volta a derrubar uma
 * engine — era exatamente o bug original.
 */
export const HEALTH_THRESHOLD = 0.3;

/**
 * Ordem de velocidade do fast_delegate (primeiro instalado E saudável vence).
 *
 * Medição histórica anterior, no host pelo caminho real (`runCursor`, sandbox ligado), mesmo
 * prompt de saída longa, 2 execuções por candidato:
 *   opencode openrouter/inception/mercury-2  7006ms  (7885, 6126) — mais rápido e consistente
 *   claude haiku                             10736ms (11330, 10141) — consistente
 *   grok grok-4.5 low                        16301ms
 *   codex gpt-6-luna low                     NÃO MEDIDO (cota esgotada)
 * Descartados: gemini-flash-lite-latest (18519ms, instável, outlier 30s);
 * openrouter/openai/gpt-oss-120b (19251ms); groq/openai/gpt-oss-120b (timeout 120s + resposta errada).
 *
 * Bench atualizado em 2026-09-23 (`research/2026-09-23-aux-tools-bench.md`), com 40 execuções
 * reais via `runCursor` + bwrap:
 *   codex gpt-6-luna medium  8/8  mediana 10,8s  pior 13,1s
 *   codex gpt-6-luna low     8/8  mediana 11,8s  pior 15,4s
 *   claude haiku low         6/6  mediana 10,4s  pior 13,7s
 *   opencode mercury-2       5/6  mediana 14,8s  pior 240s (timeout)
 *   grok grok-4.5 low        sem cota nas 6 rodadas
 * Medium manteve a velocidade do low e teve nota maior; Haiku foi o mais estável fora do codex.
 * A cauda de latência do mercury-2 justifica deixá-lo depois das duas assinaturas.
 *
 * CUSTO: os dois primeiros candidatos são assinatura (codex e claude). O 2º usa a assinatura
 * Claude do mesmo host que orquestra via Claude Code — custo aceito para manter uma saída estável
 * fora do codex. O 3º é pay-per-token (API key do OpenRouter / mercury-2) e só gasta quando codex
 * e claude estão ausentes, sem cota ou unhealthy. Grok também é assinatura; cursor só entra como
 * fallback final, igual ao resolveTier.
 *
 * Consequências do opencode como 3º candidato:
 * - `QUOTA_PATTERNS.opencode` está vazio (nenhuma captura de cota foi observada, e o
 *   projeto não classifica por aproximação). Como este é o único candidato que gasta
 *   crédito, 'acabou o saldo' é o modo de falha que propaga erro cru em vez da
 *   mensagem acionável — agora só no fallback, depois que codex e claude já falharam.
 *   Autocura só parcial: as falhas derrubam o health e a seleção acaba caindo pro grok,
 *   mas depois de N erros ilegíveis. Fechar isso exige capturar
 *   um 402/insufficient-credits real do OpenRouter — não inventar regex.
 * - `hasEngine("opencode")` só prova que o binário existe, não que há provider
 *   configurado nem crédito. Num host com opencode instalado e OpenRouter ausente,
 *   o fast_delegate só erra nessa 3ª escolha quando codex e claude já não estavam disponíveis.
 */
export const FAST_CANDIDATES: Tier[] = [
  { engine: "codex", model: "gpt-6-luna", effort: "medium" },
  // effort low no haiku é consistência com os vizinhos, não ganho: medido em 10100ms sem
  // effort contra 10125ms com low (2 runs cada) — diferença dentro do ruído.
  { engine: "claude", model: "haiku", effort: "low" },
  { engine: "opencode", model: "openrouter/inception/mercury-2" },
  { engine: "grok", model: "grok-4.5", effort: "low" },
];

/**
 * Resolve a engine mais rápida instalada E saudável, sem nível — primeira candidata de
 * FAST_CANDIDATES que passar em has()+healthy(). Cai pro cursor-agent (DEFAULT_MODEL) só quando
 * nenhuma engine nativa está disponível/saudável E cursorEnabled; senão lança erro claro listando
 * o que falta. `has`/`cursorEnabled`/`health` são injetados para teste, mesmo padrão de resolveTier.
 */
export function resolveFastTier(
  has: (e: Engine) => boolean = hasEngine,
  cursorEnabled: boolean = CURSOR_ENABLED,
  health?: Record<string, number>,
): Tier {
  const healthy = (e: Engine): boolean => health === undefined || (health[e] ?? 1) >= HEALTH_THRESHOLD;
  for (const candidate of FAST_CANDIDATES) {
    if (has(candidate.engine) && healthy(candidate.engine)) return candidate;
  }
  if (cursorEnabled && healthy("cursor")) return { engine: "cursor", model: DEFAULT_MODEL };
  const anyInstalled = FAST_CANDIDATES.some((c) => has(c.engine));
  const reason = anyInstalled
    ? "they are installed but unhealthy (recent failures/timeouts) — retry later or use delegate with an explicit level"
    : "none of them is installed";
  const cursorNote = cursorEnabled
    ? " The cursor-agent fallback is also unhealthy."
    : " Set POLYAGENT_ENABLE_CURSOR=1 to fall back to cursor-agent.";
  throw new Error(
    `fast_delegate needs at least one healthy CLI among codex, opencode, claude, or grok, but ${reason}.${cursorNote}`,
  );
}

/**
 * Roteia o nível (1-5) para (engine, modelo, effort). Usa a engine preferida do nível se instalada
 * E saudável (quando `health` é passado — ver computeEngineHealth em src/usage.ts). Se faltar ou
 * estiver unhealthy: cai para o cursor-agent equivalente SÓ quando CURSOR_ENABLED E o próprio cursor
 * está saudável; senão lança erro claro. `has`/`cursorEnabled`/`health` são injetados para teste.
 * `health` omitido preserva o comportamento anterior (toda engine é tratada como saudável).
 */
export function resolveTier(
  level: number,
  has: (e: Engine) => boolean = hasEngine,
  cursorEnabled: boolean = CURSOR_ENABLED,
  health?: Record<string, number>,
): Tier {
  const entry = TIERS[level];
  if (!entry) throw new Error(`invalid delegate level: received ${level}, expected integer 1-5`);
  const healthy = (e: Engine): boolean => health === undefined || (health[e] ?? 1) >= HEALTH_THRESHOLD;
  if (has(entry.primary.engine) && healthy(entry.primary.engine)) return entry.primary;
  if (cursorEnabled && healthy("cursor")) return { engine: "cursor", model: entry.cursorModel };
  const reason = has(entry.primary.engine) ? "is unhealthy (recent failures/timeouts)" : "is not installed";
  throw new Error(
    `delegate level ${level} needs the '${entry.primary.engine}' CLI, which ${reason}. ` +
    "Install it, pick another level, or set POLYAGENT_ENABLE_CURSOR=1 to fall back to cursor-agent.",
  );
}

export interface DelegateResolution {
  engine: Engine;
  model: string | undefined;
  effort: string | undefined;
}

/**
 * Resolve o delegate respeitando um override explícito de engine. Sem override, mantém o
 * roteamento/health de `resolveTier`; com override diferente da engine primária do nível, só
 * model/effort fornecidos pelo caller atravessam — cada CLI usa seu próprio default. Função pura.
 */
export function resolveDelegate(
  level: number,
  params: { engine?: string; model?: string; effort?: string } = {},
  has: (e: Engine) => boolean = hasEngine,
  cursorEnabled: boolean = CURSOR_ENABLED,
  health?: Record<string, number>,
): DelegateResolution {
  const entry = TIERS[level];
  if (!entry) throw new Error(`invalid delegate level: received ${level}, expected integer 1-5`);

  if (params.engine !== undefined) {
    const engine = parseEngine(params.engine, "parâmetro engine de delegate");
    if (engine === "cursor" && !cursorEnabled) {
      throw new Error(
        `delegate level ${level} needs the 'cursor' CLI, which is disabled. ` +
        "Set POLYAGENT_ENABLE_CURSOR=1 to enable cursor-agent, or pick another engine.",
      );
    }
    if (!has(engine)) {
      throw new Error(
        `delegate level ${level} needs the '${engine}' CLI, which is not installed. ` +
        "Install it or pick another engine.",
      );
    }
    const sameAsPrimary = engine === entry.primary.engine;
    return {
      engine,
      model: params.model ?? (sameAsPrimary ? entry.primary.model : undefined),
      effort: params.effort ?? (sameAsPrimary ? entry.primary.effort : undefined),
    };
  }

  const tier = resolveTier(level, has, cursorEnabled, health);
  return {
    engine: tier.engine,
    model: params.model ?? tier.model,
    effort: params.effort ?? tier.effort,
  };
}

/**
 * Tier-integrity receipt: true se `engine` é a engine PADRÃO (preferida) do nível — false quando
 * resolveTier caiu no fallback (ex.: cursor) ou o nível é inválido. Usado pelo usage log para emitir
 * o "matched_request" do trust layer (src/usage.ts), sem acoplar usage.ts à matriz TIERS.
 */
export function isDefaultTierEngine(level: number, engine: Engine): boolean {
  return TIERS[level]?.primary.engine === engine;
}

/**
 * Resolve com o primeiro sucesso da lista, ignorando rejeições (usadas pelo `fan_out` em modo
 * "race" para não esperar os engines mais lentos). Só rejeita se TODAS as promises rejeitarem.
 * Função pura e genérica — testável sem spawnar processo.
 */
export function raceFirstSuccess<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let remaining = promises.length;
    for (const p of promises) {
      p.then(resolve).catch(() => {
        remaining -= 1;
        if (remaining === 0) reject(new Error("all promises rejected"));
      });
    }
  });
}

/**
 * Subconjunto de RunOpts seguro para retomar num OUTRO engine depois de uma falha de ambiente.
 * ALLOWLIST deliberada (não blocklist): um campo só atravessa pro fallback se listado aqui, então
 * uma opção nova ou esquecida em RunOpts nunca vaza por omissão. Campos excluídos e o porquê:
 * - model/effort: escolha feita pro codex; o fallback usa o default do próprio engine.
 * - mode: vira `--ro-bind` do workspace em buildSandboxSpec, mas só o codex tem `-s read-only`
 *   pra honrar isso sem quebrar — grok guarda sessão indexada pelo cwd e falha ("Read-only file
 *   system") tentando criar a sessão se o cwd virou somente-leitura. Foi exatamente este bug.
 * - resume: id de sessão no formato/namespace do engine original; não existe no fallback.
 * - images: hoje só generate_image usa (`-i`, exclusivo codex); grok/claude ignoram silenciosamente
 *   o valor, o que dropa a imagem de entrada sem avisar — pior que falhar.
 */
export function fallbackOpts(opts: RunOpts, engine: Engine): RunOpts {
  const { prompt, cwd, timeoutMs, force, web, agentPrompt } = opts;
  return { prompt, cwd, timeoutMs, force, web, agentPrompt, engine };
}

/** Roda o CLI do engine em modo headless e devolve o resultado parseado. */
export function runCursor(opts: RunOpts): Promise<CliResult> {
  const runOnce = (runOpts: RunOpts): Promise<CliResult> => {
    const engine = runOpts.engine ?? "cursor";
    const bin = engine === "grok" ? GROK_BIN
      : engine === "codex" ? CODEX_BIN
      : engine === "claude" ? CLAUDE_BIN
      : engine === "opencode" ? OPENCODE_BIN
      : engine === "kimi" ? KIMI_BIN
      : engine === "muse" ? MUSE_BIN
      : POLYAGENT_CURSOR_BIN;
    const workspace = runOpts.cwd ?? process.cwd();

    // O sandbox bwrap ($HOME isolado) é OBRIGATÓRIO para TODOS os engines — nenhum modelo roda fora
    // dele. Isola a config global de cada CLI (~/.cursor/rules, ~/.grok/config.toml, ~/.codex/config)
    // que carregava rules/MCP servers, inflando tokens.
    const bwrap = SANDBOX_ON ? bwrapPath() : null;
    // `!!bwrap`: com bwrap externo, o read-only do codex vem do --ro-bind do workspace — NÃO do sandbox
    // interno do codex, que aninharia um namespace dentro do bwrap e quebraria. Ver buildCodexArgs.
    const engineArgs = buildArgs(engine, runOpts, !!bwrap);
    let cmd = bin;
    let args = engineArgs;
    let cleanup = () => {};
    if (bwrap) {
      const built = buildSandboxSpec(workspace, engine, !!runOpts.mode);
      cleanup = built.cleanup;
      cmd = bwrap;
      args = [...buildSandboxArgs(built.spec), bin, ...engineArgs];
    } else if (SANDBOX_ON) {
      // Sem degradação implícita: o bwrap sumiu do PATH depois do preflight, então a chamada falha.
      // Rejeita em vez de lançar síncrono — runCursor encadeia .catch() sobre o retorno de runOnce.
      return Promise.reject(new Error(BWRAP_MISSING));
    }
    if (DEBUG) process.stderr.write(`[cursor-bridge:debug] ${cmd} ${args.map((a) => JSON.stringify(a)).join(" ")}\n`);

    return new Promise((resolve, reject) => {
      // stdin fechado ("ignore"): o `codex exec` fica pendurado ("Reading additional input from
      // stdin...") se o stdin for um pipe aberto. cursor/grok recebem o prompt por arg e não usam stdin.
      const child = spawn(cmd, args, { cwd: workspace, env: process.env, stdio: ["ignore", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      const timeoutMs = runOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        cleanup();
        reject(new Error(`${engine} agent timed out after ${timeoutMs}ms: ${stderr.trim().slice(-500)}`));
      }, timeoutMs);

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => {
        stderr += d.toString();
        if (DEBUG) process.stderr.write(d);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        cleanup();
        reject(new Error(`failed to spawn '${cmd}': ${err.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        cleanup();
        if (code !== 0) {
          reject(new ProcessError(
            `${engine} agent exited ${code}: ${stderr.trim() || stdout.trim()}`,
            stdout,
            stderr,
            code,
          ));
          return;
        }
        resolve({ ...parseOutput(engine, stdout), engine });
      });
    });
  };

  const engine = opts.engine ?? "cursor";
  /**
   * Converte a falha crua em erro acionável quando a causa é cota/rate limit. Distinto de
   * isCodexEnvError de propósito: só a falha de AMBIENTE entra no FALLBACK_ENGINE_ORDER automático;
   * cota nunca retenta sozinha — quem decide a troca (e gasta a próxima assinatura) é o usuário.
   */
  const asQuotaError = (err: unknown, failedEngine: Engine): unknown => {
    if (!(err instanceof ProcessError)) return err;
    const kind = classifyQuotaError(
      { stdout: err.stdout, stderr: err.stderr, exitCode: err.exitCode },
      failedEngine,
    );
    if (!kind) return err;
    const candidates = quotaCandidates(opts.tool, failedEngine, hasEngine, CURSOR_ENABLED, SANDBOX_ON, opts.health);
    return new QuotaError(kind, failedEngine, quotaErrorMessage(kind, failedEngine, opts.tool, candidates));
  };

  return runOnce(opts).catch((originalError: unknown) => {
    const message = originalError instanceof Error ? originalError.message : String(originalError);
    if (engine !== "codex" || !message.startsWith("codex agent exited ") || !isCodexEnvError(message)) {
      throw asQuotaError(originalError, engine);
    }

    const candidates: Engine[] = [
      ...FALLBACK_ENGINE_ORDER.filter((candidate) => candidate !== "codex"),
      ...(CURSOR_ENABLED ? ["cursor" as const] : []),
    ];
    const fallback = candidates.find((candidate) => hasEngine(candidate));
    if (!fallback) throw originalError;

    return runOnce(fallbackOpts(opts, fallback)).catch((fallbackError: unknown) => {
      throw asQuotaError(fallbackError, fallback);
    }).then((result) => ({
      ...result,
      text: result.text +
        `\n\n[note: codex unavailable (environment issue — missing CODEX_HOME or read-only app-server init) — retried on ${fallback} with its default model]`,
    }));
  });
}
