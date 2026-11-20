import { describe, expect, it } from "vitest";
import { delegationReport, renderDelegationReport } from "../src/delegationReport.js";
import type { UsageEntry } from "../src/usage.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 15, 0, 0);

function call(daysAgo: number, extra: Partial<UsageEntry> = {}): UsageEntry {
  return { ts: NOW - daysAgo * DAY, tool: "delegate", outChars: 500, engine: "codex", outcome: "success", requestedLevel: "low", matchedRequest: true, ...extra };
}

describe("delegationReport", () => {
  it("conta dias com e sem chamada de worker na janela de 7 dias", () => {
    const report = delegationReport([call(0), call(0), call(2)], NOW);
    expect(report.windowDays).toBe(7);
    expect(report.daysWithCalls).toBe(2);
    expect(report.totalCalls).toBe(3);
  });

  it("separa por engine e resultado e ignora entradas fora da janela", () => {
    const report = delegationReport([
      call(1), call(1, { outcome: "failure" }), call(1, { engine: "claude", outcome: "quota" }), call(9),
    ], NOW);
    expect(report.totalCalls).toBe(3);
    expect(report.byEngine.codex).toEqual({ calls: 2, success: 1, failure: 1, quota: 0, timeout: 0 });
    expect(report.byEngine.claude.quota).toBe(1);
  });

  it("mostra quantas chamadas rodaram na assinatura do host (engine claude)", () => {
    const report = delegationReport([call(0), call(0, { engine: "claude" }), call(0, { engine: "claude" })], NOW);
    expect(report.hostSubscriptionCalls).toBe(2);
    expect(report.hostSubscriptionShare).toBeCloseTo(2 / 3);
  });

  it("conta fallback do nível quando matchedRequest é false", () => {
    const report = delegationReport([call(0), call(0, { matchedRequest: false, engine: "claude" })], NOW);
    expect(report.fallbackCalls).toBe(1);
  });

  it("conta chamadas por nível pedido e tolera nível numérico de log antigo", () => {
    const report = delegationReport([call(0), call(0, { requestedLevel: "high" }), call(0, { requestedLevel: 3 })], NOW);
    expect(report.byLevel).toEqual({ low: 1, high: 1, other: 1 });
  });

  it("ignora reset, rate, decide e entradas sem engine", () => {
    const report = delegationReport([
      call(0, { outcome: "reset" }), call(0, { tool: "rate" }), call(0, { tool: "decide" }), call(0, { engine: undefined }),
    ], NOW);
    expect(report.totalCalls).toBe(0);
  });
});

describe("renderDelegationReport", () => {
  it("log vazio diz que não houve chamada de worker, sem veredito de economia", () => {
    const text = renderDelegationReport(delegationReport([], NOW));
    expect(text).toContain("0 of 7 days");
    expect(text).not.toMatch(/saved|saves/i);
  });

  it("explica que engine claude usa a mesma assinatura de um host Claude Code", () => {
    const text = renderDelegationReport(delegationReport([call(0, { engine: "claude" })], NOW));
    expect(text).toContain("same subscription");
    expect(text).toContain("1 of 1");
  });
});
