import { describe, expect, it } from "vitest";
import { estimateTokens, renderDoctor, savingsVerdict } from "../src/doctor.js";

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
