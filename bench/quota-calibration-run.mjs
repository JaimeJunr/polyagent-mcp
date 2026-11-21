// Fase B da calibração de cota (issue #108): blocos de trials `claude -p` idênticos, lendo a cota em cada trial.
//   node bench/quota-calibration-run.mjs <bloco> <medium|output> <modelo> <alvo em pontos> <teto 5h> <concorrência> <dir de saída> [máx. trials]
// Para de lançar trials quando a janela de 5 h subiu `alvo` pontos desde a primeira leitura ou chegou ao teto.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MEDIUM_TASK, createSizeFixture } from './quota-size-fixtures.mjs';
import { claudeReading } from './quota-calibration-core.mjs';

const LEAN = 'Complete only the requested task. Use efficient native tools when appropriate. Do not commit, push, contact external services, or change files outside this workspace. Return the requested JSON. For edits, first run a failing behavior test, then fix and rerun. Tool and worker claims require verification.';
// Bloco de saída longa: muda a mistura de tokens (pouco cache, muita saída) para testar se a cota pesa os tipos como o preço.
const OUTPUT_PROMPT = 'Sem usar ferramentas, escreva em português um guia técnico de cerca de 2500 palavras sobre testes de regressão em sistemas de pagamento, com seções numeradas. Responda só com o texto.';
const [block, kind, model, target, cap, concurrency, out, maxTrials = 'Infinity'] = process.argv.slice(2);
if (!block || !['medium', 'output'].includes(kind) || !model || !(Number(target) > 0) || !(Number(cap) > 0) || !(Number(concurrency) >= 1) || !out) {
  throw new Error(`invalid arguments: received ${JSON.stringify(process.argv.slice(2))}, expected <block> <medium|output> <model> <target> <cap> <concurrency> <out>`);
}
mkdirSync(join(out, 'workspaces'), { recursive: true });

/** @param {string} text */
const parse = text => text.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });

/** @param {number} index */
function trial(index) {
  const workspace = join(out, 'workspaces', `${block}-${index}`);
  if (kind === 'medium') createSizeFixture(workspace, 'transfer'); else mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  const args = ['-p', kind === 'medium' ? MEDIUM_TASK.prompt : OUTPUT_PROMPT, '--output-format', 'stream-json', '--verbose',
    '--dangerously-skip-permissions', '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', join(workspace, 'mcp.json'),
    '--model', model, '--effort', 'medium', '--session-id', randomUUID(), '--max-turns', kind === 'medium' ? '16' : '1',
    '--disable-slash-commands', '--append-system-prompt', LEAN];
  const startMs = Date.now();
  return new Promise(resolveTrial => {
    const child = spawn('claude', args, { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    // Teto de segurança igual ao do quota-eval; não é medida de conclusão.
    const timer = setTimeout(() => child.kill('SIGTERM'), 8 * 60 * 1000);
    child.on('close', code => {
      clearTimeout(timer);
      const events = parse(stdout);
      const result = events.find(event => event.type === 'result') ?? {};
      const limits = events.filter(event => event.type === 'rate_limit_event');
      const row = { block, kind, model, index, startMs, endMs: Date.now(), exitCode: code, isError: result.is_error ?? true,
        costUsd: result.total_cost_usd ?? null, modelUsage: result.modelUsage ?? {},
        first: claudeReading(limits.slice(0, 1), startMs), last: claudeReading(limits.slice(-1), Date.now()), rateLimitEvents: limits.length };
      appendFileSync(join(out, 'calibration-trials.jsonl'), JSON.stringify(row) + '\n');
      resolveTrial(row);
    });
  });
}

let launched = 0;
let base = null;
let peak = null;
let stop = false;
async function lane() {
  while (!stop && launched < Number(maxTrials)) {
    const row = await trial(launched++);
    const reading = row.last ?? row.first;
    if (reading?.fiveHour !== null && reading?.fiveHour !== undefined) {
      base ??= (row.first ?? reading).fiveHour;
      peak = Math.max(peak ?? reading.fiveHour, reading.fiveHour);
    }
    console.log(JSON.stringify({ block, index: row.index, costUsd: row.costUsd, fiveHour: reading?.fiveHour, sevenDay: reading?.sevenDay, isError: row.isError }));
    if (row.isError || row.exitCode !== 0) { stop = true; console.error(`trial ${row.index} failed (exit ${row.exitCode}); stopping block`); }
    if (peak !== null && (peak - base >= Number(target) || peak >= Number(cap))) stop = true;
  }
}
await Promise.all(Array.from({ length: Number(concurrency) }, lane));
const rows = parse(readFileSync(join(out, 'calibration-trials.jsonl'), 'utf8')).filter(row => row.block === block);
console.log(JSON.stringify({ block, trials: rows.length, costUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0), base, peak }));
