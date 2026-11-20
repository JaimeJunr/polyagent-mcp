#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DEFAULT_TIMEOUT_MS, hasEngine, type Engine } from "./cli.js";
import { renderDoctor, savingsVerdict, type DoctorReport, type EngineStatus, type FixedCost } from "./doctor.js";
import { engineHealthReport, QUOTA_WINDOW_MS, readUsage } from "./usage.js";

// Diagnóstico explícito: lê engines e saúde, sobe uma cópia do servidor só para medir o custo fixo.
// POLYAGENT_CLAUDE_MD/SKILL=off garantem que essa cópia nunca escreva no CLAUDE.md nem nas skills.
const ENGINES: Engine[] = ["codex", "claude", "grok", "opencode", "kimi", "muse"];
const HERE = dirname(fileURLToPath(import.meta.url));

function engineStatuses(): EngineStatus[] {
  const health = engineHealthReport(readUsage(), Date.now(), 30 * 60 * 1000, DEFAULT_TIMEOUT_MS, QUOTA_WINDOW_MS);
  return ENGINES.map((engine) => ({
    engine,
    installed: hasEngine(engine),
    healthy: (health[engine]?.cause ?? "ok") === "ok",
  }));
}

async function hookChars(): Promise<number | null> {
  const path = join(HERE, "..", "hooks", "prefer-polyagent.mjs");
  if (!existsSync(path)) return null;
  const mod = await import(pathToFileURL(path).href) as { sessionStartContext?: () => string };
  return mod.sessionStartContext?.().length ?? null;
}

async function measureFixedCost(): Promise<FixedCost> {
  const client = new Client({ name: "polyagent-doctor", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(HERE, "index.js")],
    env: { ...process.env, POLYAGENT_CLAUDE_MD: "off", POLYAGENT_SKILL: "off" } as Record<string, string>,
  }));
  try {
    const { tools } = await client.listTools();
    const alwaysLoadChars = tools
      .filter((t) => (t._meta as Record<string, unknown> | undefined)?.["anthropic/alwaysLoad"] === true)
      .reduce((sum, t) => sum + JSON.stringify(t).length, 0);
    return { alwaysLoadChars, instructionsChars: (client.getInstructions() ?? "").length, hookChars: await hookChars() };
  } finally {
    await client.close();
  }
}

const engines = engineStatuses();
const present = engines.filter((e) => e.installed).map((e) => e.engine);
const unhealthy = engines.filter((e) => e.installed && !e.healthy).map((e) => e.engine);
const report: DoctorReport = { engines, verdict: savingsVerdict(present, unhealthy), fixedCost: null };
try {
  report.fixedCost = await measureFixedCost();
} catch (error) {
  report.fixedCostError = error instanceof Error ? error.message.split("\n")[0] : String(error);
}
console.log(renderDoctor(report));
