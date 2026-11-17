import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { hostPlusWorker, compareHosts, daySummary, renderDayReport } from './host-cost-core.mjs';

// Uso:
//   node bench/host-cost.mjs <transcript.jsonl> [<transcript-com-worker.jsonl>] [--log <POLYAGENT_LOG>]
//   node bench/host-cost.mjs --day [AAAA-MM-DD] [--dir <pasta-de-transcripts>] [--log <POLYAGENT_LOG>]
// --day: relatório do fim do dia. Sem --dir varre todos os projetos em ~/.claude/projects (sessões
// do host em qualquer projeto chamam o Polyagent); sem data usa hoje (hora local). Subagentes
// (pastas dentro de cada sessão) ficam de fora: só os transcripts de nível superior. Sessão que
// atravessa dias conta só os eventos do dia pedido.
function jsonl(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch { return []; }
}

/** AAAA-MM-DD na hora local. */
function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Transcripts de nível superior cuja última escrita caiu no dia pedido. */
function transcriptsOfDay(roots, day) {
  const files = [];
  for (const root of roots) {
    let names = [];
    try { names = readdirSync(root); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(root, name);
      try { if (localDay(statSync(path).mtimeMs) === day) files.push(path); } catch { /* sumiu no meio */ }
    }
  }
  return files;
}

const args = process.argv.slice(2);
const logAt = args.indexOf('--log');
const logPath = logAt >= 0 ? args.splice(logAt, 2)[1] : process.env.POLYAGENT_LOG;
const log = logPath ? jsonl(logPath) : [];
const dirAt = args.indexOf('--dir');
const dirArg = dirAt >= 0 ? args.splice(dirAt, 2)[1] : null;
const dayAt = args.indexOf('--day');

if (dayAt >= 0) {
  const given = args[dayAt + 1] && /^\d{4}-\d{2}-\d{2}$/.test(args[dayAt + 1]) ? args[dayAt + 1] : null;
  const day = given ?? localDay(Date.now());
  const base = join(homedir(), '.claude', 'projects');
  let roots = [dirArg];
  if (!dirArg) { try { roots = readdirSync(base).map(name => join(base, name)); } catch { roots = []; } }
  const sessions = transcriptsOfDay(roots, day).map(path => ({ id: basename(path, '.jsonl'), events: jsonl(path).filter(event => {
    const ms = Date.parse(event?.timestamp);
    return Number.isFinite(ms) && localDay(ms) === day;
  }) }));
  if (!logPath) console.error('aviso: sem --log nem POLYAGENT_LOG; o lado worker sai vazio.');
  const logOfDay = log.filter(entry => Number.isFinite(entry?.ts) && localDay(entry.ts) === day);
  console.log(renderDayReport(daySummary(sessions, logOfDay)));
} else {
  const reports = args.map(file => hostPlusWorker(jsonl(file), log));
  if (!reports.length) { console.error('uso: node bench/host-cost.mjs <transcript.jsonl> [<outro.jsonl>] | --day [data] [--log arquivo]'); process.exit(2); }
  console.log(JSON.stringify(reports.length === 2 ? { alone: reports[0], withWorker: reports[1], comparison: compareHosts(reports[0], reports[1]) } : reports[0], null, 2));
}
