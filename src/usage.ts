import { appendFileSync, readFileSync } from "node:fs";

/** Arquivo de log de uso (JSONL). Logging só acontece se esta env estiver setada. */
export const USAGE_LOG = process.env.POLYAGENT_LOG;

export interface UsageEntry {
  ts: number;
  tool: string;
  /** Chars devolvidos ao contexto do chamador — o custo real da chamada. */
  outChars: number;
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
      out.push(JSON.parse(line) as UsageEntry);
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
    if (!r.engine) continue;
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
