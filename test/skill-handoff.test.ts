import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { RunOpts } from "../src/cli.js";

type Tool = {
  schema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

const { tools, runCursorMock } = vi.hoisted(() => ({
  tools: new Map<string, Tool>(),
  runCursorMock: vi.fn(),
}));

// Captura os handlers registrados; transporte e workers não abrem processos nem stdio.
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(name: string, config: { inputSchema: z.ZodRawShape }, handler: Tool["handler"]) {
      tools.set(name, { schema: config.inputSchema, handler });
    }
    async connect() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class {} }));
vi.mock("../src/cli.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/cli.js")>(),
  runCursor: runCursorMock,
  hasEngine: () => true,
  sandboxPreflight: vi.fn(),
}));
vi.mock("../src/usage.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/usage.js")>(),
  readUsage: () => [],
  logUsage: vi.fn(),
}));
vi.mock("../src/claudeMd.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/claudeMd.js")>(),
  CLAUDE_MD_BOOT_SYNC: false,
}));
vi.mock("../src/jev.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/jev.js")>(),
  JEV_SHADOW_ENABLED: false,
}));

beforeAll(async () => {
  await import("../src/index.js");
});

describe.each(["delegate", "fast_delegate"])("%s entrega skill ao worker", (toolName) => {
  let root: string;
  let project: string;
  let home: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cbx-handoff-"));
    project = join(root, "project");
    home = join(root, "home");
    mkdirSync(project);
    mkdirSync(home);
    vi.stubEnv("HOME", home);
    runCursorMock.mockReset();
    runCursorMock.mockResolvedValue({ text: "Done.", engine: "codex", sessionId: "worker-1" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  async function invoke(agent?: unknown) {
    const tool = tools.get(toolName);
    expect(tool).toBeDefined();
    const input = z.object(tool!.schema).parse({ prompt: "Check the code.", level: "low", cwd: project, agent });
    return tool!.handler(input);
  }

  it.each(["project", "plugin"])("valida schema e passa persona e pasta RO da skill %s", async (source) => {
    const input = source === "project" ? "audit" : "quality:audit";
    const dir = source === "project"
      ? join(project, ".claude", "skills", "audit")
      : join(home, ".claude", "plugins", "cache", "mp", "quality", "1", "skills", "audit");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: security-audit\n---\nAudit the code with scripts/check.sh.");
    writeFileSync(join(dir, "scripts", "check.sh"), "echo checked\n");
    await expect(invoke({ skill: input })).resolves.toEqual(expect.objectContaining({ content: expect.any(Array) }));
    expect(runCursorMock).toHaveBeenCalledTimes(1);
    const opts = runCursorMock.mock.calls[0][0] as RunOpts;
    expect(opts).toMatchObject({ cwd: project, force: true, tool: toolName, roBinds: [realpathSync(dir)] });
    expect(opts.agentPrompt).toContain(`[Skill ${input}: its folder ${realpathSync(dir)} is mounted read-only; read scripts/ and references/ from there.]\n\nAudit the code with scripts/check.sh.`);
    expect(opts.agentPrompt).not.toContain("name: security-audit");
    expect(opts.prompt).toContain("Check the code.");
  });

  it.each(["missing", "quality:../audit"])("não inicia worker quando a skill %s falha", async (input) => {
    await expect(invoke({ skill: input })).rejects.toThrow(input === "missing" ? /skill 'missing' not found/ : /invalid skill name/);
    expect(runCursorMock).not.toHaveBeenCalled();
  });

  it.each([undefined, { prompt: "Inline persona." }])("não adiciona mounts sem skill: %j", async (agent) => {
    await invoke(agent);
    expect(runCursorMock).toHaveBeenCalledTimes(1);
    const opts = runCursorMock.mock.calls[0][0] as RunOpts;
    expect(opts.roBinds).toBeUndefined();
    if (agent) expect(opts.agentPrompt).toContain(agent.prompt);
  });
});
