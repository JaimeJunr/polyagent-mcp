import { readFileSync } from 'node:fs';
import { hostPlusWorker, compareHosts } from './host-cost-core.mjs';

// Uso: node bench/host-cost.mjs <transcript.jsonl> [<transcript-com-worker.jsonl>] [--log <POLYAGENT_LOG>]
function jsonl(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}
const args = process.argv.slice(2);
const logAt = args.indexOf('--log');
const logPath = logAt >= 0 ? args.splice(logAt, 2)[1] : process.env.POLYAGENT_LOG;
const log = logPath ? jsonl(logPath) : [];
const reports = args.map(file => hostPlusWorker(jsonl(file), log));
if (!reports.length) { console.error('uso: node bench/host-cost.mjs <transcript.jsonl> [<outro.jsonl>] [--log arquivo]'); process.exit(2); }
console.log(JSON.stringify(reports.length === 2 ? { alone: reports[0], withWorker: reports[1], comparison: compareHosts(reports[0], reports[1]) } : reports[0], null, 2));
