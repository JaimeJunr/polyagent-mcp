// Calibração do proxy de custo contra a cota real (issue #108). Funções puras; o I/O fica em quota-calibration.mjs.

// Preço de lista do Sonnet 5.5 por token (US$), ajustado nos 140 `modelUsage.costUSD` do bench (resíduo 3e-16).
// Serve de régua comum: os outros modelos entram com coeficiente próprio na regressão, sem supor preço.
export const SONNET_PRICE = { input: 2e-6, output: 10e-6, cacheRead: 0.1e-6, cacheWrite5m: 2.5e-6, cacheWrite1h: 4e-6 };

/** US$ a preço de Sonnet de um registro de uso do Claude. @param {{input:number,output:number,cacheRead:number,cacheWrite5m:number,cacheWrite1h:number}} r */
export function sonnetUsd(r) {
  return r.input * SONNET_PRICE.input + r.output * SONNET_PRICE.output + r.cacheRead * SONNET_PRICE.cacheRead
    + r.cacheWrite5m * SONNET_PRICE.cacheWrite5m + r.cacheWrite1h * SONNET_PRICE.cacheWrite1h;
}

const num = value => (Number.isFinite(value) ? value : 0);

/**
 * Mensagens do assistente de um transcript do Claude Code, uma por `message.id`. O transcript repete a mesma
 * mensagem a cada bloco de conteúdo; fica o máximo de cada campo e o primeiro timestamp.
 * @param {Record<string, any>[]} events
 */
export function claudeUsageRecords(events) {
  const byId = new Map();
  for (const event of events) {
    const message = event?.message;
    const ts = Date.parse(event?.timestamp);
    if (event?.type !== 'assistant' || !message?.id || !message.usage || !Number.isFinite(ts)) continue;
    const usage = message.usage;
    const split = usage.cache_creation ?? {};
    const total = num(usage.cache_creation_input_tokens);
    const oneHour = num(split.ephemeral_1h_input_tokens);
    // Sem o detalhamento, a escrita de cache conta como 5 min (o padrão da API).
    const fiveMin = split.ephemeral_5m_input_tokens !== undefined ? num(split.ephemeral_5m_input_tokens) : total - oneHour;
    // `entrypoint` separa a conta: o app desktop e o CLI (`claude -p`, terminal) podem estar logados em contas diferentes.
    const next = { id: message.id, ts, model: message.model ?? 'unknown', entrypoint: event.entrypoint ?? null, input: num(usage.input_tokens), output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens), cacheWrite5m: fiveMin, cacheWrite1h: oneHour };
    const prior = byId.get(message.id);
    if (!prior) { byId.set(message.id, next); continue; }
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h']) prior[field] = Math.max(prior[field], next[field]);
    prior.ts = Math.min(prior.ts, next.ts);
  }
  return [...byId.values()];
}

/**
 * Primeira leitura de cota de um trial `claude -p` (stream-json). O evento sai na primeira chamada à API,
 * então reflete o uso de antes do trial; por isso recebe o horário de início do trial.
 * @param {Record<string, any>[]} events @param {number} startMs
 */
export function claudeReading(events, startMs) {
  const event = events.find(item => item?.type === 'rate_limit_event' && item.rate_limit_info?.unifiedWindows);
  if (!event || !Number.isFinite(startMs)) return null;
  const windows = event.rate_limit_info.unifiedWindows;
  const pct = value => (Number.isFinite(value) ? Math.round(value * 100) : null);
  return { ts: startMs, fiveHour: pct(windows.five_hour?.utilization), fiveHourResetsAt: windows.five_hour?.resetsAt ?? null,
    sevenDay: pct(windows.seven_day?.utilization), sevenDayResetsAt: windows.seven_day?.resetsAt ?? null };
}

/**
 * Eventos `token_count` de um rollout do Codex: leitura da cota semanal e o uso daquela chamada.
 * `last_token_usage` é o delta; `input_tokens` inclui o cache, então a entrada sem cache é a diferença.
 * @param {Record<string, any>[]} events @param {string} file
 */
export function codexRecords(events, file) {
  let account = null;
  let model = 'unknown';
  const records = [];
  for (const event of events) {
    const payload = event?.payload ?? {};
    if (event?.type === 'session_meta') account = payload.creator_account_id ?? account;
    if (event?.type === 'turn_context' && payload.model) model = payload.model;
    if (event?.type !== 'event_msg' || payload.type !== 'token_count') continue;
    const ts = Date.parse(event.timestamp);
    const primary = payload.rate_limits?.primary;
    const last = payload.info?.last_token_usage;
    if (!Number.isFinite(ts)) continue;
    const cached = num(last?.cached_input_tokens);
    records.push({ key: `${file}#${event.ordinal ?? records.length}`, ts, account, model,
      usedPercent: Number.isFinite(primary?.used_percent) ? primary.used_percent : null,
      windowMinutes: primary?.window_minutes ?? null, resetsAt: primary?.resets_at ?? null,
      uncached: Math.max(0, num(last?.input_tokens) - cached), cached, output: num(last?.output_tokens) });
  }
  return records;
}

/**
 * Mínimos quadrados `y = a + Σ k_j x_j` (eliminação de Gauss nas equações normais).
 * Devolve coeficientes, erro-padrão de cada um e o desvio do resíduo. Colunas sem variação viram null.
 * @param {number[][]} rows @param {number[]} y
 */
export function leastSquares(rows, y) {
  const n = rows.length;
  if (n !== y.length) throw new RangeError(`invalid input: received ${n} rows and ${y.length} targets, expected equal lengths`);
  const p = (rows[0]?.length ?? 0) + 1;
  if (n <= p) return null;
  const design = rows.map(row => [1, ...row]);
  const xtx = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => design.reduce((s, row) => s + row[i] * row[j], 0)));
  const xty = Array.from({ length: p }, (_, i) => design.reduce((s, row, r) => s + row[i] * y[r], 0));
  const inverse = invert(xtx);
  if (!inverse) return null;
  const beta = inverse.map(row => row.reduce((s, v, j) => s + v * xty[j], 0));
  const residuals = design.map((row, r) => y[r] - row.reduce((s, v, j) => s + v * beta[j], 0));
  const sigma2 = residuals.reduce((s, v) => s + v * v, 0) / (n - p);
  return { intercept: beta[0], coefficients: beta.slice(1), stdErrors: inverse.slice(1).map((row, i) => Math.sqrt(sigma2 * row[i + 1])),
    residualSd: Math.sqrt(sigma2), n };
}

/** @param {number[][]} matrix */
function invert(matrix) {
  const size = matrix.length;
  const work = matrix.map((row, i) => [...row, ...Array.from({ length: size }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let r = col + 1; r < size; r++) if (Math.abs(work[r][col]) > Math.abs(work[pivot][col])) pivot = r;
    if (Math.abs(work[pivot][col]) < 1e-12 * Math.max(1, Math.abs(matrix[col][col]))) return null;
    [work[col], work[pivot]] = [work[pivot], work[col]];
    const lead = work[col][col];
    for (let j = 0; j < 2 * size; j++) work[col][j] /= lead;
    for (let r = 0; r < size; r++) if (r !== col) {
      const factor = work[r][col];
      for (let j = 0; j < 2 * size; j++) work[r][j] -= factor * work[col][j];
    }
  }
  return work.map(row => row.slice(size));
}

/**
 * Uso acumulado por grupo (ex.: modelo) desde `fromMs` até cada leitura. Registros e leituras em ordem de tempo.
 * @param {{ts:number}[]} records @param {{ts:number}[]} readings @param {(r:any)=>string} group
 * @param {(r:any)=>number} amount @param {string[]} groups @param {number} fromMs
 */
export function cumulativeAt(records, readings, group, amount, groups, fromMs) {
  const sorted = records.filter(r => r.ts >= fromMs).sort((a, b) => a.ts - b.ts);
  const totals = Object.fromEntries(groups.map(g => [g, 0]));
  let index = 0;
  return [...readings].sort((a, b) => a.ts - b.ts).map(reading => {
    while (index < sorted.length && sorted[index].ts < reading.ts) {
      const key = group(sorted[index]);
      if (key in totals) totals[key] += amount(sorted[index]);
      index += 1;
    }
    return { reading, totals: { ...totals } };
  });
}
