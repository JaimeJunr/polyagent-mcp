import { describe, expect, it } from "vitest";
import { engineHealthy } from "../src/cli.js";
import { estimateTokens, hookDisabled, renderDoctor, savingsVerdict } from "../src/doctor.js";

describe("savingsVerdict", () => {
  it("diz que poupa custo do host quando o codex está saudável", () => {
    const v = savingsVerdict(["codex", "claude"], []);
    expect(v.verdict).toBe("saves");
    expect(v.headline).toContain("média ou maior");
    expect(v.headline).toContain("não está demonstrada");
  });

  it("diz com todas as letras que não poupa cota quando só há claude", () => {
    const v = savingsVerdict(["claude"], []);
    expect(v.verdict).toBe("no-saving");
    expect(v.headline).toContain("não poupa cota");
    expect(v.reasons.join(" ")).toContain("mesma assinatura");
  });

  it("trata codex sem saúde como sem economia e explica a causa", () => {
    const v = savingsVerdict(["codex", "claude"], ["codex"]);
    expect(v.verdict).toBe("no-saving");
    expect(v.reasons.join(" ")).toContain("codex");
  });

  it("aponta engines fora dos níveis como uso só com engine explícita", () => {
    const v = savingsVerdict(["claude", "grok"], []);
    expect(v.verdict).toBe("no-saving");
    expect(v.reasons.join(" ")).toContain("engine");
  });

  it("não alega mesma assinatura quando nem codex nem claude servem aos níveis", () => {
    const v = savingsVerdict(["codex"], ["codex"]);
    expect(v.verdict).toBe("no-engine");
    expect(v.headline).not.toContain("mesma assinatura");
    expect(v.headline).toContain("níveis");
  });

  it("só grok instalado: níveis indisponíveis, grok só com engine explícita", () => {
    const v = savingsVerdict(["grok"], []);
    expect(v.verdict).toBe("no-engine");
    expect(`${v.headline} ${v.reasons.join(" ")}`).not.toContain("mesma assinatura");
    expect(v.reasons.join(" ")).toContain("engine");
  });

  it("avisa quando nenhuma engine foi encontrada", () => {
    expect(savingsVerdict([], []).verdict).toBe("no-engine");
  });
});

describe("estimateTokens e renderDoctor", () => {
  it("estima tokens por 4 caracteres, arredondando para cima", () => {
    expect(estimateTokens(13907)).toBe(3477);
    expect(estimateTokens(0)).toBe(0);
  });

  it("marca o custo fixo como estimativa e mostra o veredito", () => {
    const text = renderDoctor({
      engines: [{ engine: "codex", installed: true, healthy: true }],
      verdict: savingsVerdict(["codex"], []),
      fixedCost: { alwaysLoadChars: 13907, instructionsChars: 2414, hookChars: 2979 },
    });
    expect(text).toContain("estimativa");
    expect(text).toContain("codex");
    expect(text).toContain("19300");
  });
});

describe("saúde igual à do roteador e hook desligado", () => {
  it("aceita engine com cota antiga em probe, como o roteador", () => {
    expect(engineHealthy("codex", { codex: { score: 0.1, cause: "quota", probe: true } })).toBe(true);
    expect(engineHealthy("codex", { codex: { score: 0.1, cause: "quota", probe: false } })).toBe(false);
  });

  it("reconhece POLYAGENT_HOOK_MODE=off sem diferenciar maiúsculas", () => {
    expect(hookDisabled("OFF")).toBe(true);
    expect(hookDisabled("nudge")).toBe(false);
    expect(hookDisabled(undefined)).toBe(false);
  });

  it("não soma o hook ao custo fixo quando ele está desligado", () => {
    const text = renderDoctor({
      engines: [],
      verdict: savingsVerdict(["codex"], []),
      fixedCost: { alwaysLoadChars: 13907, instructionsChars: 2414, hookChars: 0, hookDisabled: true },
    });
    expect(text).toContain("16321");
    expect(text).toContain("desligado");
  });
});

describe("perfil no doctor", () => {
  it("mostra o perfil em uso e quanto o minimal tiraria, como estimativa", () => {
    const text = renderDoctor({
      engines: [],
      verdict: savingsVerdict(["codex"], []),
      fixedCost: {
        alwaysLoadChars: 13907, instructionsChars: 2414, hookChars: 2979,
        profile: "full", minimalAlwaysLoadChars: 9388,
      },
    });
    expect(text).toContain("Perfil: full");
    expect(text).toContain("POLYAGENT_PROFILE=minimal");
    expect(text).toContain("4519");
  });

  it("no perfil minimal não oferece trocar para minimal", () => {
    const text = renderDoctor({
      engines: [],
      verdict: savingsVerdict(["codex"], []),
      fixedCost: {
        alwaysLoadChars: 9388, instructionsChars: 2414, hookChars: 2979,
        profile: "minimal", minimalAlwaysLoadChars: 9388,
      },
    });
    expect(text).toContain("Perfil: minimal");
    expect(text).not.toContain("tiraria");
  });
});
