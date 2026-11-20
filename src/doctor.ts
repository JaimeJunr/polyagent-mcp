import type { Engine } from "./cli.js";
import type { Profile } from "./profile.js";

// Lógica pura do `doctor`: veredito de economia e texto do relatório. Toda I/O (achar binários,
// ler o log, subir o servidor para medir o custo fixo) fica em doctorCli.ts.

export type Verdict = "saves" | "no-saving" | "no-engine";

export interface SavingsVerdict {
  verdict: Verdict;
  headline: string;
  reasons: string[];
}

export interface EngineStatus {
  engine: Engine;
  installed: boolean;
  healthy: boolean;
}

export interface FixedCost {
  alwaysLoadChars: number;
  instructionsChars: number;
  /** null quando o hook não vem com a instalação (o pacote npm publica só dist/). */
  hookChars: number | null;
  /** POLYAGENT_HOOK_MODE=off: o hook não emite nada, então não entra no custo. */
  hookDisabled?: boolean;
  profile?: Profile;
  /** Schemas que o perfil minimal manteria sempre carregados; base do "tiraria N". */
  minimalAlwaysLoadChars?: number;
}

export function hookDisabled(mode: string | undefined): boolean {
  return (mode ?? "").trim().toLowerCase() === "off";
}

export interface DoctorReport {
  engines: EngineStatus[];
  verdict: SavingsVerdict;
  /** null quando o servidor não subiu; `fixedCostError` explica o motivo. */
  fixedCost: FixedCost | null;
  fixedCostError?: string;
}

/** Aproximação de 4 caracteres por token: é estimativa, nunca contagem do tokenizer. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * Os três níveis têm Codex como titular e a reserva é o Claude (a mesma assinatura do host).
 * Sem Codex saudável, delegar por nível não poupa cota. Números: research/2026-11-15-limiar-tamanho.md,
 * medidos em custo de API do host; a economia de cota da assinatura NÃO está demonstrada.
 */
export function savingsVerdict(installed: Engine[], unhealthy: Engine[]): SavingsVerdict {
  const usable = installed.filter((e) => !unhealthy.includes(e));
  if (installed.length === 0) {
    return {
      verdict: "no-engine",
      headline: "Nenhuma engine encontrada: o polyagent não consegue delegar nada neste setup.",
      reasons: ["Instale ao menos o codex (recomendado) ou o claude e rode o doctor de novo."],
    };
  }
  if (usable.includes("codex")) {
    return {
      verdict: "saves",
      headline: "Com este setup o polyagent poupa custo do host em tarefa média ou maior "
        + "(medido: -27% a -31%; lote -40% a -45%). Em tarefa minúscula custa mais (+67%). "
        + "A economia de cota da assinatura não está demonstrada.",
      reasons: ["O codex é o titular dos três níveis e é uma assinatura diferente da do host."],
    };
  }
  const extra = usable.filter((e) => e !== "claude" && e !== "cursor");
  const explicit = extra.length > 0
    ? [`${extra.join(", ")} só entra com \`engine\` explícito no delegate; não faz parte dos níveis.`]
    : [];
  if (!usable.includes("claude")) {
    // Nem titular nem reserva: o roteador por nível lança erro, não cai na assinatura do host.
    return {
      verdict: "no-engine",
      headline: "Nenhum nível consegue delegar neste setup: não há codex nem claude saudável para os níveis.",
      reasons: [
        installed.includes("codex") ? "O codex está instalado mas sem saúde (cota ou falhas recentes)." : "Instale o codex (recomendado) ou o claude.",
        ...explicit,
      ],
    };
  }
  return {
    verdict: "no-saving",
    headline: "Com este setup o polyagent não poupa cota: o worker usa a mesma assinatura do host.",
    reasons: [
      installed.includes("codex")
        ? "O codex está instalado mas sem saúde (cota ou falhas recentes): os níveis caem na reserva."
        : "Sem o codex, os três níveis dependem da reserva.",
      "A reserva é o claude, a mesma assinatura do host: o worker gasta a cota que você queria poupar.",
      ...explicit,
    ],
  };
}

function fixedCostLines(fixed: FixedCost | null, error?: string): string[] {
  if (!fixed) return [`Custo fixo: não medido (${error ?? "servidor não subiu"}).`];
  const hook = fixed.hookDisabled ? 0 : fixed.hookChars ?? 0;
  const total = fixed.alwaysLoadChars + fixed.instructionsChars + hook;
  return [
    `Custo fixo por sessão (estimativa, 4 caracteres por token): ${total} caracteres, cerca de ${estimateTokens(total)} tokens.`,
    `  schemas das tools sempre carregadas: ${fixed.alwaysLoadChars}`,
    `  instruções do servidor: ${fixed.instructionsChars}`,
    `  texto do hook no início da sessão: ${fixed.hookDisabled ? "desligado (POLYAGENT_HOOK_MODE=off)" : fixed.hookChars ?? "não instalado"}`,
    ...profileLines(fixed),
  ];
}

function profileLines(fixed: FixedCost): string[] {
  if (!fixed.profile) return [];
  const lines = [`Perfil: ${fixed.profile}`];
  const saved = fixed.minimalAlwaysLoadChars === undefined ? 0 : fixed.alwaysLoadChars - fixed.minimalAlwaysLoadChars;
  if (fixed.profile === "full" && saved > 0) {
    lines.push(`  POLYAGENT_PROFILE=minimal tiraria ${saved} caracteres (cerca de ${estimateTokens(saved)} tokens, estimativa): `
      + "pouco perto de um contexto grande, e web_lookup, fan_out e rate passam a ser carregadas só sob demanda.");
  }
  return lines;
}

export function renderDoctor(report: DoctorReport): string {
  const engineLines = report.engines.map((e) => {
    const state = !e.installed ? "não encontrada" : e.healthy ? "ok" : "sem saúde";
    return `  ${e.engine.padEnd(9)} ${state}`;
  });
  return [
    "polyagent doctor",
    "",
    "Engines:",
    ...engineLines,
    "",
    `Veredito: ${report.verdict.headline}`,
    ...report.verdict.reasons.map((r) => `  - ${r}`),
    "",
    ...fixedCostLines(report.fixedCost, report.fixedCostError),
  ].join("\n");
}
