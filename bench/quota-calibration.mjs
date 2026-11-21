// Coletor da calibração de cota (issue #108). Roda em cada máquina e grava registros compactos, sem prompt nem
// resposta: só horário, modelo, contagem de tokens e leitura de cota.
//   node bench/quota-calibration.mjs collect <saída.jsonl> <desde AAAA-MM-DD> [dir de resultados do bench...]
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { hostname, homedir } from 'node:os';
import { claudeUsageRecords, claudeReading, codexRecords } from './quota-calibration-core.mjs';

/** @param {string} path */
function jsonLines(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

/** @param {string} directory @param {number} sinceMs @param {(name:string)=>boolean} accept */
function filesSince(directory, sinceMs, accept) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesSince(path, sinceMs, accept);
    return accept(entry.name) && statSync(path).mtimeMs >= sinceMs ? [path] : [];
  });
}

/** Leituras dos trials do bench: `quota-results.jsonl` dá o início, `<trial>.private.jsonl` dá o rate_limit_event. @param {string} directory */
function benchReadings(directory) {
  const results = join(directory, 'quota-results.jsonl');
  if (!existsSync(results)) return [];
  return jsonLines(results).flatMap(row => {
    const stream = join(directory, `${row.rep}-${row.task}-${row.arm}.private.jsonl`);
    const reading = existsSync(stream) ? claudeReading(jsonLines(stream), Date.parse(row.startedUtc)) : null;
    return reading ? [{ kind: 'claude-reading', source: `${basename(directory)}/${row.rep}-${row.task}-${row.arm}`, ...reading }] : [];
  });
}

const [mode, out, since, ...benchDirs] = process.argv.slice(2);
if (mode !== 'collect' || !out || !since) {
  throw new Error(`invalid arguments: received ${JSON.stringify(process.argv.slice(2))}, expected collect <out.jsonl> <since YYYY-MM-DD> [bench dirs...]`);
}
const sinceMs = Date.parse(`${since}T00:00:00Z`);
const machine = hostname();
const lines = [];
for (const file of filesSince(join(homedir(), '.claude/projects'), sinceMs, name => name.endsWith('.jsonl'))) {
  for (const record of claudeUsageRecords(jsonLines(file))) if (record.ts >= sinceMs) lines.push({ kind: 'claude-usage', machine, ...record });
}
// Contas do orca (CODEX_HOME por conta) também contam; o creator_account_id separa as contas na análise.
const orca = join(homedir(), '.config/orca/codex-accounts');
const codexHomes = [join(homedir(), '.codex'), ...(existsSync(orca) ? readdirSync(orca).map(id => join(orca, id, 'home')) : [])];
for (const home of codexHomes) {
  for (const file of filesSince(join(home, 'sessions'), sinceMs, name => name.startsWith('rollout-') && name.endsWith('.jsonl'))) {
    for (const record of codexRecords(jsonLines(file), basename(file))) if (record.ts >= sinceMs) lines.push({ kind: 'codex', machine, ...record });
  }
}
for (const directory of benchDirs) lines.push(...benchReadings(directory).map(reading => ({ machine, ...reading })));
writeFileSync(out, lines.map(line => JSON.stringify(line)).join('\n') + '\n', { mode: 0o600 });
console.log(JSON.stringify({ machine, out, records: lines.length, byKind: lines.reduce((acc, l) => ({ ...acc, [l.kind]: (acc[l.kind] ?? 0) + 1 }), {}) }));
