import { summarizeEvents } from './quota-eval-core.mjs';

// Pesos de proxy (NÃO é fatura): relação de preço de entrada da API Anthropic — cache read 0,1×,
// cache write 1,25×, saída 5× o input comum. Serve só para comparar sessões entre si.
export const PROXY_WEIGHTS = { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 };
const WORKER_TOOLS = new Set(['delegate', 'explore', 'read_slice', 'run_filtered', 'web_lookup', 'fan_out', 'follow_up', 'generate_image']);

/** Unidades equivalentes de input comum para um conjunto de tokens do host (campos da API). */
export function proxyUnits(tokens) {
  const n = key => (typeof tokens?.[key] === 'number' ? tokens[key] : 0);
  return n('input_tokens') * PROXY_WEIGHTS.input + n('cache_read_input_tokens') * PROXY_WEIGHTS.cacheRead
    + n('cache_creation_input_tokens') * PROXY_WEIGHTS.cacheWrite + n('output_tokens') * PROXY_WEIGHTS.output;
}

/**
 * Host de uma sessão do Claude Code: eventos do transcript em ~/.claude/projects/<dir>/<id>.jsonl.
 * Reaproveita summarizeEvents (dedup por message.id). Janela = primeiro e último timestamp.
 * Linhas sem usage ou sem timestamp não quebram: viram tokens zerados / janela nula.
 */
export function hostFromTranscript(events) {
  const stamps = events.map(e => Date.parse(e?.timestamp)).filter(Number.isFinite);
  const summary = summarizeEvents(events.filter(e => e && typeof e === 'object'));
  return {
    tokens: summary.tokens,
    units: proxyUnits(summary.tokens),
    startMs: stamps.length ? Math.min(...stamps) : null,
    endMs: stamps.length ? Math.max(...stamps) : null,
  };
}

/** Início (hora local) do dia AAAA-MM-DD, em ms. */
export function startOfDayMs(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * Um transcript pode ter eventos do dia se foi escrito nele ou depois (sessão que cruzou a meia-noite
 * ou foi retomada). Só descarta o que parou antes do dia; o filtro por timestamp de evento decide o resto.
 */
export function transcriptMayHoldDay(mtimeMs, day) {
  return Number.isFinite(mtimeMs) && mtimeMs >= startOfDayMs(day);
}

/**
 * Ids de sessão de worker registrados no log (`sessionId` = `<engine>:<id>`). O sandbox grava o transcript
 * do worker Claude em ~/.claude/projects, ao lado dos do host; sem excluir, o worker contaria como host.
 */
export function workerSessionIds(logEntries) {
  const ids = new Set();
  for (const entry of Array.isArray(logEntries) ? logEntries : []) {
    const handle = entry?.sessionId;
    if (typeof handle !== 'string') continue;
    const at = handle.indexOf(':');
    if (at > 0 && at < handle.length - 1) ids.add(handle.slice(at + 1));
  }
  return ids;
}

/** Soma o workerUsage do POLYAGENT_LOG dentro da janela da sessão. Entrada sem o campo conta só em `calls`. */
export function workersInWindow(entries, startMs, endMs) {
  const total = { calls: 0, measured: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0, measuredCost: 0 };
  if (startMs === null || endMs === null) return total;
  for (const entry of entries) {
    if (!WORKER_TOOLS.has(entry?.tool) || !(entry.ts >= startMs && entry.ts <= endMs) || !entry.engine) continue;
    total.calls += 1;
    const usage = entry.workerUsage;
    if (!usage || typeof usage !== 'object') continue;
    total.measured += 1;
    for (const [from, to] of [['inputTokens', 'inputTokens'], ['cachedInputTokens', 'cachedInputTokens'], ['outputTokens', 'outputTokens']]) {
      if (Number.isFinite(usage[from])) total[to] += usage[from];
    }
    if (Number.isFinite(usage.costUsd)) { total.costUsd += usage.costUsd; total.measuredCost += 1; }
  }
  return total;
}

/** Relatório "host + worker". O worker fica em categoria própria: assinaturas diferentes não se somam. */
export function hostPlusWorker(hostEvents, logEntries) {
  const host = hostFromTranscript(hostEvents);
  const worker = workersInWindow(logEntries, host.startMs, host.endMs);
  return { host, worker, unmeasuredWorkerCalls: worker.calls - worker.measured };
}

/** Compara duas sessões (ex.: sem e com delegação) pelas unidades de proxy do host. */
export function compareHosts(alone, withWorker) {
  const base = alone.host.units;
  return {
    aloneUnits: base, withWorkerUnits: withWorker.host.units,
    hostChangePct: base ? (withWorker.host.units / base - 1) * 100 : null,
    workerTokens: withWorker.worker.inputTokens + withWorker.worker.outputTokens,
    workerUnmeasured: withWorker.unmeasuredWorkerCalls,
  };
}

const isWorkerEntry = entry => WORKER_TOOLS.has(entry?.tool) && typeof entry.engine === 'string' && Number.isFinite(entry.ts);

/** Consumo do worker na janela, separado por engine (codex e claude são assinaturas diferentes). */
export function workersByEngine(entries, startMs, endMs) {
  const out = {};
  if (startMs === null || endMs === null) return out;
  for (const entry of entries) {
    if (!isWorkerEntry(entry) || entry.ts < startMs || entry.ts > endMs) continue;
    const slot = out[entry.engine] ??= { calls: 0, measured: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0, measuredCost: 0 };
    slot.calls += 1;
    const usage = entry.workerUsage;
    if (!usage || typeof usage !== 'object') continue;
    slot.measured += 1;
    for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens']) if (Number.isFinite(usage[key])) slot[key] += usage[key];
    if (Number.isFinite(usage.costUsd)) { slot.costUsd += usage.costUsd; slot.measuredCost += 1; }
  }
  return out;
}

/**
 * Resumo do dia: uma linha por sessão do host (`{id, events}`) com tokens do host e workers por engine.
 * O log do Polyagent não guarda o id da sessão do host, então o vínculo é por janela de tempo:
 * chamada que cai em mais de uma janela vira `ambiguousCalls` (aparece nas duas sessões) e a que não
 * cai em nenhuma vira `outsideCalls`. Sessão sem timestamp é descartada, nunca lança.
 */
export function daySummary(sessions, logEntries) {
  const rows = [];
  const hostEvents = [];
  const finalExtra = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const claimedIds = new Set(); // message.id de sessões com total final já contabilizado: cópia/retomada não corrige de novo
  const workerIds = workerSessionIds(logEntries);
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (workerIds.has(String(session?.id))) continue;
    const events = Array.isArray(session?.events) ? session.events : [];
    const host = hostFromTranscript(events);
    if (host.startMs === null) continue;
    hostEvents.push(...events.filter(event => event && typeof event === 'object' && event.type !== 'result'));
    // Total final do CLI (result.modelUsage) vale mais que o streaming: aplica a diferença (também para baixo)
    // entre final e streaming da sessão, para o total do dia bater com a linha. Transcript que repete
    // mensagens de uma sessão já corrigida (cópia/retomada) não aplica a correção outra vez.
    const own = summarizeEvents(events.filter(e => e && typeof e === 'object'));
    const ids = events.map(e => e?.message?.id).filter(id => typeof id === 'string');
    if (own.tokenSource === 'result.modelUsage' && !ids.some(id => claimedIds.has(id))) {
      ids.forEach(id => claimedIds.add(id));
      for (const field of Object.keys(finalExtra)) finalExtra[field] += (own.tokens[field] ?? 0) - (own.streamTokens[field] ?? 0);
    }
    rows.push({ id: String(session.id ?? '?'), host, workers: workersByEngine(logEntries, host.startMs, host.endMs) });
  }
  let ambiguousCalls = 0;
  let outsideCalls = 0;
  for (const entry of logEntries) {
    if (!isWorkerEntry(entry)) continue;
    const hits = rows.filter(row => entry.ts >= row.host.startMs && entry.ts <= row.host.endMs).length;
    if (hits > 1) ambiguousCalls += 1;
    if (hits === 0) outsideCalls += 1;
  }
  const inside = logEntries.filter(entry => isWorkerEntry(entry) && rows.some(row => entry.ts >= row.host.startMs && entry.ts <= row.host.endMs));
  // Total sem dupla contagem: cada chamada do log entra uma vez, mesmo caindo em duas janelas.
  const workerTotals = workersByEngine(inside, -Infinity, Infinity);
  // Total do dia com dedup global por message.id (máximo por campo): transcript copiado ou retomado repete
  // mensagens, e somar as linhas por sessão contaria cada uma duas vezes. Linhas por sessão seguem independentes.
  const stream = summarizeEvents(hostEvents).streamTokens;
  const hostTokens = Object.fromEntries(Object.keys(finalExtra).map(field => [field, Math.max(0, (stream[field] ?? 0) + finalExtra[field])]));
  const hostTotal = { tokens: hostTokens, units: proxyUnits(hostTokens) };
  return { sessions: rows.sort((a, b) => a.host.startMs - b.host.startMs), ambiguousCalls, outsideCalls, workerTotals, hostTotal };
}

const fmt = n => Math.round(n).toLocaleString('en-US');

/** Texto para o fim do dia. As ressalvas fazem parte do relatório, não de um rodapé opcional. */
export function renderDayReport(day) {
  if (!day.sessions.length) return 'Host vs worker: nenhuma sessão do host com timestamp na janela pedida.';
  const lines = ['Host vs worker (tokens declarados pelos CLIs; unidades = proxy de preço da API, não fatura)'];
  for (const row of day.sessions) {
    const t = row.host.tokens;
    const minutes = Math.round((row.host.endMs - row.host.startMs) / 60_000);
    lines.push('', `sessão ${row.id.slice(0, 8)} · ${new Date(row.host.startMs).toISOString().slice(0, 16)}Z · ${minutes} min`,
      `  host: in ${fmt(t.input_tokens)} · cache read ${fmt(t.cache_read_input_tokens)} · cache write ${fmt(t.cache_creation_input_tokens)} · out ${fmt(t.output_tokens)} · ${fmt(row.host.units)} unidades`);
    for (const [engine, w] of Object.entries(row.workers)) {
      const cost = w.measuredCost ? ` · custo reportado $${w.costUsd.toFixed(4)}` : '';
      lines.push(`  worker ${engine}: ${w.calls} chamadas (${w.measured} medidas) · in ${fmt(w.inputTokens)} (cache ${fmt(w.cachedInputTokens)}) · out ${fmt(w.outputTokens)}${cost}`);
    }
    if (!Object.keys(row.workers).length) lines.push('  worker: nenhuma chamada na janela');
  }
  lines.push('', `Total host: ${fmt(day.hostTotal.units)} unidades em ${day.sessions.length} sessões (sem contar duas vezes a mesma resposta repetida entre transcripts)`);
  for (const [engine, s] of Object.entries(day.workerTotals ?? {})) lines.push(`Total worker ${engine}: ${s.calls} chamadas (${s.measured} medidas) · in ${fmt(s.inputTokens)} (cache ${fmt(s.cachedInputTokens)}) · out ${fmt(s.outputTokens)}`);
  lines.push('', 'O que NÃO dá para concluir:',
    '- Sem baseline "host sozinho" para a mesma tarefa, a economia continua não demonstrada: este relatório mostra o que cada lado gastou, não o que se evitou.',
    '- Tokens do worker e do host estão em assinaturas diferentes; somar os dois exigiria a conversão para cota real, que não é medida.',
    '- Cota real da assinatura não aparece aqui; só o consumo declarado pelos CLIs.',
    `- Vínculo host↔worker é por janela de tempo: ${day.ambiguousCalls} chamadas caíram em mais de uma sessão (contadas em cada uma) e ${day.outsideCalls} em nenhuma.`);
  return lines.join('\n');
}
