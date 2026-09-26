import { describe, expect, it } from "vitest";
import {
  BLOCK_BEGIN_PREFIX, BLOCK_END, type ClaudeMdFs, removeLegacySection, renderPolyagentBlock, syncClaudeMd,
  upsertManagedBlock,
} from "../src/claudeMd.js";

class FakeClaudeMdFs implements ClaudeMdFs {
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

const BLOCK = renderPolyagentBlock("9.9.9");
const PATH = "/home/u/.claude/CLAUDE.md";

describe("renderPolyagentBlock", () => {
  it("wraps the content in versioned begin/end markers", () => {
    expect(BLOCK.startsWith(`${BLOCK_BEGIN_PREFIX} v=9.9.9 -->`)).toBe(true);
    expect(BLOCK.trimEnd().endsWith(BLOCK_END)).toBe(true);
  });

  it("lists every delegate level from the tier table and steers fan_out with concrete triggers", () => {
    for (const level of ["1=", "2=", "3=", "4=", "5="]) expect(BLOCK).toContain(level);
    expect(BLOCK).toContain("claude-opus-5-5");
    expect(BLOCK).toMatch(/fan_out/);
    expect(BLOCK).toMatch(/mode: ?"consensus"/);
    expect(BLOCK).toMatch(/2\+ (designs|approaches)/);
  });
});

describe("upsertManagedBlock", () => {
  it("appends the block at the end, separated by a blank line, when no markers exist", () => {
    const result = upsertManagedBlock("# mine\nkeep me\n", BLOCK);
    expect(result.action).toBe("appended");
    expect(result.text).toBe(`# mine\nkeep me\n\n${BLOCK}`);
  });

  it("replaces only the text between the markers, keeping what surrounds them", () => {
    const old = `${BLOCK_BEGIN_PREFIX} v=0.1.0 -->\nold routing\n${BLOCK_END}\n`;
    const result = upsertManagedBlock(`before\n\n${old}after\n`, BLOCK);
    expect(result.action).toBe("replaced");
    expect(result.text).toBe(`before\n\n${BLOCK}after\n`);
  });

  it("reports unchanged when the block is already current", () => {
    const text = `x\n\n${BLOCK}`;
    expect(upsertManagedBlock(text, BLOCK)).toEqual({ action: "unchanged", text });
  });

  it("refuses a begin marker without an end marker, or duplicated markers", () => {
    expect(() => upsertManagedBlock(`${BLOCK_BEGIN_PREFIX} v=1 -->\ncut off`, BLOCK)).toThrow(/expected exactly one/);
    expect(() => upsertManagedBlock(`${BLOCK}\n${BLOCK}`, BLOCK)).toThrow(/expected exactly one/);
  });
});

describe("removeLegacySection", () => {
  it("removes the hand-written <polyagent_preference> section and its indentation", () => {
    const text = "<a>\n  <x/>\n  <polyagent_preference>\n    <tool>old</tool>\n  </polyagent_preference>\n</a>\n";
    expect(removeLegacySection(text)).toEqual({ removed: true, text: "<a>\n  <x/>\n</a>\n" });
  });

  it("leaves text without the section untouched", () => {
    expect(removeLegacySection("plain\n")).toEqual({ removed: false, text: "plain\n" });
  });
});

describe("syncClaudeMd", () => {
  it("on boot, refreshes an existing block and never creates one", () => {
    const stale = `mine\n\n${BLOCK_BEGIN_PREFIX} v=0.1.0 -->\nold\n${BLOCK_END}\n`;
    const fs = new FakeClaudeMdFs({ [PATH]: stale });
    expect(syncClaudeMd(PATH, "boot", BLOCK, fs).action).toBe("replaced");
    expect(fs.files[PATH]).toBe(`mine\n\n${BLOCK}`);

    const plain = new FakeClaudeMdFs({ [PATH]: "mine\n" });
    expect(syncClaudeMd(PATH, "boot", BLOCK, plain).action).toBe("skipped");
    expect(syncClaudeMd(PATH, "boot", BLOCK, new FakeClaudeMdFs()).action).toBe("skipped");
    expect(plain.writes).toHaveLength(0);
  });

  it("on boot, skips a malformed file instead of throwing into server startup", () => {
    const fs = new FakeClaudeMdFs({ [PATH]: `${BLOCK_BEGIN_PREFIX} v=1 -->\ncut off` });
    expect(syncClaudeMd(PATH, "boot", BLOCK, fs).action).toBe("skipped");
    expect(fs.writes).toHaveLength(0);
  });

  it("on install, removes the legacy section, backs up the original and appends the block", () => {
    const original = "mine\n<polyagent_preference>\nold\n</polyagent_preference>\n";
    const fs = new FakeClaudeMdFs({ [PATH]: original });
    const result = syncClaudeMd(PATH, "install", BLOCK, fs);
    expect(result).toMatchObject({ action: "appended", legacyRemoved: true, backupPath: `${PATH}.polyagent.bak` });
    expect(fs.files[`${PATH}.polyagent.bak`]).toBe(original);
    expect(fs.files[PATH]).toBe(`mine\n\n${BLOCK}`);
  });

  it("on install, creates a missing file and writes nothing when already current", () => {
    const fs = new FakeClaudeMdFs();
    expect(syncClaudeMd(PATH, "install", BLOCK, fs).action).toBe("appended");
    expect(fs.files[PATH]).toBe(BLOCK);
    const writes = fs.writes.length;
    expect(syncClaudeMd(PATH, "install", BLOCK, fs).action).toBe("unchanged");
    expect(fs.writes).toHaveLength(writes);
  });

  it("on install, still removes the legacy section when the block is already current", () => {
    const fs = new FakeClaudeMdFs({ [PATH]: `mine\n<polyagent_preference>\nold\n</polyagent_preference>\n\n${BLOCK}` });
    expect(syncClaudeMd(PATH, "install", BLOCK, fs)).toMatchObject({ action: "unchanged", legacyRemoved: true });
    expect(fs.files[PATH]).toBe(`mine\n\n${BLOCK}`);
  });

  it("on dry-run, reports the change without writing", () => {
    const fs = new FakeClaudeMdFs({ [PATH]: "mine\n" });
    expect(syncClaudeMd(PATH, "dry-run", BLOCK, fs)).toMatchObject({ action: "appended", legacyRemoved: false });
    expect(fs.writes).toHaveLength(0);
  });
});
