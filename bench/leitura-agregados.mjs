#!/usr/bin/env node
// Agregados do log de uso (POLYAGENT_LOG) para o estudo research/2026-11-16-ferramentas-de-leitura.md.
// Uso: node bench/leitura-agregados.mjs [log.jsonl] [saida.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOLS = ['explore', 'read_slice', 'run_filtered', 'web_lookup'];
const SEM_REGISTRO = '(sem registro)';
const TZ = 'America/Sao_Paulo';

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// p90 por posição floor(n*0,9), a mesma regra usada no estudo
export function p90(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
}

export function monthOf(ts) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(new Date(ts));
  return `${p.find(x => x.type === 'year').value}-${p.find(x => x.type === 'month').value}`;
}

export function dayOf(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts));
}

// Linha malformada é descartada e contada; nunca lança (mesma postura do usage.ts).
export function parseLog(text) {
  const rows = [];
  let malformed = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === 'object' && typeof r.tool === 'string' && Number.isFinite(r.ts)) rows.push(r);
      else malformed++;
    } catch { malformed++; }
  }
  return { rows, malformed };
}

export function dedupe(rows) {
  const seen = new Set();
  return rows.filter(r => {
    const k = `${r.ts}|${r.tool}|${r.outChars}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function count(xs) {
  const o = {};
  for (const x of xs) o[x] = (o[x] ?? 0) + 1;
  return o;
}

function stats(xs) {
  return { n: xs.length, mediana: median(xs), p90: p90(xs) };
}

// Nota liga à última chamada não-rate com o mesmo sessionId (como o ratingStats).
export function ratingsByTool(rows) {
  const last = new Map();
  const out = {};
  for (const r of rows) {
    if (r.tool === 'rate') {
      const w = last.get(r.ratedSessionId);
      if (!w || !Number.isFinite(r.score)) continue;
      (out[w.tool] ??= []).push(r.score);
    } else if (r.sessionId) last.set(r.sessionId, r);
  }
  return out;
}

export function aggregate(text) {
  const { rows, malformed } = parseLog(text);
  const unicas = dedupe(rows);
  const notas = ratingsByTool(unicas);
  const porTool = {};
  for (const tool of TOOLS) {
    const rs = unicas.filter(r => r.tool === tool);
    const com = rs.filter(r => Number.isFinite(r.durationMs));
    const comEngine = rs.filter(r => r.engine);
    const engineModelo = {};
    for (const r of com) {
      if (!r.engine) continue;
      (engineModelo[`${r.engine}|${r.model ?? SEM_REGISTRO}`] ??= []).push(r.durationMs);
    }
    const sc = notas[tool] ?? [];
    const desde = rs.filter(r => dayOf(r.ts) >= '2026-09-14');
    porTool[tool] = {
      chamadas: rs.length,
      chamadasPorMes: count(rs.map(r => monthOf(r.ts))),
      chamadasDesde14Set: desde.length,
      primeiroDiaComEngine: comEngine.length ? dayOf(Math.min(...comEngine.map(r => r.ts))) : null,
      primeiroDiaComDurationMs: com.length ? dayOf(Math.min(...com.map(r => r.ts))) : null,
      outChars: stats(rs.map(r => r.outChars).filter(Number.isFinite)),
      durationMs: stats(com.map(r => r.durationMs)),
      porEngine: count(comEngine.map(r => r.engine)),
      porModelo: count(rs.filter(r => r.model).map(r => r.model)),
      notasSobreChamadasDesde14Set: desde.length ? sc.length / desde.length : null,
      semEngineRegistrado: rs.length - comEngine.length,
      latenciaPorEngineModelo: Object.fromEntries(
        Object.entries(engineModelo).map(([k, v]) => [k, { n: v.length, medianaMs: median(v) }])),
      notas: {
        n: sc.length,
        media: sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null,
        distribuicao: count(sc),
      },
    };
  }
  return { linhasValidas: rows.length, linhasMalformadas: malformed, linhasUnicas: unicas.length, porTool };
}

export function run(logPath, outPath) {
  const buf = readFileSync(logPath);
  const resultado = aggregate(buf.toString('utf8'));
  const saida = { log: logPath, sha256: createHash('sha256').update(buf).digest('hex'), fusoMes: TZ, ...resultado };
  writeFileSync(outPath, JSON.stringify(saida, null, 2) + '\n');
  return saida;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const log = process.argv[2] ?? join(homedir(), '.claude', 'polyagent-usage.jsonl');
  const out = process.argv[3] ?? 'research/bench/2026-11-16-leitura-agregados.json';
  const r = run(log, out);
  console.log(`lidas ${r.linhasValidas} válidas, ${r.linhasMalformadas} malformadas, ${r.linhasUnicas} únicas; sha256 ${r.sha256}`);
}
