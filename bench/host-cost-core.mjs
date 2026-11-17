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
    tokens: summary.streamTokens,
    units: proxyUnits(summary.streamTokens),
    startMs: stamps.length ? Math.min(...stamps) : null,
    endMs: stamps.length ? Math.max(...stamps) : null,
  };
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
