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

test('usa o total final do CLI (result.modelUsage) em vez do parcial do streaming', () => {
  const events = [
    { ...turn('m1', '2026-11-17T10:00:00.000Z', { input_tokens: 10, output_tokens: 160, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }) },
    { type: 'result', timestamp: '2026-11-17T10:00:05.000Z', modelUsage: { 'claude-x': { inputTokens: 10, outputTokens: 1049, cacheReadInputTokens: 100, cacheCreationInputTokens: 0 } } },
  ];
  const host = hostFromTranscript(events);
  assert.equal(host.tokens.output_tokens, 1049);
  assert.equal(host.units, proxyUnits({ input_tokens: 10, output_tokens: 1049, cache_read_input_tokens: 100 }));
});

test('transcript sem result.modelUsage segue usando os tokens do streaming', () => {
  const host = hostFromTranscript([turn('m1', '2026-11-17T10:00:00.000Z', { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })]);
  assert.equal(host.tokens.output_tokens, 3);
});

import { transcriptMayHoldDay, workerSessionIds } from './host-cost-core.mjs';

test('transcript modificado depois do dia ainda é candidato; o anterior ao dia não', () => {
  const nextDay = new Date(2026, 10, 17, 9, 0).getTime();
  const sameDay = new Date(2026, 10, 16, 22, 0).getTime();
  const dayBefore = new Date(2026, 10, 15, 23, 59).getTime();
  assert.equal(transcriptMayHoldDay(nextDay, '2026-11-16'), true); // sessão cruzou a meia-noite / foi retomada
  assert.equal(transcriptMayHoldDay(sameDay, '2026-11-16'), true);
  assert.equal(transcriptMayHoldDay(dayBefore, '2026-11-16'), false);
  assert.equal(transcriptMayHoldDay(Number.NaN, '2026-11-16'), false);
});

test('workerSessionIds extrai o id dos handles do log e ignora lixo', () => {
  const ids = workerSessionIds([{ sessionId: 'claude:w1' }, { sessionId: 'codex:c9' }, { sessionId: 'sem-prefixo' }, null, { sessionId: 7 }, {}]);
  assert.deepEqual([...ids].sort(), ['c9', 'w1']);
});

test('daySummary: transcript de worker Claude (id no log) não entra como host', () => {
  const host = { id: 'host-1', events: [turn('h1', at(0), { input_tokens: 10, output_tokens: 2 })] };
  const worker = { id: 'w1', events: [turn('w1m', at(1), { input_tokens: 1000, output_tokens: 1000 })] };
  const day = daySummary([host, worker], [{ tool: 'delegate', engine: 'claude', sessionId: 'claude:w1', ts: T0 + 30_000, workerUsage: wu(2000, 0, 0) }]);
  assert.equal(day.sessions.length, 1);
  assert.equal(day.hostTotal.tokens.input_tokens + day.hostTotal.tokens.output_tokens, 12); // 10 + 2, sem os 2.000 do worker
});

test('total do dia deduplica message.id repetido entre transcripts (cópia/retomada)', () => {
  const a = { id: 'a', events: [turn('m1', at(0), { input_tokens: 5, output_tokens: 3 }), turn('m2', at(5), { input_tokens: 1, output_tokens: 1 })] };
  const b = { id: 'b', events: [turn('m1', at(1), { input_tokens: 5, output_tokens: 9 })] }; // mesma resposta, snapshot maior
  const day = daySummary([a, b], []);
  assert.equal(day.hostTotal.tokens.output_tokens, 10); // m1 pelo máximo (9) + m2 (1), não 3+1+9
  assert.equal(day.hostTotal.tokens.input_tokens, 6);
  assert.match(renderDayReport(day), new RegExp(`Total host: ${Math.round(day.hostTotal.units)} unidades`));
});

test('total do dia preserva o total final do CLI (result.modelUsage) e bate com a linha da sessão', () => {
  const s = { id: 'f', events: [
    turn('m1', at(0), { input_tokens: 10, output_tokens: 160, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }),
    { type: 'result', timestamp: at(1), modelUsage: { 'claude-x': { inputTokens: 10, outputTokens: 1049, cacheReadInputTokens: 100, cacheCreationInputTokens: 0 } } },
  ] };
  const day = daySummary([s], []);
  assert.equal(day.sessions[0].host.tokens.output_tokens, 1049);
  assert.equal(day.hostTotal.tokens.output_tokens, 1049);
  assert.equal(day.hostTotal.units, day.sessions[0].host.units);
});

const finalSession = (id, streamOut, finalOut, msg = 'm1') => ({ id, events: [
  turn(msg, at(0), { input_tokens: 10, output_tokens: streamOut, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
  { type: 'result', timestamp: at(1), modelUsage: { 'claude-x': { inputTokens: 10, outputTokens: finalOut, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } },
] });

test('total do dia não conta duas vezes o total final de transcripts copiados', () => {
  const day = daySummary([finalSession('a', 160, 1049), finalSession('b', 160, 1049)], []);
  assert.equal(day.hostTotal.tokens.output_tokens, 1049);
});

test('total do dia acompanha correção para baixo do total final', () => {
  const day = daySummary([finalSession('a', 100, 80)], []);
  assert.equal(day.sessions[0].host.tokens.output_tokens, 80);
  assert.equal(day.hostTotal.tokens.output_tokens, 80);
});
