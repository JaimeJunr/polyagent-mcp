/**
 * Custos por tarefa do índice geral da AA; fonte: research/2026-09-24-custo-por-tarefa.md
 * (Sonnet 5.5: research/2026-09-28-sonnet-5-5.md;
 * GPT-6.1 Sol: research/2026-09-30-gpt-6-1-sol.md; Haiku 5.5: research/2026-10-07-haiku-5-5.md).
 */
export const AA_COST_PER_TASK: Record<string, number> = {
  "codex|gpt-6-luna|low": 0.0045,
  "codex|gpt-6-luna|medium": 0.02,
  "codex|gpt-6-luna|high": 0.03,
  "codex|gpt-6-luna|xhigh": 0.04,
  "codex|gpt-6-luna|max": 0.07,
  "codex|gpt-6-sol|low": 0.13,
  "codex|gpt-6-sol|medium": 0.25,
  "codex|gpt-6-sol|high": 0.37,
  "codex|gpt-6-sol|xhigh": 0.53,
  "codex|gpt-6-sol|max": 1.06,
  "codex|gpt-6.1-sol|low": 0.13,
  "codex|gpt-6.1-sol|medium": 0.21,
  "codex|gpt-6.1-sol|high": 0.32,
  "codex|gpt-6.1-sol|xhigh": 0.39,
  "codex|gpt-6.1-sol|max": 0.72,
  "codex|gpt-6-astra|low": 0.82,
  "codex|gpt-6-astra|medium": 1.54,
  "codex|gpt-6-astra|high": 1.73,
  "codex|gpt-6-astra|xhigh": 2.31,
  "codex|gpt-6-astra|max": 3.26,
  "claude|claude-fable-5-1|low": 2.37,
  "claude|claude-fable-5-1|medium": 2.98,
  "claude|claude-fable-5-1|high": 3.91,
  "claude|claude-fable-5-1|xhigh": 5.98,
  "claude|claude-fable-5-1|max": 7.63,
  "claude|claude-opus-5-5|low": 0.55,
  "claude|claude-opus-5-5|medium": 1.34,
  "claude|claude-opus-5-5|high": 1.82,
  "claude|claude-opus-5-5|xhigh": 3.46,
  "claude|claude-opus-5-5|max": 5.98,
  "claude|claude-opus-5|low": 1.10,
  "claude|claude-opus-5|medium": 2.19,
  "claude|claude-opus-5|high": 3.61,
  "claude|claude-opus-5|xhigh": 4.88,
  "claude|claude-opus-5|max": 5.86,
  "claude|claude-fable-5|max": 8.75,
  "claude|claude-sonnet-5-5|low": 0.41,
  "claude|claude-sonnet-5-5|medium": 0.59,
  "claude|claude-sonnet-5-5|high": 1.08,
  "claude|claude-sonnet-5-5|xhigh": 2.74,
  "claude|claude-sonnet-5-5|max": 7.60,
  "claude|claude-sonnet-5|low": 0.51,
  "claude|claude-sonnet-5|medium": 1.00,
  "claude|claude-sonnet-5|high": 1.79,
  "claude|claude-sonnet-5|xhigh": 2.87,
  "claude|claude-sonnet-5|max": 5.09,
  "claude|claude-opus-4-8|max": 4.08,
  "claude|claude-sonnet-4-6|max": 2.49,
  // A AA só publica Haiku com extended thinking; qualquer effort registrado usa esse proxy.
  "claude|claude-haiku-4-5-20251001|*": 0.21,
  // Haiku 5.5 (2026-10-07) é o primeiro Haiku com effort; xhigh não publicado pela AA.
  "claude|claude-haiku-5-5|low": 0.02,
  "claude|claude-haiku-5-5|medium": 0.05,
  "claude|claude-haiku-5-5|high": 0.08,
  "claude|claude-haiku-5-5|max": 0.21,
  // FAST_CANDIDATES registra o alias `haiku`, não o id completo, no log de uso. Desde 2026-10-07 o
  // alias resolve para o Haiku 5.5 (confirmado no `modelUsage`); registros anteriores eram o 4.5.
  "claude|haiku|low": 0.02,
  "claude|haiku|medium": 0.05,
  "claude|haiku|high": 0.08,
  "claude|haiku|max": 0.21,
};

export function estimateCostPerTask(engine?: string, model?: string, effort?: string): number | undefined {
  if (!engine || !model || !effort) return undefined;
  return AA_COST_PER_TASK[`${engine}|${model}|${effort}`]
    ?? AA_COST_PER_TASK[`${engine}|${model}|*`];
}
