import { test } from 'vitest';
import assert from 'node:assert/strict';
import { hostFromTranscript, workersInWindow, hostPlusWorker, compareHosts, proxyUnits } from './host-cost-core.mjs';

const turn = (id, ts, usage) => ({ type: 'assistant', timestamp: ts, message: { id, usage, content: [] } });

test('soma o host sem contar duas vezes o mesmo message.id e acha a janela', () => {
  const events = [
    turn('m1', '2026-11-17T10:00:00.000Z', { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 }),
    turn('m1', '2026-11-17T10:00:01.000Z', { input_tokens: 2, output_tokens: 9, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 }),
    turn('m2', '2026-11-17T10:05:00.000Z', { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
  ];
  const host = hostFromTranscript(events);
  assert.equal(host.tokens.output_tokens, 10);
  assert.equal(host.startMs, Date.parse('2026-11-17T10:00:00.000Z'));
  assert.equal(host.endMs, Date.parse('2026-11-17T10:05:00.000Z'));
  assert.equal(proxyUnits({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 4 }), 10 + 10 + 10 + 5);
});

test('transcript vazio ou malformado não lança e não inventa janela', () => {
  const host = hostFromTranscript([null, 'x', { type: 'user' }]);
  assert.equal(host.startMs, null);
  assert.equal(host.units, 0);
  assert.equal(workersInWindow([{ tool: 'explore', ts: 1, engine: 'codex' }], null, null).calls, 0);
});

test('worker entra só dentro da janela; entrada sem workerUsage conta como não medida', () => {
  const events = [turn('m1', '2026-11-17T10:00:00.000Z', { input_tokens: 1, output_tokens: 1 }), turn('m2', '2026-11-17T10:10:00.000Z', { input_tokens: 1, output_tokens: 1 })];
  const inside = Date.parse('2026-11-17T10:03:00.000Z');
  const log = [
    { tool: 'explore', engine: 'codex', ts: inside, workerUsage: { inputTokens: 500, cachedInputTokens: 400, outputTokens: 20, costUsd: null } },
    { tool: 'delegate', engine: 'claude', ts: inside, workerUsage: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 1, costUsd: 0.25 } },
    { tool: 'delegate', engine: 'codex', ts: inside },
    { tool: 'explore', engine: 'codex', ts: inside + 3_600_000, workerUsage: { inputTokens: 999, outputTokens: 1, cachedInputTokens: 0, costUsd: null } },
    { tool: 'rate', ts: inside },
  ];
  const report = hostPlusWorker(events, log);
  assert.equal(report.worker.calls, 3);
  assert.equal(report.worker.measured, 2);
  assert.equal(report.worker.inputTokens, 505);
  assert.equal(report.worker.costUsd, 0.25);
  assert.equal(report.unmeasuredWorkerCalls, 1);
});

test('compara host sozinho contra host com worker pelas unidades de proxy', () => {
  const mk = out => hostPlusWorker([turn('m', '2026-11-17T10:00:00.000Z', { input_tokens: 0, output_tokens: out })], []);
  const result = compareHosts(mk(100), mk(60));
  assert.equal(Math.round(result.hostChangePct), -40);
  assert.equal(compareHosts(mk(0), mk(5)).hostChangePct, null);
});

import { daySummary, renderDayReport, workersByEngine } from './host-cost-core.mjs';

const T0 = Date.parse('2026-11-17T10:00:00.000Z');
const at = min => new Date(T0 + min * 60_000).toISOString();
const wu = (i, c, o, cost = null) => ({ inputTokens: i, cachedInputTokens: c, outputTokens: o, costUsd: cost });

test('workersByEngine separa codex de claude e conta o que não foi medido', () => {
  const log = [
    { tool: 'explore', engine: 'codex', ts: T0 + 1, workerUsage: wu(100, 80, 5) },
    { tool: 'delegate', engine: 'codex', ts: T0 + 2 },
    { tool: 'delegate', engine: 'claude', ts: T0 + 3, workerUsage: wu(10, 4, 2, 0.3) },
  ];
  const by = workersByEngine(log, T0, T0 + 10);
  assert.deepEqual(Object.keys(by).sort(), ['claude', 'codex']);
  assert.equal(by.codex.calls, 2);
  assert.equal(by.codex.measured, 1);
  assert.equal(by.codex.inputTokens, 100);
  assert.equal(by.claude.costUsd, 0.3);
});

test('daySummary: uma linha por sessão, janelas sobrepostas marcam chamadas ambíguas', () => {
  const s1 = { id: 'a', events: [turn('m1', at(0), { input_tokens: 1, output_tokens: 10 }), turn('m2', at(30), { input_tokens: 1, output_tokens: 10 })] };
  const s2 = { id: 'b', events: [turn('n1', at(20), { input_tokens: 1, output_tokens: 4 }), turn('n2', at(60), { input_tokens: 1, output_tokens: 4 })] };
  const log = [
    { tool: 'explore', engine: 'codex', ts: T0 + 5 * 60_000, workerUsage: wu(100, 0, 5) }, // só a
    { tool: 'explore', engine: 'codex', ts: T0 + 25 * 60_000, workerUsage: wu(200, 0, 5) }, // a e b
    { tool: 'explore', engine: 'codex', ts: T0 + 90 * 60_000, workerUsage: wu(300, 0, 5) }, // nenhuma
  ];
  const day = daySummary([s1, s2], log);
  assert.equal(day.sessions.length, 2);
  assert.equal(day.sessions[0].workers.codex.calls, 2);
  assert.equal(day.sessions[1].workers.codex.calls, 1);
  assert.equal(day.ambiguousCalls, 1);
  assert.equal(day.outsideCalls, 1);
  assert.equal(day.workerTotals.codex.calls, 2); // a chamada ambígua conta uma vez no total
  assert.equal(day.workerTotals.codex.inputTokens, 300);
});

test('daySummary com transcript lixo, sessão sem usage e log malformado não lança', () => {
  const day = daySummary([{ id: 'x', events: [null, 'texto', { type: 'assistant', message: {} }] }, { id: 'y' }],
    [null, { tool: 'explore', engine: 'codex', ts: 'ontem', workerUsage: 'x' }, { tool: 'explore' }]);
  assert.equal(day.sessions.length, 0);
  assert.equal(day.outsideCalls, 0);
});

test('o relatório diz o que não dá para concluir', () => {
  const s1 = { id: 'sessao-1', events: [turn('m1', at(0), { input_tokens: 1, output_tokens: 10 }), turn('m2', at(30), { input_tokens: 1, output_tokens: 10 })] };
  const text = renderDayReport(daySummary([s1], [{ tool: 'delegate', engine: 'codex', ts: T0 + 60_000, workerUsage: wu(100, 80, 5) }]));
  assert.match(text, /sessao-1/);
  assert.match(text, /codex/);
  assert.match(text, /sem baseline/i);
  assert.match(text, /cota real/i);
  assert.match(renderDayReport(daySummary([], [])), /nenhuma sessão/i);
});
