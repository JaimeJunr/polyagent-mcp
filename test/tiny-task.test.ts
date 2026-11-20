import { describe, expect, it } from "vitest";
import { appendTinyTaskHint, isTinyTaskRequest } from "../src/prompts.js";

const TINY_FIXTURE_PT = "Corrija isAdult(age) em src/age.mjs: hoje usa age > 18, mas a regra é age >= 18. "
  + "Escreva um teste que falhe antes da correção e passe depois. Não commite. Responda somente JSON com done:true.";

describe("isTinyTaskRequest", () => {
  it("reconhece o prompt tiny medido no piloto (+67%), mesmo com 'Não commite'", () => {
    expect(isTinyTaskRequest(TINY_FIXTURE_PT)).toBe(true);
  });

  it("reconhece uma edição mecânica curta em inglês", () => {
    expect(isTinyTaskRequest("Rename the variable `cnt` to `count` in src/util.ts.")).toBe(true);
  });

  it("não marca como minúsculo um prompt longo de implementação", () => {
    const medium = "Implement applyTransfer(ledger, from, to, amount, feeRate) and computeFee(amount, feeRate) in "
      + "src/transfer.mjs. The ledger has balances (object) and feesCollected (number). computeFee rounds up to the "
      + "nearest cent and never returns less than one cent. applyTransfer must validate both accounts, reject negative "
      + "amounts and insufficient funds with RangeError, update balances and feesCollected atomically, and return "
      + "{ fee, newFromBalance, newToBalance }. Add node:test tests for every rule.";
    expect(medium.length).toBeGreaterThan(400);
    expect(isTinyTaskRequest(medium)).toBe(false);
  });

  it("não marca lote, mesmo curto", () => {
    expect(isTinyTaskRequest("Update the license header in all files under src/.")).toBe(false);
    expect(isTinyTaskRequest("Atualize o cabeçalho de todos os arquivos de src/.")).toBe(false);
  });

  it("não marca trabalho braçal de commit, PR ou build, que é bom para delegar", () => {
    expect(isTinyTaskRequest("Commit the staged changes and open a pull request.")).toBe(false);
    expect(isTinyTaskRequest("Run npm run build and fix any type errors.")).toBe(false);
  });

  it("não marca mudança que toca vários arquivos", () => {
    expect(isTinyTaskRequest("Move parseDate from src/a.ts to src/b.ts and update the import in src/c.ts.")).toBe(false);
  });

  it("'make' comum não conta como build: edição curta continua minúscula", () => {
    expect(isTinyTaskRequest("Make isAdult in src/age.mjs return true for age 18.")).toBe(true);
  });

  it("prompt vazio não é minúsculo", () => {
    expect(isTinyTaskRequest("   ")).toBe(false);
  });
});

describe("appendTinyTaskHint", () => {
  it("anexa o aviso quando a guarda está ligada e a tarefa é minúscula", () => {
    const out = appendTinyTaskHint("Done.", TINY_FIXTURE_PT, true);
    expect(out.startsWith("Done.")).toBe(true);
    expect(out).toContain("usually costs more than doing it yourself");
  });

  it("não altera o texto com a guarda desligada ou tarefa maior", () => {
    expect(appendTinyTaskHint("Done.", TINY_FIXTURE_PT, false)).toBe("Done.");
    expect(appendTinyTaskHint("Done.", "Update every file in src/.", true)).toBe("Done.");
  });
});
