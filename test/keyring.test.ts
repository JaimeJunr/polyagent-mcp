import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENROUTER_KEYRING_ATTRS, lookupKeyringSecret } from "../src/cli.js";

// secret-tool falso: só responde aos atributos que o secret-request grava para `openrouter`.
const dirs: string[] = [];
function fakeSecretTool(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-secret-tool-"));
  dirs.push(dir);
  const bin = join(dir, "secret-tool");
  writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("lookupKeyringSecret", () => {
  it("uses the secret-request attributes for the openrouter namespace", () => {
    expect(OPENROUTER_KEYRING_ATTRS).toEqual([
      "service", "ivt-secret-request", "ns", "openrouter", "env", "OPENROUTER_API_KEY",
    ]);
  });

  it("returns the trimmed secret when secret-tool finds the item", () => {
    const bin = fakeSecretTool(
      '[ "$*" = "lookup service ivt-secret-request ns openrouter env OPENROUTER_API_KEY" ] && printf "fake-key\\n" && exit 0\nexit 1',
    );
    expect(lookupKeyringSecret(OPENROUTER_KEYRING_ATTRS, bin)).toBe("fake-key");
  });

  it("returns undefined when the item is missing, the output is empty or the binary does not exist", () => {
    expect(lookupKeyringSecret(OPENROUTER_KEYRING_ATTRS, fakeSecretTool("exit 1"))).toBeUndefined();
    expect(lookupKeyringSecret(OPENROUTER_KEYRING_ATTRS, fakeSecretTool("exit 0"))).toBeUndefined();
    expect(lookupKeyringSecret(OPENROUTER_KEYRING_ATTRS, "/nonexistent/secret-tool")).toBeUndefined();
  });
});
