// Ajuste da fase B da calibração de cota (issue #108): %/US$ da janela de 5 h por bloco e na regressão conjunta.
//   node bench/quota-calibration-fit.mjs <calibration-trials.jsonl> [modelo cuja saída vira coluna própria...]
// Todos os blocos precisam estar na mesma janela de 5 h (mesmo `fiveHourResetsAt`); o script recusa se não estiverem.
import { readFileSync } from 'node:fs';
import { SONNET_PRICE, cumulativeAt, leastSquares, parseJsonLines } from './quota-calibration-core.mjs';

const [path, ...splitModels] = process.argv.slice(2);
if (!path) throw new Error(`invalid arguments: received ${JSON.stringify(process.argv.slice(2))}, expected <calibration-trials.jsonl> [models...]`);
const trials = parseJsonLines(readFileSync(path, 'utf8'));
const windows = new Set(trials.flatMap(t => [t.first, t.last]).filter(Boolean).map(r => r.fiveHourResetsAt));
if (windows.size !== 1) throw new Error(`invalid input: received readings from ${windows.size} five-hour windows (${[...windows]}), expected 1`);

// Leitura no início do trial vê só os trials já terminados; a do fim (se houve mais de um evento) inclui o próprio.
const readings = trials.flatMap(t => [{ ts: t.startMs, value: t.first?.fiveHour, block: t.block },
  ...(t.rateLimitEvents > 1 ? [{ ts: t.endMs + 1, value: t.last?.fiveHour, block: t.block }] : [])]).filter(r => r.value != null);

/** Uma coluna da regressão por grupo; a saída dos modelos em `splitModels` (a preço de Sonnet) vira coluna à parte. @param {(t:any, model:string, usage:any)=>[string, number][]} split */
function fit(split, onlyBlock) {
  const records = trials.flatMap(t => Object.entries(t.modelUsage ?? {}).flatMap(([model, usage]) => split(t, model, usage).map(([group, usd]) => ({ ts: t.endMs, group, usd }))));
  const groups = [...new Set(records.map(r => r.group))];
  const points = cumulativeAt(records, readings.filter(r => !onlyBlock || r.block === onlyBlock), r => r.group, r => r.usd, groups, 0);
  const result = leastSquares(points.map(p => groups.map(g => p.totals[g])), points.map(p => p.reading.value));
  return { groups, result };
}

const print = (label, { groups, result }) => {
  if (!result) return console.log(`${label}: sem ajuste (colunas colineares ou poucos pontos)`);
  const cols = groups.map((g, i) => `${g} ${result.coefficients[i].toFixed(4)} ±${result.stdErrors[i].toFixed(4)} %/US$`).join('; ');
  console.log(`${label}: n=${result.n} resíduo=${result.residualSd.toFixed(3)} intercepto=${result.intercept.toFixed(2)} | ${cols}`);
};

for (const block of [...new Set(trials.map(t => t.block))]) {
  print(block, fit((t, _model, usage) => (t.block === block ? [[block, usage.costUSD]] : []), block));
}
print('conjunta', fit((_t, model, usage) => {
  if (!splitModels.includes(model)) return [[model, usage.costUSD]];
  const output = usage.outputTokens * SONNET_PRICE.output;
  return [[`${model}:saida`, output], [`${model}:resto`, usage.costUSD - output]];
}));
