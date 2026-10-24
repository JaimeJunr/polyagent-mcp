import { describe, expect, it } from "vitest";
import { LEVELS } from "../src/cli.js";
// @ts-expect-error — fixtures do benchmark são ESM sem declaração TypeScript.
import { SHADOW_CASES } from "../bench/jev-fixtures.mjs";

describe("Jev benchmark named levels", () => {
  it("labels all 25 fixtures with a named expected level", () => {
    expect(SHADOW_CASES).toHaveLength(25);
    const expected = SHADOW_CASES.map((fixture: { expected: string }) => fixture.expected);
    for (const level of expected) expect(LEVELS).toContain(level);
    expect(new Set(expected)).toEqual(new Set(LEVELS));
  });

  it("uses valid ordered named bounds that contain the expected level", () => {
    expect(SHADOW_CASES).toHaveLength(25);
    for (const fixture of SHADOW_CASES) {
      expect(fixture.ok).toHaveLength(2);
      const [lower, upper] = fixture.ok.map((level: string) => LEVELS.indexOf(level as never));
      expect(lower).toBeGreaterThanOrEqual(0);
      expect(upper).toBeGreaterThanOrEqual(lower);
      const expected = LEVELS.indexOf(fixture.expected);
      expect(expected).toBeGreaterThanOrEqual(lower);
      expect(expected).toBeLessThanOrEqual(upper);
    }
  });
});
