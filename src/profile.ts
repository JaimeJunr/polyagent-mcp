// Perfil de instalação: quais tools carregam o schema inteiro em toda sessão (`alwaysLoad`).
// `minimal` poupa ~1,1 mil tokens estimados por sessão (research/2026-11-20-custo-fixo.md): pouco
// perto de um contexto de 80-150 mil, então o padrão segue `full` até o adoption-eval provar que
// `minimal` não perde adoção (fan_out nunca foi chamada enquanto estava deferida).
export type Profile = "minimal" | "full";

export const PROFILE_ALWAYS_LOAD: Record<Profile, readonly string[]> = {
  minimal: ["delegate", "explore", "run_filtered"],
  full: ["delegate", "explore", "run_filtered", "web_lookup", "fan_out", "rate"],
};

/** Valor desconhecido cai em `full`: esconder tools por typo seria pior que pagar o custo fixo. */
export function resolveProfile(value: string | undefined): Profile {
  return value?.trim().toLowerCase() === "minimal" ? "minimal" : "full";
}

export function alwaysLoadMeta(profile: Profile, tool: string): { "anthropic/alwaysLoad": true } | undefined {
  return PROFILE_ALWAYS_LOAD[profile].includes(tool) ? { "anthropic/alwaysLoad": true } : undefined;
}
