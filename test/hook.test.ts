import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
// @ts-expect-error — hook is plain .mjs sem types; só a lógica pura importa aqui.
import { decide, promptRouteContext, sessionStartContext, subagentStartContext } from "../hooks/prefer-polyagent.mjs";

const hookPath = fileURLToPath(new URL("../hooks/prefer-polyagent.mjs", import.meta.url));

/** Roda o hook como processo filho com o env dado; retorna stdout. */
function runHook(evt: object, env: NodeJS.ProcessEnv = process.env): string {
  const r = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(evt),
    env,
    encoding: "utf8",
  });
  expect(r.error).toBeUndefined();
  expect(r.status).toBe(0);
  return r.stdout ?? "";
}

/** fs falso: N linhas num arquivo "grande o suficiente" em bytes mas abaixo do teto. */
const fakeFs = (lines: number) => ({
  statSync: () => ({ size: 1000 }),
  readFileSync: () => "a\n".repeat(Math.max(lines - 1, 0)) + "a",
  minLines: 300,
});

describe("decide — web tools", () => {
  it("nudges web_lookup on WebSearch and carries the one-time preload reminder", () => {
    const res = decide({ tool_name: "WebSearch", tool_input: {}, seen: new Set() });
    expect(res.keys).toContain("web");
    expect(res.keys).toContain("preload");
    expect(res.text).toMatch(/web_lookup/);
    expect(res.text).toMatch(/ToolSearch|deferred/);
    expect(res.redirect).toBe(true);
  });

  it("dedups: WebSearch já nudado nesta sessão → null", () => {
    const res = decide({ tool_name: "WebFetch", tool_input: {}, seen: new Set(["web", "preload"]) });
    expect(res).toBeNull();
  });

  it("fail-open: depois de marcar as chaves, a segunda WebSearch passa", () => {
    const seen = new Set<string>();
    const first = decide({ tool_name: "WebSearch", tool_input: {}, seen });
    for (const key of first.keys) seen.add(key);
    const second = decide({ tool_name: "WebSearch", tool_input: {}, seen });
    expect(second).toBeNull();
  });
});

describe("decide — Grep/Glob (preload once)", () => {
  it("primeira Grep emite o lembrete de preload", () => {
    const res = decide({ tool_name: "Grep", tool_input: {}, seen: new Set() });
    expect(res.keys).toEqual(["preload"]);
    expect(res.text).toMatch(/ToolSearch|deferred/);
    expect(res.redirect).toBeFalsy();
  });

  it("segunda Grep na mesma sessão → null (neutraliza o ruído)", () => {
    const res = decide({ tool_name: "Glob", tool_input: {}, seen: new Set(["preload"]) });
    expect(res).toBeNull();
  });
});

describe("decide — Read (threshold 300, dedup por arquivo)", () => {
  it("arquivo de 300 linhas → nudge read_slice", () => {
    const res = decide({ tool_name: "Read", tool_input: { file_path: "/x/big.ts" }, seen: new Set() }, fakeFs(300));
    expect(res.keys).toContain("read:/x/big.ts");
    expect(res.text).toMatch(/read_slice/);
    expect(res.redirect).toBe(true);
  });

  it("arquivo de 299 linhas → null (abaixo do threshold)", () => {
    const res = decide({ tool_name: "Read", tool_input: { file_path: "/x/small.ts" }, seen: new Set() }, fakeFs(299));
    expect(res).toBeNull();
  });

  it("Read cirúrgico (offset/limit) → null", () => {
    const res = decide({ tool_name: "Read", tool_input: { file_path: "/x/big.ts", offset: 10 }, seen: new Set() }, fakeFs(400));
    expect(res).toBeNull();
  });

  it("mesmo arquivo já nudado → null (não repete)", () => {
    const seen = new Set(["read:/x/big.ts", "preload"]);
    const res = decide({ tool_name: "Read", tool_input: { file_path: "/x/big.ts" }, seen }, fakeFs(400));
    expect(res).toBeNull();
  });

  it("segundo arquivo grande ainda nuda, mas sem repetir o preload", () => {
    const seen = new Set(["read:/x/a.ts", "preload"]);
    const res = decide({ tool_name: "Read", tool_input: { file_path: "/x/b.ts" }, seen }, fakeFs(400));
    expect(res.keys).toContain("read:/x/b.ts");
    expect(res.keys).not.toContain("preload");
  });
});

describe("sessionStartContext — preload injetado no início da sessão", () => {
  it("inclui as ferramentas core no fallback ToolSearch e lista as secundárias", () => {
    const text = sessionStartContext();
    expect(text).toMatch(/ToolSearch/);
    expect(text).toMatch(/mcp__polyagent__generate_image/);
    expect(text).toMatch(/mcp__polyagent__decide/);
    expect(text).toMatch(/mcp__polyagent__fan_out/);
    expect(text).toMatch(/read_slice/);
  });

  it("explica que as tools core, inclusive fan_out, estão alwaysLoad", () => {
    const text = sessionStartContext();
    expect(text).toMatch(/alwaysLoad/);
    expect(text).toMatch(/fan_out/);
    expect(text).toMatch(/when needed/i);
  });

  it("menciona fast_delegate (não regressar a adoção silenciosa)", () => {
    expect(sessionStartContext()).toMatch(/fast_delegate/);
  });

  it("cobre o buraco do Bash grep: menciona preferir explore/read_slice sobre Read/Grep", () => {
    const text = sessionStartContext();
    expect(text).toMatch(/read_slice|explore/);
    expect(text).toMatch(/Bash|Grep|Read/);
  });

  it("passa a filosofia orquestrador: offload de commit/PR/edição mecânica pro delegate", () => {
    const text = sessionStartContext();
    expect(text).toMatch(/delegate\(/);
    expect(text).toMatch(/orchestrat/i);
    expect(text).toMatch(/grunt|commits\b/i);
  });

  it("enquadra delegate como executor E juiz (levels 4 and 5 = Opus high/max), Task só pra subagent especializado", () => {
    const text = sessionStartContext();
    expect(text).toMatch(/delegate\(prompt, level\)/);
    expect(text).toMatch(/DEFAULT/);
    // Opus 5.5 high/max preserva o julgamento nos níveis altos, agora com cota do host.
    expect(text).toMatch(/judgment/i);
    expect(text).toMatch(/levels 4 and 5/i);
    expect(text).toMatch(/Opus 5\.5 high.*Opus 5\.5 max/i);
    // Task fica só pra subagent com toolset próprio, não pra julgamento genérico
    expect(text).toMatch(/specialized|toolset/i);
  });

  it("separa o polyagent de um MCP server chamado codex fora do ar", () => {
    const text = sessionStartContext();
    expect(text).toMatch(/MCP server named "codex"/);
    expect(text).toMatch(/says nothing about polyagent/);
  });

  it("tarefa com skills, subagents ou browser não é tudo-ou-nada", () => {
    const text = sessionStartContext();
    expect(text).toMatch(/not all-or-nothing/);
    expect(text).toMatch(/inline \{prompt\}/);
    expect(text).toMatch(/only steps that need an MCP server or a browser stay with you/i);
    expect(text).toMatch(/files outside cwd/);
    expect(text).toMatch(/agent:.{0,3}<name>/);
  });

  it("empurra explore() direto em vez de spawnar o subagente Explore (caro)", () => {
    const text = sessionStartContext();
    expect(text).toMatch(/explore\(/);
    expect(text).toMatch(/Explore/); // o subagente nativo
  });
});

describe("decide — Bash de mutação (grunt-work → delegate)", () => {
  it("git commit → nudge delegate (com preload de carona na 1ª vez)", () => {
    const res = decide({ tool_name: "Bash", tool_input: { command: "git commit -m 'x'" }, seen: new Set() });
    expect(res.keys).toContain("bash-mutate");
    expect(res.keys).toContain("preload");
    expect(res.text).toMatch(/delegate/);
    expect(res.redirect).toBeFalsy();
  });

  it("gh pr create → nudge delegate", () => {
    const res = decide({ tool_name: "Bash", tool_input: { command: "gh pr create --fill" }, seen: new Set(["preload"]) });
    expect(res.keys).toEqual(["bash-mutate"]);
    expect(res.text).toMatch(/delegate/);
  });

  it("git status (read-only) → null (não cutuca; rtk já filtra)", () => {
    const res = decide({ tool_name: "Bash", tool_input: { command: "git status --short" }, seen: new Set(["preload"]) });
    expect(res).toBeNull();
  });

  it("segunda mutação na mesma sessão → null (dedup)", () => {
    const res = decide({ tool_name: "Bash", tool_input: { command: "git push" }, seen: new Set(["bash-mutate", "preload"]) });
    expect(res).toBeNull();
  });
});

describe("decide — Bash code search", () => {
  it.each(["grep needle src", "rg needle src", "egrep needle src", "fgrep needle src", "ag needle src", "ack needle src", "find src -name '*.ts'", "git grep needle", "rtk rg needle src", "FOO=bar rg needle src", "rtk FOO=bar rg needle src", "rg needle src | head -20", "git status && rg needle src", "grep -rn needle src 2>/dev/null", "find . -name '*.ts' 2>/dev/null | head", "rg needle src >/dev/null"])(
    "redirects read-only search: %s", (command) => {
      const res = decide({ tool_name: "Bash", tool_input: { command }, seen: new Set(["preload"]) });
      expect(res?.keys).toEqual(["bash-search"]);
      expect(res?.redirect).toBe(true);
      expect(res?.text).toMatch(/explore/);
      expect(res?.text).toMatch(/read_slice/);
    },
  );

  it.each(["npm test | grep FAIL", "ps aux | grep x", "git status --short", "echo 'rg needle'", "rg needle src > result.txt", "rg needle src | tee result.txt"])(
    "leaves filtering, non-search, or artifact-writing command alone: %s", (command) => {
      expect(decide({ tool_name: "Bash", tool_input: { command }, seen: new Set(["preload"]) })).toBeNull();
    },
  );

  it("artifact nudge wins over a search in the same command", () => {
    const res = decide({ tool_name: "Bash", tool_input: { command: "rg needle src && git commit -m x" }, seen: new Set(["preload"]) });
    expect(res?.keys).toEqual(["bash-mutate"]);
    expect(res?.redirect).toBe(false);
  });

  it("redirects once per session, then allows another search", () => {
    const seen = new Set<string>();
    const first = decide({ tool_name: "Bash", tool_input: { command: "rg needle src" }, seen });
    expect(first?.keys).toEqual(["bash-search", "preload"]);
    for (const key of first!.keys) seen.add(key);
    expect(decide({ tool_name: "Bash", tool_input: { command: "find src -name '*.ts'" }, seen })).toBeNull();
  });
});

describe("decide — Agent/Task/Skill handoff", () => {
  it.each(["Agent", "Task"])("nudges %s with subagent_type and named persona", (tool_name) => {
    const res = decide({ tool_name, tool_input: { subagent_type: "pit:issue-investigator" }, seen: new Set(["preload"]) });
    expect(res?.keys).toEqual(["agent-handoff"]);
    expect(res?.redirect).toBe(false);
    expect(res?.text).toContain("pit:issue-investigator");
    expect(res?.text).toMatch(/delegate|fast_delegate/);
    expect(res?.text).toMatch(/agent: "<subagent name>"/);
    expect(res?.text).toMatch(/MCP servers or a browser/);
  });

  it("nudges Skill with skill name and inline SKILL.md body", () => {
    const res = decide({ tool_name: "Skill", tool_input: { skill: "ivt-core:api-design" }, seen: new Set(["preload"]) });
    expect(res?.keys).toEqual(["skill-handoff"]);
    expect(res?.redirect).toBe(false);
    expect(res?.text).toContain("ivt-core:api-design");
    expect(res?.text).toMatch(/agent: \{ prompt: "<SKILL\.md body>" \}/);
    expect(res?.text).toMatch(/MCP servers or a browser/);
  });

  it.each(["claude-code-guide", "my-claude-code-guide-helper", "statusline-setup"])(
    "exempts harness helper %s", (subagent_type) => {
      expect(decide({ tool_name: "Agent", tool_input: { subagent_type }, seen: new Set(["preload"]) })).toBeNull();
    },
  );

  it("dedups Agent and Skill independently across a session", () => {
    const seen = new Set(["agent-handoff", "preload"]);
    expect(decide({ tool_name: "Task", tool_input: {}, seen })).toBeNull();
    expect(decide({ tool_name: "Skill", tool_input: { skill: "test" }, seen })?.keys).toEqual(["skill-handoff"]);
    seen.add("skill-handoff");
    expect(decide({ tool_name: "Skill", tool_input: { skill: "other" }, seen })).toBeNull();
  });
});

describe("PreToolUse hook modes — Bash search and Agent/Skill", () => {
  it("redirect mode denies first Bash search with fail-open reason, then passes", () => {
    const session_id = `test-bash-redirect-${process.pid}-${Date.now()}`;
    const evt = { hook_event_name: "PreToolUse", session_id, tool_name: "Bash", tool_input: { command: "rg needle src" } };
    const env = { ...process.env, POLYAGENT_HOOK_MODE: "redirect" };
    const first = JSON.parse(runHook(evt, env)).hookSpecificOutput;
    expect(first.permissionDecision).toBe("deny");
    expect(first.permissionDecisionReason).toMatch(/explore.*read_slice/s);
    expect(first.permissionDecisionReason).toMatch(/call it again and it will be allowed.*once\)\.$/);
    expect(runHook(evt, env)).toBe("");
  });

  it("nudge mode emits additionalContext for Bash search without denying", () => {
    const evt = { hook_event_name: "PreToolUse", session_id: `test-bash-nudge-${process.pid}-${Date.now()}`, tool_name: "Bash", tool_input: { command: "rg needle src" } };
    const out = JSON.parse(runHook(evt, { ...process.env, POLYAGENT_HOOK_MODE: "nudge" })).hookSpecificOutput;
    expect(out.additionalContext).toMatch(/explore.*read_slice/s);
    expect(out.permissionDecision).toBeUndefined();
  });

  it.each(["Agent", "Skill"])("redirect mode only nudges %s", (tool_name) => {
    const evt = { hook_event_name: "PreToolUse", session_id: `test-${tool_name}-${process.pid}-${Date.now()}`, tool_name, tool_input: { subagent_type: "Explore", skill: "api-design" } };
    const out = JSON.parse(runHook(evt, { ...process.env, POLYAGENT_HOOK_MODE: "redirect" })).hookSpecificOutput;
    expect(out.additionalContext).toMatch(/agent:/);
    expect(out.permissionDecision).toBeUndefined();
  });

  it.each(["Bash", "Agent", "Skill"])("off mode emits nothing for %s", (tool_name) => {
    const evt = { hook_event_name: "PreToolUse", session_id: `test-off-${tool_name}-${process.pid}-${Date.now()}`, tool_name, tool_input: { command: "rg needle src", subagent_type: "Explore", skill: "api-design" } };
    expect(runHook(evt, { ...process.env, POLYAGENT_HOOK_MODE: "off" })).toBe("");
  });
});

describe("decide — Edit/Write (execução self-contained → delegate)", () => {
  it("primeira Edit → nudge delegate(level) (com preload de carona)", () => {
    const res = decide({ tool_name: "Edit", tool_input: { file_path: "/x/a.ts" }, seen: new Set() });
    expect(res.keys).toContain("edit-delegate");
    expect(res.keys).toContain("preload");
    expect(res.text).toMatch(/delegate\(/);
    expect(res.text).toMatch(/level/);
  });

  it("Write também dispara o mesmo nudge", () => {
    const res = decide({ tool_name: "Write", tool_input: { file_path: "/x/n.ts" }, seen: new Set(["preload"]) });
    expect(res.keys).toEqual(["edit-delegate"]);
    expect(res.text).toMatch(/delegate\(/);
  });

  it("MultiEdit também dispara", () => {
    const res = decide({ tool_name: "MultiEdit", tool_input: { file_path: "/x/m.ts" }, seen: new Set(["preload"]) });
    expect(res.keys).toEqual(["edit-delegate"]);
  });

  it("segunda edição na mesma sessão → null (dedup, não cutuca toda edição)", () => {
    const res = decide({ tool_name: "Edit", tool_input: { file_path: "/x/b.ts" }, seen: new Set(["edit-delegate", "preload"]) });
    expect(res).toBeNull();
  });
});

describe("subagentStartContext — contexto injetado no subagente", () => {
  it("retorna a preferência polyagent para um subagente comum", () => {
    const text = subagentStartContext("general-purpose");
    expect(text).toMatch(/read_slice|explore|web_lookup/);
    expect(text).toMatch(/ToolSearch/);
  });

  it("menciona fast_delegate para não regredir a adoção", () => {
    expect(subagentStartContext("general-purpose")).toMatch(/fast_delegate/);
  });

  it("agent_type Explore inclui o reforço específico", () => {
    const text = subagentStartContext("Explore");
    expect(text).toMatch(/Explore run|you are an explore/i);
    expect(text).toMatch(/GPT-6 Luna/i);
  });

  it("tipos diferentes de Explore não recebem o reforço específico", () => {
    expect(subagentStartContext("general-purpose")).not.toMatch(/Explore run/i);
    expect(subagentStartContext("explore")).not.toMatch(/Explore run/i);
  });
});

describe("promptRouteContext — roteamento por intenção", () => {
  it.each([
    ["PT fan_out", "Compare duas abordagens e traga prós e contras.", "fan_out"],
    ["EN fan_out", "Get a second opinion and cross-check the trade-offs.", "fan_out"],
    ["PT web_lookup", "Qual é a versão mais recente da biblioteca e as notas de versão?", "web_lookup"],
    ["EN web_lookup", "Check the latest version and release notes for this library.", "web_lookup"],
    ["PT run_filtered", "Rode a suíte de testes e reporte apenas as falhas.", "run_filtered"],
    ["EN run_filtered", "Run the test suite and report only errors.", "run_filtered"],
    // português coloquial: "me diga só quais falharam" (verbo "dizer", "só", verbo "falhar")
    ["PT coloquial run_filtered", "Roda os testes e me diz só quais falharam.", "run_filtered"],
    ["PT coloquial run_filtered 2", "Rode o build e me diga só os erros.", "run_filtered"],
    ["PT explore", "Onde fica definido o fluxo de login e em que arquivo?", "explore"],
    ["EN explore", "Where is the login flow defined, and which file contains it?", "explore"],
  ])("matches %s", (_label, prompt, tool) => {
    expect(promptRouteContext(prompt)).toContain(tool);
  });

  it("prioritizes fan_out over a web lookup cue", () => {
    expect(promptRouteContext("Compare these approaches and check the latest version of the package."))
      .toContain("fan_out");
  });

  it.each([
    "quantos arquivos .ts existem em src?",
    "corrige o typo no README",
  ])("leaves simple prompt without routing hint: %s", (prompt) => {
    expect(promptRouteContext(prompt)).toBeNull();
  });

  it.each(["", "   ", undefined, null, 42])("returns null for empty or non-string input: %s", (prompt) => {
    expect(promptRouteContext(prompt)).toBeNull();
  });

  it("keeps every hint short and calm", () => {
    const hints = [
      promptRouteContext("Compare two approaches"),
      promptRouteContext("Find the latest version"),
      promptRouteContext("Run tests and report only failures"),
      promptRouteContext("Which file defines login?"),
    ];
    for (const hint of hints) {
      expect(hint).not.toBeNull();
      expect(hint!.length).toBeLessThanOrEqual(220);
      expect(hint).not.toMatch(/\b(?:MUST|CRITICAL)\b/);
    }
  });
});

describe("HOOK_MODE=off — no-op total (subprocess)", () => {
  const offEnv = { ...process.env, POLYAGENT_HOOK_MODE: "off" };

  it("SessionStart com off → stdout vazio (não injeta routing prompt)", () => {
    const out = runHook({ hook_event_name: "SessionStart", session_id: "test-off-ss" }, offEnv);
    expect(out).toBe("");
  });

  it("SubagentStart com off → stdout vazio (não injeta agent context)", () => {
    const out = runHook(
      { hook_event_name: "SubagentStart", agent_type: "Explore" },
      offEnv,
    );
    expect(out).toBe("");
  });

  it("UserPromptSubmit com off → stdout vazio", () => {
    const out = runHook({ hook_event_name: "UserPromptSubmit", prompt: "Compare two approaches" }, offEnv);
    expect(out).toBe("");
  });

  it("SessionStart sem off (default/redirect) → stdout não-vazio", () => {
    // Isola dedup por session_id único; não depende de ~/.claude.
    const env = { ...process.env };
    delete env.POLYAGENT_HOOK_MODE;
    const out = runHook(
      { hook_event_name: "SessionStart", session_id: `test-on-ss-${Date.now()}` },
      env,
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/polyagent|SessionStart|additionalContext/);
  });
});

describe("UserPromptSubmit — contexto de rota (subprocess)", () => {
  it("emite additionalContext sem deduplicar prompts", () => {
    const evt = { hook_event_name: "UserPromptSubmit", prompt: "Compare two approaches" };
    const first = runHook(evt);
    const second = runHook(evt);
    expect(JSON.parse(first)).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: promptRouteContext(evt.prompt),
      },
    });
    expect(second).toBe(first);
  });

  it("não emite saída para prompt simples", () => {
    expect(runHook({ hook_event_name: "UserPromptSubmit", prompt: "corrige o typo no README" })).toBe("");
  });
});
