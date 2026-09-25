import { appendFileSync, readFileSync } from "node:fs";

/** Arquivo de log de uso (JSONL). Logging só acontece se esta env estiver setada. */
export const USAGE_LOG = process.env.POLYAGENT_LOG;

export interface DecisionRecord {
  name: string;
  candidates: string[];
  choice: string | null;
  confidence: number | null;
  accepted: boolean;
  fallback: boolean;
  latencyMs: number;
  cost?: number | null;
  actual?: string;
}

export interface UsageEntry {
  ts: number;
  tool: string;
  /** Chars devolvidos ao contexto do chamador — o custo real da chamada. */
  outChars: number;
  /** Handle engine:id exibido no footer e usado para ligar uma avaliação ao run. */
  sessionId?: string;
  /** Modelo efetivamente usado pelo CLI. */
  model?: string;
  /** Esforço efetivamente usado pelo CLI. */
  effort?: string;
  /** Tier-integrity receipt: nível pedido pelo chamador (só presente em tools com resolveTier). */
  requestedLevel?: number;
  /** true se a engine resolvida é a preferida do nível; false quando resolveTier caiu no fallback. */
  matchedRequest?: boolean;
  /** Engine que rodou a chamada (ex. "codex"|"grok"|"claude"|"cursor"). Usado por computeEngineHealth. */
  engine?: string;
  /**
   * Resultado da chamada. "quota" é um outcome PRÓPRIO (cota esgotada/rate limit), deliberadamente
   * fora de failure/timeout na classificação: a engine não quebrou, o plano acabou. No health,
   * pontua 0 igual a failure/timeout — engine sem saldo é engine indisponível.
   */
  outcome?: "success" | "failure" | "timeout" | "quota";
  /** Duração do run em ms. Usado por computeEngineHealth para penalizar latência alta. */
  durationMs?: number;
  /** Handle avaliado por um registro com tool="rate". */
  ratedSessionId?: string;
  /** Nota inteira de 1 a 5 de um registro com tool="rate". */
  score?: number;
  /** Observação opcional de uma avaliação. */
  note?: string;
  decision?: DecisionRecord;
}

export interface ToolStats {
  calls: number;
  totalOutChars: number;
  avgOutChars: number;
}

/** Receipt do tier resolvido para o nível pedido, injetado por quem chama resolveTier (src/cli.ts). */
export interface TierReceipt {
  requestedLevel: number;
  matchedRequest: boolean;
}

/** Métricas do run (engine que rodou, resultado, duração) — populadas pelo wrap em src/index.ts. */
export interface UsageRun {
  engine?: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  outcome?: UsageEntry["outcome"];
  durationMs?: number;
}

/**
 * Classifica o erro rejeitado por runCursor. Cota/rate limit vem como QuotaError (src/cli.ts) e
 * ganha outcome próprio — reconhecido pelo `name` em vez de import, para usage.ts seguir sem
 * depender do módulo que spawna processo. Timeout vem do setTimeout em cli.ts, que mata o child
 * com SIGKILL e rejeita com `<engine> agent timed out after <ms>ms: ...`. Qualquer outro erro
 * (exit ≠ 0, spawn fail) é "failure". Função pura.
 */
export function classifyOutcome(error: unknown): "failure" | "timeout" | "quota" {
  if (error instanceof Error && error.name === "QuotaError") return "quota";
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /agent timed out after \d+ms/.test(msg) ? "timeout" : "failure";
}

/** Monta o UsageEntry. Função pura — separada de logUsage para ser testável sem tocar o filesystem. */
export function buildUsageEntry(tool: string, outChars: number, tier?: TierReceipt, run?: UsageRun): UsageEntry {
  return { ts: Date.now(), tool, outChars, ...tier, ...run };
}

/** Registra uma chamada no JSONL. No-op se POLYAGENT_LOG não estiver setada. */
export function logUsage(tool: string, outChars: number, tier?: TierReceipt, run?: UsageRun): void {
  if (!USAGE_LOG) return;
  const entry = buildUsageEntry(tool, outChars, tier, run);
  try {
    appendFileSync(USAGE_LOG, JSON.stringify(entry) + "\n");
  } catch {
    // logging é best-effort; nunca derruba a chamada real.
  }
}

export function buildDecisionEntry(decision: DecisionRecord, now: number): UsageEntry {
  return {
    ts: now,
    tool: "decide",
    engine: "jev",
    outChars: 0,
    outcome: decision.choice === null ? "failure" : "success",
    durationMs: decision.latencyMs,
    decision,
  };
}

export function logDecision(decision: DecisionRecord): void {
  if (!USAGE_LOG) return;
  try {
    appendFileSync(USAGE_LOG, JSON.stringify(buildDecisionEntry(decision, Date.now())) + "\n");
  } catch {
    // O registro é best-effort; uma falha de disco não altera a decisão.
  }
}

/** Monta uma avaliação local de uma sessão. Função pura. */
export function buildRatingEntry(
  sessionHandle: string,
  score: number,
  note = "",
  now: number,
): UsageEntry {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error(`Invalid rating score: received ${String(score)}; expected an integer in range 1-5`);
  }
  if (!sessionHandle.trim()) {
    throw new Error("Invalid rating sessionHandle: sessionHandle must not be empty");
  }
  return {
    ts: now,
    tool: "rate",
    outChars: 0,
    ratedSessionId: sessionHandle,
    score,
    note: note.trim().slice(0, 300),
  };
}

/** Acrescenta uma avaliação ao JSONL sem deixar falhas de logging chegarem ao caller. */
export function logRating(
  sessionHandle: string,
  score: number,
  note = "",
  now: number = Date.now(),
): boolean {
  if (!USAGE_LOG) return false;
  try {
    const entry = buildRatingEntry(sessionHandle, score, note, now);
    appendFileSync(USAGE_LOG, JSON.stringify(entry) + "\n");
    return true;
  } catch {
    return false;
  }
}

export interface RatingStat {
  ratings: number;
  avgScore: number;
  calls: number;
  /** Fração entre 0 e 1; null quando nenhuma execução do grupo registrou outcome (0 leria como "sempre falha"). */
  successRate: number | null;
  p50DurationMs: number | null;
}

export type RatingStats = Record<string, RatingStat>;

function ratingGroupKey(entry: UsageEntry): string {
  const field = (value: string | undefined): string => value && value.length > 0 ? value : "-";
  return [field(entry.engine), field(entry.model), field(entry.effort), field(entry.tool)].join("|");
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Liga avaliações à última execução da sessão e agrega somente os grupos avaliados. */
export function ratingStats(entries: UsageEntry[]): RatingStats {
  const usageBySession = new Map<string, UsageEntry>();
  const usageByGroup = new Map<string, { calls: number; successes: number; withOutcome: number; durations: number[] }>();

  for (const entry of entries) {
    if (entry.tool === "rate") continue;
    if (entry.sessionId) usageBySession.set(entry.sessionId, entry);
    const key = ratingGroupKey(entry);
    const group = usageByGroup.get(key) ?? { calls: 0, successes: 0, withOutcome: 0, durations: [] };
    group.calls += 1;
    if (entry.outcome !== undefined) {
      group.withOutcome += 1;
      if (entry.outcome === "success") group.successes += 1;
    }
    if (typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)) {
      group.durations.push(entry.durationMs);
    }
    usageByGroup.set(key, group);
  }

  const scoresByGroup = new Map<string, number[]>();
  for (const entry of entries) {
    if (entry.tool !== "rate" || typeof entry.score !== "number" || !Number.isFinite(entry.score)) continue;
    const matched = entry.ratedSessionId ? usageBySession.get(entry.ratedSessionId) : undefined;
    const key = matched ? ratingGroupKey(matched) : "unknown";
    const scores = scoresByGroup.get(key) ?? [];
    scores.push(entry.score);
    scoresByGroup.set(key, scores);
  }

  const stats: RatingStats = {};
  for (const [key, scores] of scoresByGroup) {
    const usage = usageByGroup.get(key);
    const avgScore = Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
    stats[key] = {
      ratings: scores.length,
      avgScore,
      calls: usage?.calls ?? 0,
      successRate: usage && usage.withOutcome > 0 ? usage.successes / usage.withOutcome : null,
      p50DurationMs: median(usage?.durations ?? []),
    };
  }
  return stats;
}

/** Renderiza as avaliações em uma tabela curta, priorizando grupos com mais amostras. */
export function renderRatingStats(stats: RatingStats): string {
  const rows = Object.entries(stats)
    .sort(([aKey, a], [bKey, b]) => b.ratings - a.ratings || aKey.localeCompare(bKey))
    .map(([key, stat]) => {
      const success = stat.successRate === null ? "-" : `${(stat.successRate * 100).toFixed(1)}%`;
      const p50 = stat.p50DurationMs === null ? "-" : String(stat.p50DurationMs);
      return `| ${key.replaceAll("|", "\\|")} | ${stat.ratings} | ${stat.avgScore.toFixed(1)} | ${stat.calls} | ${success} | ${p50} |`;
    });
  return [
    "| group | ratings | avg score | calls | success rate | p50 durationMs |",
    "|---|---:|---:|---:|---:|---:|",
    ...rows,
  ].join("\n");
}

/** Lê e parseia o JSONL. Devolve [] se o arquivo não existir ou não houver log. */
export function readUsage(): UsageEntry[] {
  if (!USAGE_LOG) return [];
  let raw: string;
  try {
    raw = readFileSync(USAGE_LOG, "utf8");
  } catch {
    return [];
  }
  // Parse linha a linha e ignora as malformadas — uma escrita parcial ou edição
  // manual não deve zerar todas as stats.
  const out: UsageEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const entry = parsed as { tool?: unknown };
      if (typeof entry.tool !== "string") continue;
      out.push(parsed as UsageEntry);
    } catch {
      // pula a linha corrompida
    }
  }
  return out;
}

/** Default compatível: teto de latência usado só quando o chamador não injeta seu budget real. */
const LATENCY_CEIL_MS = 300_000;

/**
 * Janela longa de cota: 6h. Falha e timeout são sinais transitórios (duram minutos) e cabem na
 * janela curta de 30 min; cota é um sinal longo — dura horas, às vezes até o próximo ciclo de
 * cobrança. 6h cobre a lacuna medida no host (registro de 2h sumia da janela de 30 min e o
 * codex voltava a ser escolhido como "saudável por omissão") com folga de uma manhã de trabalho,
 * sem arrastar uma cota de ontem para o dia seguinte. Meia-vida = 6h/4 = 1,5h: peso ainda
 * relevante às 2–3h (o cenário que falhava), quase zero na borda das 6h; depois o registro
 * some do mapa e a engine é tentada de novo (aprendizado: se a cota ainda estiver lá, a
 * próxima chamada falha e regrava).
 */
export const QUOTA_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Piso do score de latência (nunca abaixo disso, mesmo pra um sucesso arbitrariamente lento).
 * PRECISA ficar acima de HEALTH_THRESHOLD (0.3, src/cli.ts) — é essa folga que garante que latência
 * SOZINHA nunca deixa uma engine "unhealthy"; só failure/timeout/quota (outcomeScore=0) derruba
 * abaixo do threshold. Sem esse piso, um teto de latência baixo (ou até o DEFAULT_TIMEOUT_MS
 * inteiro) ainda marcava sucessos lentos-mas-reais como engine quebrada — era o bug original, só
 * empurrado pra uma duração maior em vez de corrigido (ver test/health-latency-tdr.test.ts).
 */
export const LATENCY_FLOOR = 0.4;

/**
 * Deriva um score de saúde (0-1) por engine a partir do log de uso. Duas janelas: `windowMs`
 * (default 30min) cobre `success`/`failure`/`timeout` — sinais transitórios; `quotaWindowMs`
 * (default `QUOTA_WINDOW_MS` = 6h) cobre só `quota` — sinal longo. `latencyCeilMs` mantém o teto
 * antigo de 5min por compatibilidade, mas o runtime injeta seu timeout real para não confundir
 * sucesso dentro do budget com engine quebrada; um valor não-finito ou <= 0 (env mal configurada)
 * cai de volta pro default em vez de envenenar o score com NaN/Infinity. Cada registro pesa por
 * idade dentro da SUA janela (decaimento exponencial — meia-vida de 1/4 da janela daquele
 * registro), então falhas/timeouts recentes derrubam o score mais que os antigos, e cota decai
 * na escala de horas. Combina taxa de falha/timeout/quota (0 se outcome ruim, 1 se sucesso) com
 * um score de latência (penaliza runs bem-sucedidos mas lentos, com piso em LATENCY_FLOOR — ver
 * doc lá). Registros sem `engine` são ignorados — não há o que atribuir. Função pura; `now` é
 * injetado pelo chamador (src/index.ts fica com o I/O de ler o log e pegar Date.now()). Resultado
 * sempre clampado em [0,1].
 */
export function computeEngineHealth(
  records: UsageEntry[],
  now: number,
  windowMs: number = 30 * 60 * 1000,
  latencyCeilMs: number = LATENCY_CEIL_MS,
  quotaWindowMs: number = QUOTA_WINDOW_MS,
): Record<string, number> {
  const ceil = Number.isFinite(latencyCeilMs) && latencyCeilMs > 0 ? latencyCeilMs : LATENCY_CEIL_MS;
  const quotaWindow = Number.isFinite(quotaWindowMs) && quotaWindowMs > 0 ? quotaWindowMs : QUOTA_WINDOW_MS;
  const byEngine: Record<string, { weight: number; weightedScore: number }> = {};
  for (const r of records) {
    if (!r.engine || r.tool === "decide") continue;
    // Cota pontua 0 (não 1, não ignorada). O `continue` antigo existia para impedir que cota
    // INFLASSE o health: sem ele, cairia no ramo "não é failure/timeout" e pontuaria 1, exatamente
    // da engine que não pode mais ser usada. Pontuar 0 é a mesma intenção levada até o fim —
    // engine sem saldo é engine indisponível.
    //
    // Janela por natureza do sinal: failure/timeout usam `windowMs` (curta); quota usa
    // `quotaWindow` (longa). Engine sem registro na janela não entra no mapa, e resolveFastTier
    // trata omissão como saudável — era isso que fazia o codex ser reescolhido 31 min depois da
    // cota. Incluir a cota na janela longa fecha o buraco.
    //
    // Decaimento na escala da janela do registro (halfLife = recWindow/4), não numa meia-vida
    // única. Se a cota herdasse a meia-vida curta (7,5 min), um registro de 2h teria peso ~0 e
    // qualquer sucesso recente apagaria o sinal; com meia-vida de 1,5h o peso às 2h ainda é
    // ~0,4, então o health só sobe de verdade quando entram sucessos (cota resetou) e some
    // sozinho ao cruzar as 6h, sem lógica de expiração própria.
    const age = now - r.ts;
    if (age < 0) continue;
    const recWindow = r.outcome === "quota" ? quotaWindow : windowMs;
    if (age > recWindow) continue;
    const halfLife = recWindow / 4;
    const weight = Math.pow(0.5, age / halfLife);
    const outcomeScore = r.outcome === "failure" || r.outcome === "timeout" || r.outcome === "quota" ? 0 : 1;
    const latencyScore = r.durationMs !== undefined
      ? Math.max(LATENCY_FLOOR, 1 - r.durationMs / ceil)
      : 1;
    const bucket = byEngine[r.engine] ?? { weight: 0, weightedScore: 0 };
    bucket.weight += weight;
    bucket.weightedScore += weight * outcomeScore * latencyScore;
    byEngine[r.engine] = bucket;
  }
  const out: Record<string, number> = {};
  for (const [engine, b] of Object.entries(byEngine)) {
    out[engine] = b.weight > 0 ? Math.min(1, Math.max(0, b.weightedScore / b.weight)) : 1;
  }
  return out;
}

/** Agrega entradas por tool: nº de chamadas, total e média de chars devolvidos. Função pura. */
export function aggregate(entries: UsageEntry[]): Record<string, ToolStats> {
  const out: Record<string, ToolStats> = {};
  for (const e of entries) {
    const s = out[e.tool] ?? { calls: 0, totalOutChars: 0, avgOutChars: 0 };
    s.calls += 1;
    s.totalOutChars += e.outChars;
    s.avgOutChars = Math.round(s.totalOutChars / s.calls);
    out[e.tool] = s;
  }
  return out;
}
