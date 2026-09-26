import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TIERS } from "./cli.js";

// Bloco gerenciado no CLAUDE.md global do usuário: o host lê esse arquivo em toda sessão, então é
// o canal mais forte para rotear (o `instructions` do server e as descrições das tools competem
// com as tools nativas). O conteúdo sai do código para acompanhar TIERS sem edição manual.
export const BLOCK_BEGIN_PREFIX = "<!-- polyagent-mcp:begin";
export const BLOCK_END = "<!-- polyagent-mcp:end -->";
const BLOCK_PATTERN = /<!-- polyagent-mcp:begin[^\n]*?-->[\s\S]*?<!-- polyagent-mcp:end -->\n?/g;
const LEGACY_PATTERN = /^[ \t]*<polyagent_preference>[\s\S]*?<\/polyagent_preference>[ \t]*\n?/m;

export const PACKAGE_VERSION: string = (() => {
  try {
    // src/ e dist/ ficam um nível abaixo da raiz, onde mora o package.json (também no pacote publicado).
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

export const CLAUDE_MD_PATH = process.env.POLYAGENT_CLAUDE_MD_PATH
  || join(homedir(), ".claude", "CLAUDE.md");
export const CLAUDE_MD_BOOT_SYNC = !/^(off|0|false|no)$/i.test(process.env.POLYAGENT_CLAUDE_MD ?? "");

export type SyncMode = "boot" | "install" | "dry-run";
export type SyncAction = "appended" | "replaced" | "unchanged" | "skipped";

export interface SyncResult {
  action: SyncAction;
  legacyRemoved: boolean;
  backupPath?: string;
  text?: string;
}

export interface ClaudeMdFs {
  read(path: string): string | undefined;
  write(path: string, text: string): void;
}

export const nodeClaudeMdFs: ClaudeMdFs = {
  read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
  write: (path, text) => writeFileSync(path, text),
};

function tierLine(): string {
  return Object.entries(TIERS)
    .map(([level, { primary }]) => `${level}=${primary.engine} ${primary.model ?? "default"} ${primary.effort ?? ""}`.trim())
    .join(", ");
}

export function renderPolyagentBlock(version: string): string {
  return `${BLOCK_BEGIN_PREFIX} v=${version} -->
<!-- Managed by polyagent-mcp: this block is rewritten when the server starts. Edit outside the markers; delete both markers to stop updates. -->
## polyagent-mcp routing

- Reading and locating: \`explore\` (map/search the repo), \`read_slice\` (a slice of a known file), \`run_filtered\` (noisy command, keep the signal), \`web_lookup\` (docs/web). Native Read only right before an Edit of that file.
- Execution: \`delegate(prompt, level)\` for self-contained work (features, bugfixes, multi-file edits, builds, commits, PRs); \`fast_delegate\` when speed matters more than the level. Levels: ${tierLine()}. Pick the lowest level that can do it; 4-5 are expensive and share the Claude Code subscription.
- Worker prompts must stand alone: say where to work, how to verify it is done, and ask for one task per call.
- Grade worker results with \`rate(session_id, 1-5)\`.

### fan_out: call it instead of judging alone
Use \`fan_out\` (not several \`delegate\` calls you compare yourself) when:
- choosing between 2+ designs, approaches, libraries or options → \`mode: "consensus"\`;
- a verdict is costly to get wrong: merge/no-merge review, root cause of a hard bug, a destructive migration → \`mode: "consensus"\`;
- a bug has competing hypotheses → one prompt, \`levels: [1, 2, 3]\`, \`mode: "consensus"\`;
- you want the first acceptable answer across engines → \`mode: "race"\`.
Start with \`levels: [1, 2]\`; add 3 for hard problems; use 4-5 only after a cheaper consensus disagreed. Skip it for lookups, single-file edits and sequential work.
${BLOCK_END}
`;
}

export function upsertManagedBlock(text: string, block: string): { action: SyncAction; text: string } {
  const matches = text.match(BLOCK_PATTERN) ?? [];
  const begins = text.split(BLOCK_BEGIN_PREFIX).length - 1;
  if (matches.length === 0 && begins === 0) {
    const base = text.length === 0 ? "" : text.endsWith("\n") ? `${text}\n` : `${text}\n\n`;
    return { action: "appended", text: base + block };
  }
  if (matches.length !== 1 || begins !== 1) {
    throw new Error(
      `Invalid polyagent-mcp block in CLAUDE.md: received ${begins} begin marker(s) and ${matches.length} complete block(s); expected exactly one begin/end pair.`,
    );
  }
  const updated = text.replace(BLOCK_PATTERN, block);
  return updated === text ? { action: "unchanged", text } : { action: "replaced", text: updated };
}

export function removeLegacySection(text: string): { removed: boolean; text: string } {
  const updated = text.replace(LEGACY_PATTERN, "");
  return { removed: updated !== text, text: updated };
}

/**
 * Sincroniza o bloco. `boot` só atualiza um bloco já instalado e nunca lança (roda no startup do
 * server); `install` cria o bloco, remove a seção manual antiga e guarda backup; `dry-run` só calcula.
 */
export function syncClaudeMd(path: string, mode: SyncMode, block: string, fs: ClaudeMdFs): SyncResult {
  const original = fs.read(path);
  if (mode === "boot") {
    if (original === undefined || !original.includes(BLOCK_BEGIN_PREFIX)) return { action: "skipped", legacyRemoved: false };
    try {
      const result = upsertManagedBlock(original, block);
      if (result.action !== "unchanged") fs.write(path, result.text);
      return { action: result.action, legacyRemoved: false };
    } catch {
      // Marca quebrada à mão: não mexe no arquivo nem derruba o server; `install` mostra o erro.
      return { action: "skipped", legacyRemoved: false };
    }
  }
  const legacy = removeLegacySection(original ?? "");
  const result = upsertManagedBlock(legacy.text, block);
  // Compara com o original, não com `result.action`: bloco em dia + seção manual ainda presente
  // continua sendo mudança a gravar.
  if (mode === "dry-run" || result.text === original) {
    return { action: result.action, legacyRemoved: legacy.removed, text: result.text };
  }
  const backupPath = original === undefined ? undefined : `${path}.polyagent.bak`;
  if (backupPath) fs.write(backupPath, original!);
  fs.write(path, result.text);
  return { action: result.action, legacyRemoved: legacy.removed, ...(backupPath ? { backupPath } : {}), text: result.text };
}
