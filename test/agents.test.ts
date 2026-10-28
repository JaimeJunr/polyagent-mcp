import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAgentFile, resolveAgent, agentRoots } from "../src/agents.js";

describe("parseAgentFile", () => {
  it("extrai body como persona + name/model do frontmatter", () => {
    const raw = "---\nname: code-reviewer\nmodel: opus\ndescription: reviews\n---\nYou are a strict reviewer.\nBe terse.";
    expect(parseAgentFile(raw)).toEqual({
      prompt: "You are a strict reviewer.\nBe terse.",
      name: "code-reviewer",
      model: "opus",
    });
  });

  it("sem frontmatter, o arquivo inteiro é a persona", () => {
    expect(parseAgentFile("Just a persona, no frontmatter.")).toEqual({ prompt: "Just a persona, no frontmatter." });
  });

  it("tira aspas dos valores do frontmatter", () => {
    const raw = '---\nname: "my-agent"\n---\nbody';
    expect(parseAgentFile(raw).name).toBe("my-agent");
  });
});

describe("resolveAgent", () => {
  const dirs: string[] = [];
  beforeEach(() => {
    const home = mkdtempSync(join(tmpdir(), "cbx-agent-home-"));
    dirs.push(home);
    vi.stubEnv("HOME", home);
  });
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    vi.unstubAllEnvs();
    delete process.env.POLYAGENT_AGENT_PATHS;
  });

  it("objeto inline com prompt é usado direto (sem tocar o FS)", () => {
    expect(resolveAgent({ prompt: "inline persona" }, "/nope")).toEqual({ prompt: "inline persona" });
  });

  it("objeto inline sem prompt não-vazio lança erro claro", () => {
    expect(() => resolveAgent({ prompt: "  " }, "/nope")).toThrow(/non-empty 'prompt'/);
  });

  it("rejeita nomes com traversal (sem path traversal)", () => {
    expect(() => resolveAgent("../../etc/passwd", "/nope")).toThrow(/invalid agent name/);
    expect(() => resolveAgent("a/b", "/nope")).toThrow(/invalid agent name/);
  });

  it("resolve um nome buscando <base>.md num root e usa a parte após ':' (plugin)", () => {
    const root = mkdtempSync(join(tmpdir(), "cbx-agents-"));
    dirs.push(root);
    mkdirSync(join(root, "nested"), { recursive: true });
    writeFileSync(join(root, "nested", "issue-investigator.md"), "---\nname: issue-investigator\n---\nInvestigate root cause.");
    process.env.POLYAGENT_AGENT_PATHS = root;
    const r = resolveAgent("pit:issue-investigator", "/nope");
    expect(r.prompt).toBe("Investigate root cause.");
    expect(r.name).toBe("issue-investigator");
  });

  it("resolve normalmente num diretório real .claude/agents do projeto", () => {
    const repo = mkdtempSync(join(tmpdir(), "cbx-repo-"));
    dirs.push(repo);
    mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
    writeFileSync(join(repo, ".claude", "agents", "reviewer.md"), "Review carefully.");

    expect(resolveAgent("reviewer", repo)).toEqual({ prompt: "Review carefully.", name: "reviewer" });
  });

  it.skipIf(process.platform === "win32")("bloqueia .claude/agents que é symlink para fora do projeto", () => {
    const repo = mkdtempSync(join(tmpdir(), "cbx-repo-"));
    const outside = mkdtempSync(join(tmpdir(), "cbx-outside-"));
    dirs.push(repo, outside);
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(outside, "secret.md"), "Host secret.");
    symlinkSync(outside, join(repo, ".claude", "agents"), "dir");

    expect(() => resolveAgent("secret", repo)).toThrow(/agent 'secret' not found/);
  });

  it("aceita POLYAGENT_AGENT_PATHS apontando para diretório arbitrário confiável", () => {
    const repo = mkdtempSync(join(tmpdir(), "cbx-repo-"));
    const trusted = mkdtempSync(join(tmpdir(), "cbx-trusted-"));
    dirs.push(repo, trusted);
    writeFileSync(join(trusted, "trusted.md"), "Trusted persona.");
    process.env.POLYAGENT_AGENT_PATHS = trusted;

    expect(resolveAgent("trusted", repo)).toEqual({ prompt: "Trusted persona.", name: "trusted" });
  });

  it("rejeita agent nomeado cujo body é vazio", () => {
    const repo = mkdtempSync(join(tmpdir(), "cbx-repo-"));
    dirs.push(repo);
    mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
    writeFileSync(join(repo, ".claude", "agents", "empty.md"), "---\nname: empty\n---\n   \n");

    expect(() => resolveAgent("empty", repo)).toThrow(/invalid agent 'empty'.*non-empty prompt body/);
  });

  // Caso real 2026-10-28: host em connect-context, worker com cwd numa worktree irmã de código.
  it("acha o agent no .claude/agents do projeto do host quando o cwd do worker é outro repo", () => {
    const host = mkdtempSync(join(tmpdir(), "cbx-host-"));
    const sibling = mkdtempSync(join(tmpdir(), "cbx-sibling-"));
    dirs.push(host, sibling);
    mkdirSync(join(host, ".claude", "agents"), { recursive: true });
    writeFileSync(join(host, ".claude", "agents", "connect-reviewer.md"), "Review the connect way.");

    expect(resolveAgent("connect-reviewer", sibling, host))
      .toEqual({ prompt: "Review the connect way.", name: "connect-reviewer" });
  });

  it("o .claude/agents do cwd do worker vence o do projeto do host", () => {
    const host = mkdtempSync(join(tmpdir(), "cbx-host-"));
    const repo = mkdtempSync(join(tmpdir(), "cbx-repo-"));
    dirs.push(host, repo);
    for (const [dir, body] of [[host, "Host persona."], [repo, "Repo persona."]]) {
      mkdirSync(join(dir, ".claude", "agents"), { recursive: true });
      writeFileSync(join(dir, ".claude", "agents", "reviewer.md"), body);
    }

    expect(resolveAgent("reviewer", repo, host).prompt).toBe("Repo persona.");
  });

  it("lança erro listando onde procurou quando o agent não existe", () => {
    expect(() => resolveAgent("ghost", tmpdir())).toThrow(/agent 'ghost' not found/);
  });
});

describe("agentRoots", () => {
  it("inclui roots extras do env antes dos padrões", () => {
    const root = mkdtempSync(join(tmpdir(), "cbx-roots-"));
    vi.stubEnv("HOME", root);
    process.env.POLYAGENT_AGENT_PATHS = root;
    try {
      expect(agentRoots(tmpdir())[0]).toBe(root);
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
      delete process.env.POLYAGENT_AGENT_PATHS;
    }
  });
});

describe("resolveAgent com skill", () => {
  let root: string;
  let home: string;
  let project: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cbx-skills-"));
    home = join(root, "home");
    project = join(root, "project");
    mkdirSync(home);
    mkdirSync(project);
    vi.stubEnv("HOME", home);
    vi.stubEnv("POLYAGENT_AGENT_PATHS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  function skill(dir: string, body = "Read scripts/check.sh and references/guide.md.", mtime?: number): string {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    mkdirSync(join(dir, "references"));
    writeFileSync(join(dir, "scripts", "check.sh"), "echo checked\n");
    writeFileSync(join(dir, "references", "guide.md"), "Bundled guide.");
    const file = join(dir, "SKILL.md");
    writeFileSync(file, body);
    if (mtime !== undefined) utimesSync(file, mtime, mtime);
    return realpathSync(dir);
  }

  function expected(input: string, dir: string, body: string, name = "audit") {
    return {
      prompt: `[Skill ${input}: its folder ${dir} is mounted read-only; read scripts/ and references/ from there.]\n\n${body}`,
      name,
      mountRo: dir,
    };
  }

  it("resolve skill do projeto, remove frontmatter e anuncia o diretório canônico", () => {
    const dir = skill(join(project, ".claude", "skills", "audit"), "---\nname: security-audit\nmodel: opus\ndescription: ignored\n---\nAudit the code.");
    expect(resolveAgent({ skill: "audit" }, project)).toEqual(expected("audit", dir, "Audit the code.", "security-audit"));
  });

  // Caso connect-context: `.claude/skills` é symlink para `../.agents/skills`, dentro do projeto do host.
  it.skipIf(process.platform === "win32")("resolve skill do projeto do host quando o cwd do worker é outro repo", () => {
    const host = join(root, "host");
    const dir = skill(join(host, ".agents", "skills", "audit"), "Audit from host.");
    mkdirSync(join(host, ".claude"));
    symlinkSync("../.agents/skills", join(host, ".claude", "skills"), "dir");
    expect(resolveAgent({ skill: "audit" }, project, host)).toEqual(expected("audit", dir, "Audit from host."));
  });

  it("skill do cwd do worker vence a do projeto do host", () => {
    const host = join(root, "host");
    skill(join(host, ".claude", "skills", "audit"), "Host.");
    const dir = skill(join(project, ".claude", "skills", "audit"), "Project.");
    expect(resolveAgent({ skill: "audit" }, project, host)).toEqual(expected("audit", dir, "Project."));
  });

  it("resolve skill do HOME sem frontmatter e usa base como nome", () => {
    const dir = skill(join(home, ".claude", "skills", "audit"), "Audit from home.");
    expect(resolveAgent({ skill: "audit" }, project)).toEqual(expected("audit", dir, "Audit from home."));
  });

  it.each(["project", "home"])("prioriza %s antes de plugins mesmo com mtime menor", (source) => {
    skill(join(home, ".claude", "plugins", "cache", "mp", "quality", "2", "skills", "audit"), "Plugin.", 200);
    const homeDir = skill(join(home, ".claude", "skills", "audit"), "Home.", 100);
    const dir = source === "project" ? skill(join(project, ".claude", "skills", "audit"), "Project.", 50) : homeDir;
    expect(resolveAgent({ skill: "audit" }, project)).toEqual(expected("audit", dir, source === "project" ? "Project." : "Home."));
  });

  it.each(["cache", "marketplaces"])("filtra prefixo pelo segmento do plugin no layout %s", (layout) => {
    const plugins = join(home, ".claude", "plugins");
    const pluginDir = (plugin: string) => layout === "cache"
      ? join(plugins, "cache", "mp", plugin, "1", "skills", "audit")
      : join(plugins, "marketplaces", "mp", "plugins", plugin, "skills", "audit");
    skill(pluginDir("other-quality"), "Wrong plugin.", 300);
    const dir = skill(pluginDir("quality"), "Right plugin.", 100);
    expect(resolveAgent({ skill: "quality:audit" }, project)).toEqual(expected("quality:audit", dir, "Right plugin."));
  });

  it("não aceita outro plugin quando o prefixo não tem match", () => {
    skill(join(home, ".claude", "plugins", "cache", "mp", "other-quality", "1", "skills", "audit"));
    expect(() => resolveAgent({ skill: "quality:audit" }, project)).toThrow(/skill 'quality:audit' not found/);
  });

  it.each(["1", "2"])("escolhe a versão %s pelo mtime entre duas versões", (version) => {
    const plugin = join(home, ".claude", "plugins", "cache", "mp", "quality");
    const dirs = ["1", "2"].map((v) => skill(join(plugin, v, "skills", "audit"), `Version ${v}.`, v === version ? 200 : 100));
    expect(resolveAgent({ skill: "quality:audit" }, project)).toEqual(expected("quality:audit", dirs[Number(version) - 1], `Version ${version}.`));
  });

  it.each(["", "quality:", "a/b", "quality:../audit", "a..b"])("rejeita nome inválido %j com valor e formato esperado", (input) => {
    expect(() => resolveAgent({ skill: input }, project)).toThrow(`invalid skill name: received ${JSON.stringify(input)}, expected a plain name or 'plugin:name'`);
  });

  it.each(["ghost", "quality:ghost"])("erro de %s lista todos os lugares pesquisados", (input) => {
    const resolve = () => resolveAgent({ skill: input }, project);
    expect(resolve).toThrow(`skill '${input}' not found`);
    for (const place of [join(project, ".claude", "skills"), join(home, ".claude", "skills"), join(home, ".claude", "plugins")]) {
      expect(resolve).toThrow(place);
    }
  });

  it("aceita symlink interno e retorna o diretório real da skill", () => {
    const dir = skill(join(project, ".claude", "skills", "actual"), "Canonical body.");
    symlinkSync(dir, join(project, ".claude", "skills", "audit"), "dir");
    expect(resolveAgent({ skill: "audit" }, project)).toEqual(expected("audit", dir, "Canonical body."));
  });

  it.each(["directory", "file"])("rejeita symlink de %s que escapa do root de skills", (kind) => {
    const outside = skill(join(root, "skills-outside"), "Host secret.");
    const dir = join(project, ".claude", "skills", "audit");
    mkdirSync(kind === "file" ? dir : join(project, ".claude", "skills"), { recursive: true });
    if (kind === "file") symlinkSync(join(outside, "SKILL.md"), join(dir, "SKILL.md"));
    else symlinkSync(outside, dir, "dir");
    expect(() => resolveAgent({ skill: "audit" }, project)).toThrow(/skill 'audit' not found/);
  });

  it.each(["project", "home"])("rejeita root de skills symlinkado para fora de %s", (source) => {
    const outside = join(root, "outside");
    skill(join(outside, "audit"), "Host secret.");
    const parent = source === "project" ? project : home;
    mkdirSync(join(parent, ".claude"));
    symlinkSync(outside, join(parent, ".claude", "skills"), "dir");
    expect(() => resolveAgent({ skill: "audit" }, project)).toThrow(/skill 'audit' not found/);
  });

  it.each([".hidden", "a/b/c/d/e/f/g/h/i"])("ignora diretório oculto ou profundo demais: %s", (nested) => {
    skill(join(home, ".claude", "plugins", nested, "skills", "audit"));
    expect(() => resolveAgent({ skill: "audit" }, project)).toThrow(/skill 'audit' not found/);
  });
});
