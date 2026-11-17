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
