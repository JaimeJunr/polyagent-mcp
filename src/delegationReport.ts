import type { UsageEntry } from "./usage.js";

// Relatório de delegação calculado só do POLYAGENT_LOG: funciona com qualquer host e não lê transcript.
// Não afirma economia nem perda: mostra uso, assinatura e fallback, que são o que decide se compensa.

const DAY_MS = 24 * 60 * 60 * 1000;
const NON_WORKER_TOOLS = new Set(["rate", "decide", "blocked_exfil", "bridge_stats"]);

export interface EngineCalls {
  calls: number;
  success: number;
  failure: number;
  quota: number;
  timeout: number;
}

export interface DelegationReport {
  windowDays: number;
  totalCalls: number;
  daysWithCalls: number;
  byEngine: Record<string, EngineCalls>;
  /** Chamadas na engine claude: a mesma assinatura de um host Claude Code. */
  hostSubscriptionCalls: number;
  hostSubscriptionShare: number;
  /** Chamadas em que o nível caiu da engine preferida para outra (matchedRequest false). */
  fallbackCalls: number;
  byLevel: Record<string, number>;
}

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function isWorkerCall(entry: UsageEntry): boolean {
  return Boolean(entry.engine) && entry.outcome !== "reset" && !NON_WORKER_TOOLS.has(entry.tool);
}

export function delegationReport(entries: UsageEntry[], now: number, windowDays = 7): DelegationReport {
  const since = now - windowDays * DAY_MS;
  const calls = entries.filter((e) => e.ts > since && e.ts <= now && isWorkerCall(e));
  const byEngine: Record<string, EngineCalls> = {};
  const byLevel: Record<string, number> = {};
  for (const e of calls) {
    const slot = byEngine[e.engine!] ??= { calls: 0, success: 0, failure: 0, quota: 0, timeout: 0 };
    slot.calls += 1;
    if (e.outcome === "success" || e.outcome === "failure" || e.outcome === "quota" || e.outcome === "timeout") slot[e.outcome] += 1;
    if (e.requestedLevel !== undefined) {
      // Nível numérico vem de log antigo: entra em "other" em vez de sumir.
      const key = typeof e.requestedLevel === "string" ? e.requestedLevel : "other";
      byLevel[key] = (byLevel[key] ?? 0) + 1;
    }
  }
  const hostSubscriptionCalls = byEngine.claude?.calls ?? 0;
  return {
    windowDays,
    totalCalls: calls.length,
    daysWithCalls: new Set(calls.map((e) => localDay(e.ts))).size,
    byEngine,
    hostSubscriptionCalls,
    hostSubscriptionShare: calls.length ? hostSubscriptionCalls / calls.length : 0,
    fallbackCalls: calls.filter((e) => e.matchedRequest === false).length,
    byLevel,
  };
}

export function renderDelegationReport(report: DelegationReport): string {
  const lines = [
    `Delegation, last ${report.windowDays} days (from your own log, nothing leaves this machine)`,
    `Days with worker calls: ${report.daysWithCalls} of ${report.windowDays} days. Worker calls: ${report.totalCalls}.`,
  ];
  if (report.totalCalls === 0) {
    lines.push("No worker calls in this window: having the tools loaded without delegating only adds fixed context cost (run `npm run doctor`).");
    return lines.join("\n");
  }
  for (const [engine, s] of Object.entries(report.byEngine)) {
    lines.push(`  ${engine}: ${s.calls} calls (${s.success} ok, ${s.failure} failed, ${s.quota} quota, ${s.timeout} timeout)`);
  }
  lines.push(
    `Calls on the claude engine: ${report.hostSubscriptionCalls} of ${report.totalCalls}. With a Claude Code host this is the same subscription as the host, so those calls do not save quota.`,
    `Calls that fell back from the level's preferred engine: ${report.fallbackCalls}.`,
    `Calls per requested level (only delegate records one): ${Object.entries(report.byLevel).map(([level, n]) => `${level} ${n}`).join(", ") || "none recorded"}.`,
    "Host cost with vs without delegation is not in this report: it needs the host's transcripts and compares different sessions.",
  );
  return lines.join("\n");
}
