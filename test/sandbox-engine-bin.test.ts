import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as cli from "../src/cli.js";

const home = "/home/u";
const resolve = (locations: string[], target: string, covered: string[] = [], path = "/missing:/home/linuxbrew/.linuxbrew/bin:/opt/link/bin") =>
  cli.resolveEngineBinary("opencode", path, home, covered, (p) => locations.includes(p), () => target, "/repo");

afterEach(() => vi.unstubAllEnvs());

describe("resolveEngineBinary", () => {
  it("resolve o primeiro executável e monta as duas raízes de instalação", () => {
    expect(resolve(["/home/linuxbrew/.linuxbrew/bin/opencode", "/opt/link/bin/opencode"], "/opt/cellar/opencode/bin/opencode"))
      .toEqual({ hostPath: "/home/linuxbrew/.linuxbrew/bin/opencode", roBinds: ["/home/linuxbrew", "/opt/cellar"] });
  });

  it("monta só o primeiro segmento do HOME e deduplica a raiz do realpath", () => {
    expect(resolve(["/home/u/.bun/bin/opencode"], "/home/u/.bun/install/opencode", [], "/home/u/.bun/bin"))
      .toEqual({ hostPath: "/home/u/.bun/bin/opencode", roBinds: ["/home/u/.bun"] });
  });

  it.each(["/usr", "/home/u/.local", "/home/u/.opencode", "/home/u/.engine-state", "/mnt/extra", "/repo"])(
    "não duplica a cobertura existente de %s", (root) => {
      const binary = `${root}/bin/opencode`;
      expect(resolve([binary], binary, [root], `${root}/bin`).roBinds).toEqual([]);
    },
  );

  it("não confunde prefixo textual com diretório coberto", () => {
    expect(resolve(["/opt/foobar/bin/opencode"], "/opt/foobar/bin/opencode", ["/opt/foo"], "/opt/foobar/bin").roBinds)
      .toEqual(["/opt/foobar"]);
  });

  it("resolve PATH relativo e vazio a partir do cwd da execução", () => {
    expect(resolve(["/repo/tools/opencode"], "/opt/engine/opencode", ["/repo"], "tools:")).toEqual({
      hostPath: "/repo/tools/opencode", roBinds: ["/opt/engine"],
    });
    expect(resolve(["/repo/opencode"], "/repo/opencode", ["/repo"], "").hostPath).toBe("/repo/opencode");
  });

  it("não monta nada quando o binário não existe no PATH do host", () => {
    expect(resolve([], "/unused")).toEqual({ hostPath: null, roBinds: [] });
  });
});

describe("sandbox engine binary integration", () => {
  it("buildSandboxSpec ignora candidato sem permissão de execução e acha o próximo", () => {
    const root = mkdtempSync(join(tmpdir(), "engine-path-"));
    const first = join(root, "first");
    const second = join(root, "second");
    let built: ReturnType<typeof cli.buildSandboxSpec> | undefined;
    try {
      // Dois arquivos no PATH: o primeiro existe, mas execvp só pode executar o segundo.
      mkdirSync(first); mkdirSync(second);
      writeFileSync(join(first, cli.OPENCODE_BIN), "#!/bin/sh\nexit 0\n", { mode: 0o644 });
      writeFileSync(join(second, cli.OPENCODE_BIN), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      chmodSync(join(second, cli.OPENCODE_BIN), 0o755);
      vi.stubEnv("PATH", `${first}:${second}`);
      built = cli.buildSandboxSpec("/repo", "opencode");
      expect(built.spec.engineHostPath).toBe(join(second, cli.OPENCODE_BIN));
      expect(built.spec.engineRoBinds).toEqual([root]);
    } finally {
      built?.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([false, true])("mantém isoHome, overlays, instalação RO, extras e workspace por último (RO=%s)", (workspaceRo) => {
    const spec: cli.SandboxSpec = {
      home, user: "u", path: "/opt/foo/bin:/usr/bin", lang: "C", lcAll: "C",
      isoHome: "/tmp/home", tmpDir: "/tmp/tmp", workspace: "/repo", workspaceRo,
      systemRo: ["/usr"], homeRo: ["/home/u/.local"], homeRw: ["/home/u/.cache"],
      engineRoBinds: ["/opt/foo"], extraBinds: ["/mnt/extra"], roBinds: [],
      shims: [], realBins: [], shimDir: null, extraEnv: [],
    };
    const args = cli.buildSandboxArgs(spec);
    const binds = args.flatMap((arg, i) => arg === "--bind" || arg === "--ro-bind" ? [args.slice(i, i + 3)] : []);
    expect(binds).toEqual([
      ["--ro-bind", "/usr", "/usr"], ["--bind", "/tmp/home", home], ["--bind", "/tmp/tmp", "/tmp"],
      ["--ro-bind", "/home/u/.local", "/home/u/.local"], ["--bind", "/home/u/.cache", "/home/u/.cache"],
      ["--ro-bind", "/opt/foo", "/opt/foo"], ["--bind", "/mnt/extra", "/mnt/extra"],
      [workspaceRo ? "--ro-bind" : "--bind", "/repo", "/repo"],
    ]);
  });
});

describe("sandboxExecError", () => {
  const stderr = "bwrap: execvp opencode: No such file or directory";
  it("inclui o caminho resolvido no host na falha execvp do bwrap", () => {
    expect(cli.sandboxExecError(stderr, "opencode", "/home/linuxbrew/.linuxbrew/bin/opencode"))
      .toBe(`${stderr}\nHost PATH resolved opencode to /home/linuxbrew/.linuxbrew/bin/opencode.`);
  });
  it("explica que o executável não foi encontrado no PATH do host", () => {
    expect(cli.sandboxExecError(stderr, "opencode", null))
      .toBe(`${stderr}\nopencode was not found on the host PATH.`);
  });
  it("preserva outras falhas sem diagnóstico enganoso", () => {
    expect(cli.sandboxExecError("authentication failed", "opencode", null)).toBe("authentication failed");
    expect(cli.sandboxExecError(stderr, "codex", null)).toBe(stderr);
  });
});
