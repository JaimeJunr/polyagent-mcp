import { describe, expect, it, vi } from "vitest";
import { z, type ZodRawShape } from "zod";

const captured = vi.hoisted(() => ({ tools: new Map<string, { inputSchema: ZodRawShape; description: string }>() }));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(name: string, config: { inputSchema: ZodRawShape; description: string }) {
      captured.tools.set(name, config);
    }
    async connect() {}
  },
}));
vi.mock("../src/cli.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/cli.js")>(),
  sandboxPreflight: () => {},
}));
// Importar o registro real sem escrever no CLAUDE.md global nem conectar ao stdio.
vi.mock("../src/claudeMd.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/claudeMd.js")>(),
  CLAUDE_MD_BOOT_SYNC: false,
}));
await import("../src/index.js");

function schema(name: string) {
  const tool = captured.tools.get(name);
  expect(tool, name).toBeDefined();
  return z.object(tool!.inputSchema);
}

describe("delegate level schema", () => {
  it.each(["low", "middle", "high"])("accepts required level %s", (level) => {
    expect(schema("delegate").parse({ prompt: "task", level }).level).toBe(level);
  });

  it.each([undefined, 0, 6, -1, 2.5, "1", "medium", "HIGH", "toString", ""])("rejects invalid level %s", (level) => {
    expect(schema("delegate").safeParse({ prompt: "task", level }).success).toBe(false);
  });

  // Sessão aberta antes da troca para nomes guarda o schema antigo (inteiro 1-5) e manda número.
  it.each([[1, "low"], [2, "middle"], [3, "middle"], [4, "high"], [5, "high"]])("maps legacy numeric level %s to %s", (level, name) => {
    expect(schema("delegate").parse({ prompt: "task", level }).level).toBe(name);
  });
});

describe("fan_out named levels schema", () => {
  it.each([["low", "middle"], ["high", "high"], ["low", "middle", "high"]].map((levels) => ({ levels })))("accepts names and repeats $levels", ({ levels }) => {
    expect(schema("fan_out").parse({ prompt: "task", levels }).levels).toEqual(levels);
  });

  it.each([undefined, [], ["low"], [1, 6], ["low", 0], ["low", "medium"], ["low", "HIGH"]].map((levels) => ({ levels })))("rejects missing, short or invalid levels $levels", ({ levels }) => {
    expect(schema("fan_out").safeParse({ prompt: "task", levels }).success).toBe(false);
  });

  it("maps legacy numeric levels inside the array", () => {
    expect(schema("fan_out").parse({ prompt: "task", levels: [1, "middle", 5] }).levels).toEqual(["low", "middle", "high"]);
  });

  it("keeps fast_delegate level-free", () => {
    expect(captured.tools.size).toBe(12);
    expect(captured.tools.get("fast_delegate")!.inputSchema).not.toHaveProperty("level");
    expect(schema("fast_delegate").parse({ prompt: "task" })).toEqual({ prompt: "task" });
  });
});
