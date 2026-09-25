// Bench live das duas decisões Jev; uma linha JSONL por chamada, sem prompt nem resposta.
// Uso: npm run build && node bench/jev-bench.mjs [reps=1] [all|fanout|fanout-long|shadow] [--arbiter]
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { FANOUT_CASES, FANOUT_LONG_CASES, SHADOW_CASES } from "./jev-fixtures.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const flags = args.filter((arg) => arg.startsWith("--"));
const reps = Number(positional[0] ?? 1);
const suite = positional[1] ?? "all";
if (!Number.isSafeInteger(reps) || reps < 1 || !["all", "fanout", "fanout-long", "shadow"].includes(suite)
  || positional.length > 2 || flags.some((flag) => flag !== "--arbiter")) {
  console.error("Usage: node bench/jev-bench.mjs [reps=1] [suite=all|fanout|fanout-long|shadow] [--arbiter]");
  process.exit(2);
}
const withArbiter = flags.includes("--arbiter") && suite !== "shadow";

const { askJev, resolveOpenRouterKey } = await import(join(REPO, "dist/jev.js"));
const { fanOutAgreementRequest, delegateShadowRequest } = await import(join(REPO, "dist/jevDecisions.js"));
const { scrubSecrets } = await import(join(REPO, "dist/scrub.js"));
const { runCursor, EXPLORE_MODEL, withTerseStyle } = withArbiter
  ? await import(join(REPO, "dist/cli.js")) : {};
const { fanOutArbiterPrompt } = withArbiter
  ? await import(join(REPO, "dist/prompts.js")) : {};
let key;
try {
  key = resolveOpenRouterKey(process.env, (path) => readFileSync(path, "utf8"));
} catch (error) {
  console.error(String(error?.message ?? error));
  process.exit(1);
}

const DATE = new Date().toISOString().slice(0, 10);
mkdirSync(join(REPO, "research/bench"), { recursive: true });
const OUT = join(REPO, "research/bench", `${DATE}-jev-bench.jsonl`);
const rows = [];
const arbiterIds = new Set([
  "review-null-guard", "approach-pagination", "bug-cache",
  "hard-review-auth", "hard-bug-race", "hard-version-react",
]);
const arbiterDone = new Set();

function errorText(error) {
  return scrubSecrets(String(error?.message ?? error)).text.slice(0, 300);
}

function record(row) {
  appendFileSync(OUT, JSON.stringify(row) + "\n");
  rows.push(row);
  console.log(`${row.suite}/${row.kind} ${row.id} #${row.rep} ${row.ms}ms${row.err ? ` ERR ${row.err}` : ""}`);
}

async function callJev(request) {
  return askJev(request, { fetch: (url, init) => globalThis.fetch(url, init), key });
}

async function runFanout(fixture, rep) {
  const started = performance.now();
  const fanoutSuite = fixture.long ? "fanout-long" : "fanout";
  const row = {
    suite: fanoutSuite, kind: "jev", id: fixture.id, rep, label: fixture.label,
    hard: fixture.hard ?? false, p: null, confidence: null, ms: null, cost: null, err: null,
  };
  try {
    const result = await callJev(fanOutAgreementRequest(fixture.outputs));
    row.p = result.answers.agreement.noul;
    row.confidence = Math.max(row.p, 1 - row.p);
    row.cost = result.usage?.cost ?? null;
  } catch (error) {
    row.err = errorText(error);
  }
  row.ms = Math.round(performance.now() - started);
  record(row);

  // Até seis chamadas de arbiter por execução, inclusive quando reps > 1.
  if (!withArbiter || !arbiterIds.has(fixture.id) || arbiterDone.has(fixture.id)) return;
  arbiterDone.add(fixture.id);
  const arbiterStarted = performance.now();
  const arbiterRow = {
    suite: fanoutSuite, kind: "arbiter", id: fixture.id, rep, label: fixture.label,
    hard: fixture.hard ?? false, p: null, confidence: null, ms: null, cost: null, err: null,
  };
  try {
    const outputs = fixture.outputs.map((output, i) => ({
      engine: "codex", level: i + 1, text: output,
    }));
    await runCursor({
      prompt: fanOutArbiterPrompt(outputs), cwd: REPO, engine: "codex",
      model: EXPLORE_MODEL, mode: "ask", agentPrompt: withTerseStyle(), tool: "fan_out",
    });
  } catch (error) {
    arbiterRow.err = errorText(error);
  }
  arbiterRow.ms = Math.round(performance.now() - arbiterStarted);
  record(arbiterRow);
}

async function runShadow(fixture, rep) {
  const started = performance.now();
  const row = {
    suite: "shadow", kind: "jev", id: fixture.id, rep,
    expected: fixture.expected, ok: fixture.ok, choice: null, confidence: null,
    ms: null, cost: null, err: null,
  };
  try {
    const result = await callJev(delegateShadowRequest(fixture.prompt));
    row.choice = Number(result.answers.level.choice);
    row.confidence = result.answers.level.confidence;
    row.cost = result.usage?.cost ?? null;
    if (!Number.isInteger(row.choice) || row.choice < 1 || row.choice > 5
      || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) {
      throw new Error("Jev returned an invalid level or confidence");
    }
  } catch (error) {
    row.choice = null;
    row.confidence = null;
    row.err = errorText(error);
  }
  row.ms = Math.round(performance.now() - started);
  record(row);
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function ratio(n, d) {
  return d ? `${(100 * n / d).toFixed(1)}%` : "n/a";
}

function summaryLine(name, subset) {
  const times = subset.map((row) => row.ms);
  const priced = subset.filter((row) => row.cost !== null);
  const cost = priced.reduce((sum, row) => sum + row.cost, 0);
  console.log(`${name.padEnd(15)} ${String(subset.length).padStart(5)} ${String(subset.filter((row) => !row.err).length).padStart(5)} ${String(subset.filter((row) => !!row.err).length).padStart(5)} ${String(median(times) ?? "-").padStart(9)} ${String(times.length ? Math.max(...times) : "-").padStart(7)} ${cost.toFixed(6).padStart(12)} (${priced.length}/${subset.length} priced)`);
}

console.log(`Jev bench: ${reps} rep(s), ${suite}${withArbiter ? " + arbiter" : ""} → ${OUT}`);
const selectedFanout = suite === "fanout" ? FANOUT_CASES
  : suite === "fanout-long" ? FANOUT_LONG_CASES
    : suite === "all" ? [...FANOUT_CASES, ...FANOUT_LONG_CASES] : [];
for (let rep = 1; rep <= reps; rep++) {
  for (const fixture of selectedFanout) await runFanout(fixture, rep);
  if (suite === "all" || suite === "shadow") for (const fixture of SHADOW_CASES) await runShadow(fixture, rep);
}

const fanout = rows.filter((row) => row.suite === "fanout" && row.kind === "jev");
const fanoutLong = rows.filter((row) => row.suite === "fanout-long" && row.kind === "jev");
const shadow = rows.filter((row) => row.suite === "shadow");
const arbiters = rows.filter((row) => row.kind === "arbiter");
console.log("suite           calls    ok   err median ms  max ms    cost USD");
summaryLine("fanout Jev", fanout);
summaryLine("fanout-long Jev", fanoutLong);
summaryLine("shadow Jev", shadow);
summaryLine("arbiter", arbiters);
summaryLine("total", rows);

function reportFanoutThresholds(name, attempts) {
  if (!attempts.length) return;
  console.log(`${name} thresholds (${attempts.length} attempts; ${attempts.filter((row) => row.p !== null).length} valid; errors fall back)`);
  console.log("    t   skips   skip rate  false skip  hard false skip  missed skip  accuracy");
  for (const threshold of [0.5, 0.7, 0.85, 0.9, 0.95]) {
    const skips = attempts.filter((row) => row.p !== null && row.p >= threshold);
    const falseSkips = skips.filter((row) => row.label === "disagree");
    const missedSkips = attempts.filter((row) => row.label === "agree" && !skips.includes(row));
    const correct = attempts.length - falseSkips.length - missedSkips.length;
    const hardFalse = falseSkips.filter((row) => row.hard).length;
    console.log(`${threshold.toFixed(2).padStart(5)} ${String(skips.length).padStart(7)} ${ratio(skips.length, attempts.length).padStart(11)} ${String(falseSkips.length).padStart(11)} ${String(hardFalse).padStart(16)} ${String(missedSkips.length).padStart(12)} ${ratio(correct, attempts.length).padStart(9)}`);
  }
}

reportFanoutThresholds("fanout", fanout);
reportFanoutThresholds("fanout-long", fanoutLong);

if (fanout.length) {
  const compared = arbiters.filter((arbiter) => !arbiter.err).map((arbiter) => ({
    arbiter, jev: fanout.find((row) => row.id === arbiter.id && row.rep === arbiter.rep),
  })).filter(({ jev }) => jev && !jev.err);
  const saved = compared.filter(({ jev }) => jev.p >= 0.85)
    .map(({ arbiter, jev }) => arbiter.ms - jev.ms);
  if (arbiters.length) console.log(`arbiter comparison: ${compared.length}/${arbiters.length} paired; median arbiter-Jev ${median(compared.map(({ arbiter, jev }) => arbiter.ms - jev.ms)) ?? "n/a"} ms; at p>=0.85, ${saved.length} skips save median ${median(saved) ?? "n/a"} ms`);
}

if (shadow.length) {
  const valid = shadow.filter((row) => row.choice !== null);
  const exact = valid.filter((row) => row.choice === row.expected).length;
  const inRange = valid.filter((row) => row.choice >= row.ok[0] && row.choice <= row.ok[1]).length;
  const over = valid.filter((row) => row.choice > row.ok[1]).length;
  const under = valid.filter((row) => row.choice < row.ok[0]).length;
  console.log(`shadow (${shadow.length} attempts, ${valid.length} valid): exact ${exact}/${shadow.length} ${ratio(exact, shadow.length)}, within range ${inRange}/${shadow.length} ${ratio(inRange, shadow.length)}, over ${over}, under ${under}, errors ${shadow.length - valid.length}`);
  console.log("expected\\chosen      1   2   3   4   5   err");
  for (let expected = 1; expected <= 5; expected++) {
    const group = shadow.filter((row) => row.expected === expected);
    const cells = [1, 2, 3, 4, 5, null].map((choice) => String(group.filter((row) => row.choice === choice).length).padStart(3));
    console.log(`${String(expected).padStart(15)} ${cells.join(" ")}`);
  }
}
