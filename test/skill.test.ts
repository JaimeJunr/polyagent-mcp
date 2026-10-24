import { describe, expect, it } from "vitest";
import {
  renderPolyagentSkill, SKILL_MARKER_PREFIX, SKILL_NAME, type SkillFs, skillPath, syncSkill,
} from "../src/skill.js";

class FakeSkillFs implements SkillFs {
  readonly writes: { path: string; text: string }[] = [];

  constructor(readonly files: Record<string, string> = {}) {}

  read(path: string): string | undefined {
    return this.files[path];
  }

  write(path: string, text: string): void {
    this.files[path] = text;
    this.writes.push({ path, text });
  }
}

const SKILL = renderPolyagentSkill("9.9.9");
const ROOT = "/home/u/.claude/skills";
const PATH = skillPath(ROOT);

describe("renderPolyagentSkill", () => {
  it("is an Agent Skill named polyagent with a trigger description and the versioned ownership marker", () => {
    expect(SKILL.startsWith(`---\nname: ${SKILL_NAME}\ndescription: `)).toBe(true);
    expect(SKILL).toContain(`${SKILL_MARKER_PREFIX} v=9.9.9 -->`);
    expect(SKILL.split("\n").find((l) => l.startsWith("description:"))).toMatch(/even when polyagent is not named/);
  });

  it("carries the tier table and the usage rules the always-loaded block has no room for", () => {
    expect(SKILL).toContain("middle=codex gpt-6.1-sol medium");
    expect(SKILL).toContain("high=claude claude-opus-5-5 high");
    expect(SKILL).toMatch(/deny/);
    expect(SKILL).toMatch(/mode: ?"ask"/);
    expect(SKILL).toMatch(/rate\(/);
    expect(SKILL).toMatch(/agent: \{ skill:/);
  });
});

describe("syncSkill", () => {
  it("install creates the skill file under <root>/polyagent/SKILL.md", () => {
    const fs = new FakeSkillFs();
    expect(syncSkill(ROOT, "install", SKILL, fs).action).toBe("created");
    expect(PATH).toBe("/home/u/.claude/skills/polyagent/SKILL.md");
    expect(fs.files[PATH]).toBe(SKILL);
  });

  it("install never overwrites a same-name skill the user wrote (no marker)", () => {
    const fs = new FakeSkillFs({ [PATH]: "---\nname: polyagent\n---\nmine\n" });
    const result = syncSkill(ROOT, "install", SKILL, fs);
    expect(result.action).toBe("skipped");
    expect(result.reason).toMatch(/marker/);
    expect(fs.writes).toHaveLength(0);
  });

  it("boot replaces an older managed skill and leaves an up-to-date one untouched", () => {
    const fs = new FakeSkillFs({ [PATH]: renderPolyagentSkill("1.0.0") });
    expect(syncSkill(ROOT, "boot", SKILL, fs).action).toBe("replaced");
    expect(fs.files[PATH]).toBe(SKILL);
    expect(syncSkill(ROOT, "boot", SKILL, fs).action).toBe("unchanged");
    expect(fs.writes).toHaveLength(1);
  });

  it("boot never creates the skill and never touches a user-owned one", () => {
    const empty = new FakeSkillFs();
    expect(syncSkill(ROOT, "boot", SKILL, empty).action).toBe("skipped");
    const owned = new FakeSkillFs({ [PATH]: "mine\n" });
    expect(syncSkill(ROOT, "boot", SKILL, owned).action).toBe("skipped");
    expect(empty.writes.length + owned.writes.length).toBe(0);
  });

  it("dry-run reports the action without writing", () => {
    const fs = new FakeSkillFs();
    expect(syncSkill(ROOT, "dry-run", SKILL, fs).action).toBe("created");
    expect(fs.writes).toHaveLength(0);
  });
});
