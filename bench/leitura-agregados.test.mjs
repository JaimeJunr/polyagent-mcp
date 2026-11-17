import { test } from 'vitest';
import assert from 'node:assert/strict';
import { aggregate, median, p90 } from './leitura-agregados.mjs';

const L = o => JSON.stringify(o);
const T = Date.UTC(2026, 9, 15, 12);

test('agrega chamadas, duplicata, latência e nota ligada pela sessão', () => {
  const log = [
    L({ ts: T, tool: 'explore', outChars: 100, engine: 'codex', model: 'gpt-6-luna', durationMs: 1000, sessionId: 's1' }),
    L({ ts: T, tool: 'explore', outChars: 100, engine: 'codex', model: 'gpt-6-luna', durationMs: 1000, sessionId: 's1' }),
    L({ ts: T + 1, tool: 'explore', outChars: 300, engine: 'claude', model: 'haiku', durationMs: 3000, sessionId: 's2' }),
    L({ ts: T + 2, tool: 'rate', outChars: 0, ratedSessionId: 's1', score: 5 }),
    L({ ts: T + 3, tool: 'rate', outChars: 0, ratedSessionId: 's2', score: 3 }),
  ].join('\n');
  const r = aggregate(log);
  const e = r.porTool.explore;
  assert.equal(r.linhasValidas, 5);
  assert.equal(r.linhasUnicas, 4);
  assert.equal(e.chamadas, 2);
  assert.deepEqual(e.chamadasPorMes, { '2026-10': 2 });
  assert.equal(e.outChars.mediana, 200);
  assert.equal(e.durationMs.mediana, 2000);
  assert.deepEqual(e.porEngine, { codex: 1, claude: 1 });
  assert.equal(e.notas.n, 2);
  assert.equal(e.notas.media, 4);
  assert.deepEqual(e.notas.distribuicao, { 5: 1, 3: 1 });
});

test('linha malformada é contada e não derruba a leitura; sem engine fica fora da latência', () => {
  const log = ['{quebrado', '', L({ tool: 'x' }), L({ ts: T, tool: 'web_lookup', outChars: 50 })].join('\n');
  const r = aggregate(log);
  assert.equal(r.linhasMalformadas, 2);
  assert.equal(r.linhasValidas, 1);
  assert.equal(r.porTool.web_lookup.chamadas, 1);
  assert.equal(r.porTool.web_lookup.semEngineRegistrado, 1);
  assert.equal(r.porTool.web_lookup.durationMs.n, 0);
  assert.equal(r.porTool.web_lookup.durationMs.mediana, null);
  assert.equal(r.porTool.read_slice.chamadas, 0);
});

test('mediana e p90 usam a regra do estudo', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 10);
  assert.equal(p90([5]), 5);
});
