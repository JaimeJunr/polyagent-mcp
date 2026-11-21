import { describe, expect, it } from 'vitest';
import { claudeUsageRecords, claudeReading, codexRecords, leastSquares, cumulativeAt, sonnetUsd } from './quota-calibration-core.mjs';

describe('claudeUsageRecords', () => {
  it('junta as linhas repetidas da mesma mensagem e separa a escrita de cache de 1 h', () => {
    const usage = { input_tokens: 3, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 50,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 } };
    const events = [
      { type: 'assistant', entrypoint: 'sdk-cli', timestamp: '2026-11-21T06:00:01Z', message: { id: 'm1', model: 'claude-opus-5-5', usage: { ...usage, output_tokens: 2 } } },
      { type: 'assistant', timestamp: '2026-11-21T06:00:02Z', message: { id: 'm1', model: 'claude-opus-5-5', usage } },
      { type: 'user', timestamp: '2026-11-21T06:00:03Z', message: { id: 'u1' } },
    ];
    const records = claudeUsageRecords(events);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ model: 'claude-opus-5-5', entrypoint: 'sdk-cli', output: 10, cacheWrite1h: 50, cacheWrite5m: 0, ts: Date.parse('2026-11-21T06:00:01Z') });
  });

  it('ignora linha sem timestamp ou sem usage e conta escrita sem detalhe como 5 min', () => {
    const events = [
      { type: 'assistant', message: { id: 'a', usage: { output_tokens: 1 } } },
      { type: 'assistant', timestamp: '2026-11-21T06:00:00Z', message: { id: 'b' } },
      { type: 'assistant', timestamp: '2026-11-21T06:00:00Z', message: { id: 'c', usage: { cache_creation_input_tokens: 7 } } },
    ];
    const records = claudeUsageRecords(events);
    expect(records.map(r => r.id)).toEqual(['c']);
    expect(records[0].cacheWrite5m).toBe(7);
  });
});

describe('sonnetUsd', () => {
  it('reproduz o costUSD do bench (trial real de 2026-11-15)', () => {
    const usd = sonnetUsd({ input: 10, output: 872, cacheRead: 105353, cacheWrite5m: 0, cacheWrite1h: 1098 });
    expect(usd).toBeCloseTo(0.0236673, 7);
  });
});

describe('claudeReading', () => {
  it('lê as duas janelas do primeiro rate_limit_event em pontos inteiros', () => {
    const events = [{ type: 'system' }, { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: {
      five_hour: { utilization: 0.15, resetsAt: 1794792000 }, seven_day: { utilization: 0.28, resetsAt: 1795086000 } } } }];
    expect(claudeReading(events, 1000)).toEqual({ ts: 1000, fiveHour: 15, fiveHourResetsAt: 1794792000, sevenDay: 28, sevenDayResetsAt: 1795086000 });
  });

  it('devolve null sem evento de cota', () => {
    expect(claudeReading([{ type: 'result' }], 1000)).toBeNull();
  });
});

describe('codexRecords', () => {
  it('separa entrada sem cache, cache e saída, com conta, modelo e cota', () => {
    const events = [
      { type: 'session_meta', payload: { creator_account_id: 'acc' } },
      { type: 'turn_context', payload: { model: 'gpt-6-luna' } },
      { type: 'event_msg', timestamp: '2026-11-21T06:19:19Z', ordinal: 21, payload: { type: 'token_count',
        info: { last_token_usage: { input_tokens: 24299, cached_input_tokens: 23168, output_tokens: 9 } },
        rate_limits: { primary: { used_percent: 24.0, window_minutes: 10080, resets_at: 1795311247 } } } },
    ];
    expect(codexRecords(events, 'f')).toEqual([{ key: 'f#21', ts: Date.parse('2026-11-21T06:19:19Z'), account: 'acc', model: 'gpt-6-luna',
      usedPercent: 24, windowMinutes: 10080, resetsAt: 1795311247, uncached: 1131, cached: 23168, output: 9 }]);
  });

  it('mantém o uso quando o evento não traz rate_limits', () => {
    const events = [{ type: 'event_msg', timestamp: '2026-11-21T06:00:00Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 5 } } } }];
    expect(codexRecords(events, 'f')[0]).toMatchObject({ usedPercent: null, uncached: 5 });
  });
});

describe('leastSquares', () => {
  it('recupera coeficientes exatos de duas colunas', () => {
    const rows = [[1, 0], [0, 1], [2, 1], [3, 5], [4, 2]];
    const y = rows.map(([a, b]) => 1 + 2 * a + 0.5 * b);
    const fit = leastSquares(rows, y);
    expect(fit.intercept).toBeCloseTo(1, 9);
    expect(fit.coefficients[0]).toBeCloseTo(2, 9);
    expect(fit.coefficients[1]).toBeCloseTo(0.5, 9);
    expect(fit.residualSd).toBeCloseTo(0, 9);
  });

  it('devolve null com coluna sem variação ou poucos pontos', () => {
    expect(leastSquares([[1], [1], [1], [1]], [1, 2, 3, 4])).toBeNull();
    expect(leastSquares([[1], [2]], [1, 2])).toBeNull();
  });
});

describe('cumulativeAt', () => {
  it('soma por grupo só o uso anterior a cada leitura e a partir do início da janela', () => {
    const records = [{ ts: 5, m: 'a', v: 100 }, { ts: 10, m: 'a', v: 1 }, { ts: 20, m: 'b', v: 2 }, { ts: 30, m: 'a', v: 4 }];
    const points = cumulativeAt(records, [{ ts: 25 }, { ts: 15 }, { ts: 40 }], r => r.m, r => r.v, ['a', 'b'], 8);
    expect(points.map(p => p.totals)).toEqual([{ a: 1, b: 0 }, { a: 1, b: 2 }, { a: 5, b: 2 }]);
  });
});
