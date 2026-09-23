// Bench das tools auxiliares pelo caminho real (runCursor + bwrap), com gabarito calculado do repo.
// Uso: npm run build && node bench/aux-bench.mjs [reps] [candidatos,separados,por,vírgula]
// Saída: uma linha JSONL por rodada em research/bench/<data>-aux.jsonl (não guarda o prompt).
import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const { runCursor } = await import(join(REPO, "dist/cli.js"));
const P = await import(join(REPO, "dist/prompts.js"));

const REPS = Number(process.argv[2] ?? 2);
const ONLY = process.argv[3]?.split(",");
const DATE = new Date().toISOString().slice(0, 10);
mkdirSync(join(REPO, "research/bench"), { recursive: true });
const OUT = join(REPO, "research/bench", `${DATE}-aux.jsonl`);

// Candidatos: assinatura (codex/claude/grok) e pay-per-token via opencode/OpenRouter.
const CANDIDATES = [
  { id: "luna-low", engine: "codex", model: "gpt-6-luna", effort: "low" },
  { id: "luna-medium", engine: "codex", model: "gpt-6-luna", effort: "medium" },
  { id: "mercury-2", engine: "opencode", model: "openrouter/inception/mercury-2" },
  { id: "deepseek-v4.1-flash", engine: "opencode", model: "openrouter/deepseek/deepseek-v4.1-flash" },
  { id: "haiku-low", engine: "claude", model: "haiku", effort: "low" },
  { id: "grok-4.5-low", engine: "grok", model: "grok-4.5", effort: "low" },
].filter((c) => !ONLY || ONLY.includes(c.id));

// Gabarito tirado do repo no início — editar src/ ou test/ DURANTE a rodada ainda invalida o resultado.
const cliLines = readFileSync(join(REPO, "src/cli.ts"), "utf8").split("\n");
const fastTierLine = cliLines.findIndex((l) => l.startsWith("export function resolveFastTier")) + 1;
const vitest = JSON.parse(execFileSync("npx", ["vitest", "run", "test/quota.test.ts", "--reporter=json"],
  { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const passed = vitest.numPassedTests, failed = vitest.numFailedTests;

const ex = P.explorePrompt("Where is the function resolveFastTier defined? Answer with the exact file:line.");
const TASKS = [
  { id: "T1-explore", prompt: ex.prompt, mode: ex.mode,
    check: (t) => new RegExp(`src/cli\\.ts:${fastTierLine}\\b`).test(t) },
  { id: "T2-read_slice", prompt: P.readSlicePrompt(["src/cli.ts"], "the FAST_CANDIDATES array definition"), mode: "ask",
    check: (t) => /FAST_CANDIDATES/.test(t) && /openrouter\/inception\/mercury-2/.test(t) },
  { id: "T3-run_filtered", prompt: P.runFilteredPrompt("npx vitest run test/quota.test.ts", "how many tests passed and how many failed"), force: true,
    check: (t) => new RegExp(`\\b${passed}\\b`).test(t) && (failed > 0 ? new RegExp(`\\b${failed}\\b`).test(t) : !/\b[1-9]\d* (tests? )?fail/i.test(t)) },
];
// web_lookup só roda em codex (única engine com web search). Gabarito externo: confira o preço antes de rodar.
const WEB = { id: "T4-web_lookup", mode: "ask", web: true,
  prompt: P.webLookupPrompt("On openrouter.ai, what is the exact model slug for Xiaomi MiMo-V2.6-Pro and its input/output price per 1M tokens?"),
  check: (t) => /xiaomi\/mimo-v2\.6-pro/.test(t) && /0\.435/.test(t) && /0\.87/.test(t) };

async function runOne(task, c, rep) {
  const t0 = Date.now();
  let ok = false, err = null, chars = 0;
  try {
    const r = await runCursor({ prompt: task.prompt, engine: c.engine, model: c.model, effort: c.effort,
      mode: task.mode, web: task.web, force: task.force, cwd: REPO, timeoutMs: 240_000 });
    chars = (r.text ?? "").length; ok = task.check(r.text ?? "");
  } catch (e) { err = String(e?.message ?? e).slice(0, 200); }
  const row = { date: DATE, task: task.id, cand: c.id, engine: c.engine, model: c.model, effort: c.effort ?? null, rep, ms: Date.now() - t0, ok, chars, err };
  appendFileSync(OUT, JSON.stringify(row) + "\n");
  console.log(`${row.task} ${row.cand} #${rep} ${row.ms}ms ok=${ok}${err ? " ERR " + err.slice(0, 80) : ""}`);
}

console.log(`gabarito: resolveFastTier em src/cli.ts:${fastTierLine}; quota.test.ts ${passed} passed / ${failed} failed → ${OUT}`);
for (let rep = 1; rep <= REPS; rep++) for (const task of TASKS) for (const c of CANDIDATES) await runOne(task, c, rep);
for (let rep = 1; rep <= REPS; rep++) for (const c of CANDIDATES.filter((x) => x.engine === "codex")) await runOne(WEB, c, rep);
console.log("DONE");
