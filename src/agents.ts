/**
 * Resolução de "agents" para o delegate. Um agent é uma persona/system-prompt especializado — no
 * ecossistema Claude Code, um arquivo markdown com frontmatter YAML (name/description/model) cujo
 * BODY é o system prompt. Aqui resolvemos o agent NO HOST (fora do sandbox) e extraímos só o body
 * como string portável, que cada engine injeta pelo seu canal aditivo (claude --append-system-prompt,
 * grok --rules, codex -c developer_instructions). Assim a feature NÃO é exclusiva do claude e o
 * sandbox continua com o $HOME vazio. Skills também levam sua pasta como bind somente-leitura.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";

/** Persona resolvida: o body markdown vira system prompt portável cross-engine. */
export interface ResolvedAgent {
  prompt: string;
  name?: string;
  /** Modelo sugerido pelo frontmatter — advisory (o level/model explícito do delegate vence). */
  model?: string;
  /** Diretório canônico da skill, montado somente-leitura no worker. */
  mountRo?: string;
}

/** Entrada do param `agent`: nome de agent, persona inline ou nome de skill. */
export type AgentInput = string | { prompt: string; name?: string; model?: string } | { skill: string };

/** Roots onde procurar arquivos de agent (.md), na ordem. Extra via POLYAGENT_AGENT_PATHS (`:`). */
export function agentRoots(cwd: string): string[] {
  const home = process.env.HOME ?? homedir();
  const extra = (process.env.POLYAGENT_AGENT_PATHS ?? "")
    .split(":").map((p) => p.trim()).filter(Boolean);
  const containedRoot = (root: string, parent: string): string | undefined => {
    try {
      return isInside(realpathSync(root), realpathSync(parent)) ? root : undefined;
    } catch {
      return undefined;
    }
  };
  return [
    ...extra.filter(existsSync), // configuração explícita: roots fora de cwd/home são confiáveis
    containedRoot(join(cwd, ".claude", "agents"), cwd),
    containedRoot(join(home, ".claude", "agents"), home),
    containedRoot(join(home, ".claude", "plugins"), home), // pit:issue-investigator → issue-investigator.md
  ].filter((root): root is string => root !== undefined);
}

/** Confere contenção em paths canônicos sem confundir, por exemplo, `/a/b` com `/a/bc`. */
function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

/**
 * Parse do frontmatter YAML simples (só name/model, linha única) + body. Sem dep externa: o body é
 * o que importa (a persona). Sem frontmatter, o arquivo inteiro é a persona.
 */
export function parseAgentFile(raw: string): ResolvedAgent {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { prompt: raw.trim() };
  const [, fm, body] = m;
  const field = (k: string): string | undefined => {
    const mm = fm.match(new RegExp(`^${k}:\\s*(.+)$`, "m"));
    return mm ? mm[1].trim().replace(/^["']|["']$/g, "") : undefined;
  };
  return { prompt: body.trim(), name: field("name"), model: field("model") };
}

/**
 * Coleta recursiva (profundidade limitada) de TODOS os `<base>.md` sob um root. Profundidade 6
 * alcança o layout de plugin `plugins/cache/<mp>/<plugin>/<versão>/agents/<base>.md`. Ignora dirs
 * ocultos. Retorna todos os matches — o chamador escolhe (ex.: versão de plugin mais recente).
 */
function findAgentFiles(root: string, base: string, depth = 6, acc: string[] = []): string[] {
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = join(root, e.name);
    if ((e.isFile() || e.isSymbolicLink()) && e.name === `${base}.md`) acc.push(full);
    else if (e.isDirectory() && depth > 0 && !e.name.startsWith(".")) findAgentFiles(full, base, depth - 1, acc);
  }
  return acc;
}

/** Dos matches, escolhe o modificado mais recentemente (versão de plugin mais nova, best-effort). */
function newest(files: string[]): string {
  if (files.length === 1) return files[0];
  return files
    .map((f) => [f, statSync(f).mtimeMs] as const)
    .sort((a, b) => b[1] - a[1])[0][0];
}

/** Busca limitada aos layouts `skills/<base>/SKILL.md`, sem descer em diretórios ocultos. */
function findSkillFiles(root: string, base: string, depth = 6, acc: string[] = []): string[] {
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = join(root, e.name);
    if ((e.isFile() || e.isSymbolicLink()) && e.name === "SKILL.md" &&
      basename(root) === base && basename(dirname(root)) === "skills") acc.push(full);
    else if (e.isDirectory() && depth > 0 && !e.name.startsWith(".")) findSkillFiles(full, base, depth - 1, acc);
  }
  return acc;
}

/** Resolve a skill no host e transporta a persona junto do diretório de arquivos auxiliares. */
function resolveSkill(input: string, cwd: string): ResolvedAgent {
  const colon = input.lastIndexOf(":");
  const base = input.slice(colon + 1);
  const plugin = colon >= 0 ? input.slice(0, colon) : undefined;
  if (!base || base.includes("/") || base.includes("..")) {
    throw new Error(`invalid skill name: received ${JSON.stringify(input)}, expected a plain name or 'plugin:name'`);
  }
  const home = process.env.HOME ?? homedir();
  const roots = [
    { path: join(cwd, ".claude", "skills"), parent: cwd, recursive: false },
    { path: join(home, ".claude", "skills"), parent: home, recursive: false },
    { path: join(home, ".claude", "plugins"), parent: home, recursive: true },
  ];
  for (const root of roots) {
    let canonicalRoot: string;
    try {
      canonicalRoot = realpathSync(root.path);
      if (!isInside(canonicalRoot, realpathSync(root.parent))) continue;
    } catch { continue; }
    const files = root.recursive ? findSkillFiles(root.path, base) : [join(root.path, base, "SKILL.md")];
    const containedFiles = files.filter((file) => {
      if (plugin !== undefined && !file.split(sep).includes(plugin)) return false;
      try {
        return isInside(realpathSync(file), canonicalRoot) && isInside(realpathSync(dirname(file)), canonicalRoot);
      } catch { return false; }
    });
    if (!containedFiles.length) continue;
    try {
      const file = newest(containedFiles);
      const parsed = parseAgentFile(readFileSync(file, "utf8"));
      const skillDir = realpathSync(dirname(file));
      return {
        prompt: `[Skill ${input}: its folder ${skillDir} is mounted read-only; read scripts/ and references/ from there.]\n\n${parsed.prompt}`,
        name: parsed.name ?? base,
        mountRo: skillDir,
      };
    } catch { continue; }
  }
  throw new Error(`skill '${input}' not found. Searched ${roots.map((root) => root.path).join(", ")} (plugins: **/skills/${base}/SKILL.md).`);
}

/**
 * Resolve um agent para persona portável. Objeto inline → usa direto. Nome (ex "pit:issue-investigator"
 * ou "code-reviewer") → busca `<base>.md` (base = parte após ":") nos roots e extrai o body. Lança se
 * não achar. Segurança: nomes com `/` ou `..` são rejeitados (sem path traversal); a busca só desce
 * dentro dos roots allowlisted.
 */
export function resolveAgent(input: AgentInput, cwd: string): ResolvedAgent {
  if (typeof input !== "string") {
    if ("skill" in input) return resolveSkill(input.skill, cwd);
    if (!input.prompt?.trim()) {
      throw new Error(`invalid agent: object needs a non-empty 'prompt', received ${JSON.stringify(input)}`);
    }
    return input;
  }
  const base = input.includes(":") ? input.slice(input.lastIndexOf(":") + 1) : input;
  if (!base || base.includes("/") || base.includes("..")) {
    throw new Error(`invalid agent name: received ${JSON.stringify(input)}, expected a plain name or 'plugin:name'`);
  }
  for (const root of agentRoots(cwd)) {
    const files = findAgentFiles(root, base);
    if (files.length) {
      let canonicalRoot: string;
      try { canonicalRoot = realpathSync(root); } catch { continue; }
      const containedFiles = files.flatMap((file) => {
        try {
          const canonicalFile = realpathSync(file);
          return isInside(canonicalFile, canonicalRoot) ? [canonicalFile] : [];
        } catch {
          return [];
        }
      });
      if (!containedFiles.length) continue;
      let file: string;
      let raw: string;
      try {
        file = newest(containedFiles);
        raw = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const parsed = parseAgentFile(raw);
      if (!parsed.prompt.trim()) {
        throw new Error(`invalid agent '${input}': file '${file}' needs a non-empty prompt body`);
      }
      return { ...parsed, name: parsed.name ?? base };
    }
  }
  throw new Error(
    `agent '${input}' not found. Searched .claude/agents (project + home) and ~/.claude/plugins. ` +
    "Add roots via POLYAGENT_AGENT_PATHS, or pass an inline { prompt } object.",
  );
}
