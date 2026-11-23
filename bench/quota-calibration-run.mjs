// Fase B da calibração de cota (issue #108): blocos de trials `claude -p` idênticos, lendo a cota em cada trial.
//   node bench/quota-calibration-run.mjs <bloco> <medium|output> <modelo> <alvo em pontos> <teto 5h> <concorrência> <dir de saída> [máx. trials]
// Para de lançar trials quando a janela de 5 h subiu `alvo` pontos desde a primeira leitura, chegou ao teto, virou,
// ou quando um trial volta sem leitura de cota.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MEDIUM_TASK, createSizeFixture } from './quota-size-fixtures.mjs';
import { LEAN } from './quota-eval-core.mjs';
import { claudeReading, nextBlockBudget, parseJsonLines } from './quota-calibration-core.mjs';

// Um tipo de bloco por entrada; o bloco de saída longa muda a mistura de tokens (pouco cache, muita saída)
// para testar se a cota pesa os tipos como o preço.
const BLOCKS = {
  medium: { prompt: MEDIUM_TASK.prompt, maxTurns: '16', setup: workspace => createSizeFixture(workspace, 'transfer') },
  output: { prompt: 'Sem usar ferramentas, escreva em português um guia técnico de cerca de 2500 palavras sobre testes de regressão em sistemas de pagamento, com seções numeradas. Responda só com o texto.',
    maxTurns: '1', setup: workspace => mkdirSync(workspace, { recursive: true }) },
};
const [block, kind, model, target, cap, concurrency, out, maxTrials = 'Infinity'] = process.argv.slice(2);
if (!block || !(kind in BLOCKS) || !model || !(Number(target) > 0) || !(Number(cap) > 0) || !(Number(concurrency) >= 1) || !out) {
  throw new Error(`invalid arguments: received ${JSON.stringify(process.argv.slice(2))}, expected <block> <${Object.keys(BLOCKS).join('|')}> <model> <target> <cap> <concurrency> <out>`);
}
const spec = BLOCKS[kind];
mkdirSync(join(out, 'workspaces'), { recursive: true });

/** @param {number} index */
function trial(index) {
  const workspace = join(out, 'workspaces', `${block}-${index}`);
  spec.setup(workspace);
  writeFileSync(join(workspace, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  const args = ['-p', spec.prompt, '--output-format', 'stream-json', '--verbose',
    '--dangerously-skip-permissions', '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', join(workspace, 'mcp.json'),
    '--model', model, '--effort', 'medium', '--session-id', randomUUID(), '--max-turns', spec.maxTurns,
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
      const events = parseJsonLines(stdout);
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

const rows = [];
let launched = 0;
let budget = null;
let stop = false;
async function lane() {
  while (!stop && launched < Number(maxTrials)) {
    const row = await trial(launched++);
    rows.push(row);
    budget = nextBlockBudget(budget, row, { target: Number(target), cap: Number(cap) });
    const reading = row.last ?? row.first;
    console.log(JSON.stringify({ block, index: row.index, costUsd: row.costUsd, fiveHour: reading?.fiveHour, sevenDay: reading?.sevenDay, isError: row.isError }));
    if (row.isError || row.exitCode !== 0) { stop = true; console.error(`trial ${row.index} failed (exit ${row.exitCode}); stopping block`); }
    if (budget.stopReason && !stop) { stop = true; console.error(`stopping block: ${budget.stopReason}`); }
  }
}
await Promise.all(Array.from({ length: Number(concurrency) }, lane));
console.log(JSON.stringify({ block, trials: rows.length, costUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0), base: budget?.base, peak: budget?.peak, stopReason: budget?.stopReason }));
