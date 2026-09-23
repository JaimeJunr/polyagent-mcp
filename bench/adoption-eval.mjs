// Mede a escolha das tools pelo Claude Code sem guardar as respostas.
// Uso: node bench/adoption-eval.mjs [label] [ids,separados,por,vírgula]
// Saída: uma linha JSONL por prompt em research/bench/<data>-adoption.jsonl.
import { appendFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ADOPTION_REPO/ADOPTION_OUT permitem rodar o "antes" com outra branch checada no repo (o script pode
// não existir nela) sem deixar arquivo não rastreado que bloqueie a volta de branch.
const REPO = process.env.ADOPTION_REPO ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const DATE = new Date().toISOString().slice(0, 10);
const PREFIX = "mcp__polyagent__";
const TIMEOUT_MS = 8 * 60 * 1000;
// Modelo/esforço do HOST (o Claude que escolhe as tools). Sem isso vale o default do usuário, e o alias
// `opus` resolvia para claude-opus-5 em 2026-09-23 — medir o host errado sem perceber.
const HOST_MODEL = process.env.ADOPTION_MODEL ?? null;
const HOST_EFFORT = process.env.ADOPTION_EFFORT ?? null;
const NATIVE_TOOLS = new Set(["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch", "Task", "Agent"]);

const PROMPTS = [
  { id: "locate", category: "code-reading", prompt: "Onde o projeto decide qual engine o fast_delegate usa? Me diga o arquivo e a linha.", expect: ["explore", "read_slice"] },
  { id: "read", category: "code-reading", prompt: "Explique em poucas linhas o que a função classifyQuotaError faz e o que ela devolve.", expect: ["read_slice", "explore"] },
  { id: "web", category: "web", prompt: "Qual é a versão mais recente do vitest publicada no npm hoje?", expect: ["web_lookup"] },
  { id: "noisy-cmd", category: "execution", prompt: "Rode a suíte de testes deste projeto e me diga só quais testes falharam, se algum.", expect: ["run_filtered", "fast_delegate", "delegate"] },
  { id: "second-opinion", category: "fan-out", prompt: "Quero duas ou três opiniões independentes sobre se o timeout padrão de 30 minutos do polyagent é adequado, e depois compare as opiniões.", expect: ["fan_out"] },
  { id: "risky-verdict", category: "fan-out", prompt: "Revise a função ratingStats em src/usage.ts procurando bug de lógica. Preciso de um veredito confiável antes de publicar.", expect: ["fan_out", "delegate"] },
  { id: "breadth", category: "fan-out", prompt: "Compare três abordagens diferentes para decidir a ordem da cascata do fast_delegate e recomende uma.", expect: ["fan_out"] },
  { id: "control-simple", category: "control", prompt: "Quantos arquivos .ts existem na pasta src?", expect: [], forbid: ["fan_out"] },
  // Held-out (2026-09-23): escritos DEPOIS das regex do hook UserPromptSubmit e sem ajustá-las a eles —
  // medem se a dica generaliza além do vocabulário dos 8 prompts acima.
  { id: "h-two-models", category: "fan-out", heldout: true, prompt: "Pede para dois modelos diferentes avaliarem se a função resolveFastTier lida bem com engine sem cota, e junta o que eles disserem.", expect: ["fan_out"] },
  { id: "h-design-choice", category: "fan-out", heldout: true, prompt: "Estou em dúvida entre guardar as notas do rate em SQLite ou continuar no JSONL. Me ajuda a decidir olhando por vários ângulos.", expect: ["fan_out", "delegate"] },
  { id: "h-docs", category: "web", heldout: true, prompt: "O SDK de MCP para TypeScript mudou alguma coisa na forma de registrar tools nas últimas versões?", expect: ["web_lookup"] },
  { id: "h-find", category: "code-reading", heldout: true, prompt: "Qual parte do código monta os argumentos do bwrap?", expect: ["explore", "read_slice"] },
];

function emptyParse() {
  return {
    toolNames: [],
    usedToolSearchForPolyagent: false,
    result: { total_cost_usd: null, duration_ms: null, num_turns: null, is_error: null, models: [] },
  };
}

function parseLine(line, parsed) {
  let event;
  try { event = JSON.parse(line); } catch { return; }

  if (event?.type === "assistant" && Array.isArray(event.message?.content)) {
    for (const item of event.message.content) {
      if (item?.type !== "tool_use" || typeof item.name !== "string") continue;
      parsed.toolNames.push(item.name);
      const query = item.input?.query;
      if (item.name === "ToolSearch" && typeof query === "string" && /polyagent/i.test(query)) {
        parsed.usedToolSearchForPolyagent = true;
      }
    }
  }

  if (event?.type === "result") {
    parsed.result = {
      total_cost_usd: event.total_cost_usd ?? null,
      duration_ms: event.duration_ms ?? null,
      num_turns: event.num_turns ?? null,
      is_error: event.is_error ?? null,
      models: event.modelUsage && typeof event.modelUsage === "object" ? Object.keys(event.modelUsage) : [],
    };
  }
}

export function parseStream(text) {
  const parsed = emptyParse();
  for (const line of text.split(/\r?\n/)) parseLine(line, parsed);
  return parsed;
}

function runClaude(prompt) {
  return new Promise((resolveRun) => {
    const parsed = emptyParse();
    let timedOut = false;
    let settled = false;
    let killTimer;
    const child = spawn("claude", [
      "-p", prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode", "bypassPermissions",
      "--disallowedTools", "Edit", "Write", "NotebookEdit",
      ...(HOST_MODEL ? ["--model", HOST_MODEL] : []),
      ...(HOST_EFFORT ? ["--effort", HOST_EFFORT] : []),
    ], { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] });

    const output = child.stdout && createInterface({ input: child.stdout, crlfDelay: Infinity });
    output?.on("line", (line) => parseLine(line, parsed));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    }, TIMEOUT_MS);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolveRun({ parsed, timeout: timedOut });
    };
    child.once("error", finish);
    child.once("close", finish);
  });
}

function shortName(name) {
  return name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
}

function makeRow(prompt, label, run) {
  const { parsed } = run;
  const bridgeNames = parsed.toolNames
    .filter((name) => name.startsWith(PREFIX))
    .map(shortName);
  const bridge = bridgeNames.length;
  const native = parsed.toolNames.filter((name) => NATIVE_TOOLS.has(name)).length;
  const other = parsed.toolNames.length - bridge - native;
  const violation = (prompt.forbid ?? []).some((name) => bridgeNames.includes(name));
  const hit = prompt.expect.length === 0
    ? !violation
    : prompt.expect.some((name) => bridgeNames.includes(name));

  return {
    date: DATE,
    label,
    id: prompt.id,
    category: prompt.category,
    heldout: Boolean(prompt.heldout),
    expect: prompt.expect,
    tools: parsed.toolNames.map(shortName),
    bridge,
    native,
    other,
    hit,
    violation,
    usedToolSearchForPolyagent: parsed.usedToolSearchForPolyagent,
    costUsd: parsed.result.total_cost_usd,
    durationMs: parsed.result.duration_ms,
    turns: parsed.result.num_turns,
    isError: parsed.result.is_error,
    timeout: run.timeout,
    hostModelRequested: HOST_MODEL,
    hostEffort: HOST_EFFORT,
    models: parsed.result.models,
  };
}

async function main() {
  const label = process.argv[2] || "run";
  const requestedIds = process.argv[3]
    ? process.argv[3].split(",").map((id) => id.trim()).filter(Boolean)
    : null;
  const unknownIds = (requestedIds ?? []).filter((id) => !PROMPTS.some((prompt) => prompt.id === id));
  if (unknownIds.length) throw new Error(`Unknown prompt id(s): ${unknownIds.join(", ")}`);
  const selected = requestedIds
    ? PROMPTS.filter((prompt) => requestedIds.includes(prompt.id))
    : PROMPTS;
  if (!selected.length) throw new Error("No prompts selected");

  const outPath = process.env.ADOPTION_OUT ?? join(REPO, "research/bench", `${DATE}-adoption.jsonl`);
  mkdirSync(dirname(outPath), { recursive: true });
  const rows = [];
  for (const prompt of selected) {
    const run = await runClaude(prompt.prompt);
    const row = makeRow(prompt, label, run);
    // Erro de API sem nenhuma tool (ex.: "You've hit your session limit") não é escolha do host:
    // gravar a linha poluiria a comparação com hit=false. Para a rodada inteira em vez de seguir falhando.
    if (row.isError && row.tools.length === 0 && !row.timeout) {
      console.error(`${row.id} api_error sem tools — rodada abortada, nada gravado para este prompt`);
      process.exitCode = 2;
      break;
    }
    appendFileSync(outPath, JSON.stringify(row) + "\n");
    rows.push(row);
    console.log(`${row.id} hit=${row.hit} violation=${row.violation} bridge=${row.bridge} native=${row.native} timeout=${row.timeout}`);
  }

  const hits = rows.filter((row) => row.hit).length;
  const fanOutCount = rows.reduce((sum, row) => sum + row.tools.filter((name) => name === "fan_out").length, 0);
  const shares = rows.filter((row) => row.bridge + row.native > 0)
    .map((row) => row.bridge / (row.bridge + row.native));
  const costs = rows.map((row) => row.costUsd).filter((cost) => typeof cost === "number" && Number.isFinite(cost));
  const totalCost = costs.reduce((sum, cost) => sum + cost, 0);
  const hitRate = `${hits}/${rows.length} (${(100 * hits / rows.length).toFixed(1)}%)`;
  const meanBridgeShare = shares.length
    ? `${(100 * shares.reduce((sum, share) => sum + share, 0) / shares.length).toFixed(1)}% (n=${shares.length})`
    : "n/a (n=0)";
  console.log(`TOTAL hit_rate=${hitRate} fan_out=${fanOutCount} mean_bridge_share=${meanBridgeShare} total_cost=$${totalCost.toFixed(4)} (reported=${costs.length}/${rows.length})`);
  console.log(`JSONL ${outPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  });
}
