import { describe, it, expect } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseDenyRules, buildShimScript, resolveShimTargets, denyNote, buildSandboxArgs, fallbackOpts,
  type DenyRule, type SandboxSpec,
} from "../src/cli.js";

describe("parseDenyRules", () => {
  it("separa comando e args por whitespace", () => {
    expect(parseDenyRules(["git push", "rm", "  npm   publish  "])).toEqual([
      { cmd: "git", args: ["push"] },
      { cmd: "rm", args: [] },
      { cmd: "npm", args: ["publish"] },
    ]);
  });

  it("aceita args com flags e devolve lista vazia para lista vazia", () => {
    expect(parseDenyRules(["git push --force"])).toEqual([{ cmd: "git", args: ["push", "--force"] }]);
    expect(parseDenyRules([])).toEqual([]);
  });

  it.each(["", "   "])("rejeita entrada vazia: %j", (entry) => {
    expect(() => parseDenyRules([entry])).toThrow(/invalid deny entry/);
  });

  it("rejeita cmd com barra, citando o valor recebido e o formato esperado", () => {
    expect(() => parseDenyRules(["/bin/rm"])).toThrow(/received "\/bin\/rm".*expected/);
    expect(() => parseDenyRules(["./git push"])).toThrow(/received "\.\/git push"/);
  });

  it("rejeita cmd com $ ou outros caracteres fora do formato", () => {
    expect(() => parseDenyRules(["$HOME"])).toThrow(/received "\$HOME".*\[A-Za-z0-9\._\+-\]/);
    expect(() => parseDenyRules(["rm;ls"])).toThrow(/invalid deny entry/);
  });

  it.each([["git push 'x'"], ['git push "x"'], ["git push a\\b"], ["git push $X"], ["git push `id`"]])(
    "rejeita args que não cabem num script de shell: %s",
    (entry) => {
      expect(() => parseDenyRules([entry])).toThrow(new RegExp("received " + JSON.stringify(entry).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    },
  );

  it.each(["sh", "bash", "dash", ".", ".."])("rejeita %s: o shim roda em /bin/sh", (cmd) => {
    expect(() => parseDenyRules([cmd])).toThrow(/invalid deny entry/);
  });
});

describe("resolveShimTargets", () => {
  const SYSTEM = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/local/bin"];
  type Kind = "elf" | "script";
  /**
   * fs falso: `files` são arquivos regulares, `symlinks` apontam para um arquivo, e `real` simula
   * symlink de DIRETÓRIO (/bin → usr/bin): o arquivo não é symlink, mas o realpath muda.
   */
  const fsOf = (
    files: Record<string, Kind>,
    symlinks: Record<string, string> = {},
    real: Record<string, string> = {},
  ) => {
    const realpath = (p: string): string => real[p] ?? (symlinks[p] ? realpath(symlinks[p]) : p);
    return {
      exists: (p: string) => p in files || (p in symlinks && realpath(p) in files),
      realpath,
      isSymlink: (p: string) => p in symlinks,
      isElf: (p: string) => files[p] === "elf",
    };
  };
  const resolve = (cmd: string, dirs: string[], fs: ReturnType<typeof fsOf>) =>
    resolveShimTargets(cmd, dirs, fs.exists, fs.realpath, fs.isSymlink, fs.isElf);

  it("cobre /bin e /usr/bin separadamente (bind de /bin não é o mesmo mount de /usr/bin)", () => {
    const fs = fsOf({ "/usr/bin/rm": "elf", "/bin/rm": "elf" }, {}, { "/bin/rm": "/usr/bin/rm" });
    const res = resolve("rm", ["/usr/bin", "/bin"], fs);
    expect(res?.targets).toEqual(["/usr/bin/rm", "/bin/rm"]);
    expect(res?.real).toBe("/usr/bin/rm");
    expect(res?.relocate).toBe(true);
  });

  it("symlink para ELF (python → python3.14): sobrepõe o ELF resolvido, nunca o symlink", () => {
    const fs = fsOf(
      { "/usr/bin/python3.14": "elf" },
      { "/usr/bin/python": "/usr/bin/python3", "/usr/bin/python3": "/usr/bin/python3.14" },
    );
    const res = resolve("python", ["/usr/bin"], fs);
    expect(res?.targets).toEqual(["/usr/bin/python3.14"]);
    expect(res?.real).toBe("/usr/bin/python3.14");
    expect(res?.relocate).toBe(true);
  });

  it("symlink para script (npx → npx-cli.js): não sobrepõe nada, REAL é o path original", () => {
    const fs = fsOf(
      { "/usr/lib/node_modules/npm/bin/npx-cli.js": "script" },
      { "/usr/bin/npx": "/usr/lib/node_modules/npm/bin/npx-cli.js" },
    );
    const res = resolve("npx", ["/usr/bin"], fs);
    expect(res).toEqual({ targets: [], real: "/usr/bin/npx", relocate: false });
  });

  it("script regular (não symlink) também não é sobreposto nem realocado", () => {
    const fs = fsOf({ "/usr/bin/rake": "script" });
    expect(resolve("rake", ["/usr/bin"], fs)).toEqual({ targets: [], real: "/usr/bin/rake", relocate: false });
  });

  it("nunca inclui localização que é symlink, mesmo apontando para o ELF", () => {
    const fs = fsOf({ "/usr/bin/git": "elf" }, { "/bin/git": "/usr/bin/git", "/usr/local/bin/git": "/usr/bin/git" });
    const res = resolve("git", ["/usr/bin", "/bin"], fs);
    expect(res?.targets).toEqual(["/usr/bin/git"]);
  });

  it("inclui os dirs de sistema mesmo fora do PATH, dedupando por path", () => {
    const fs = fsOf({ "/usr/bin/git": "elf", "/bin/git": "elf", "/opt/tools/git": "elf" });
    const res = resolve("git", ["/opt/tools", "/usr/bin"], fs);
    expect(res?.targets).toEqual(["/opt/tools/git", "/usr/bin/git", "/bin/git"]);
    // o real é o realpath do PRIMEIRO match, na ordem do PATH
    expect(res?.real).toBe("/opt/tools/git");
    expect(new Set(res?.targets).size).toBe(res?.targets.length);
  });

  it("ignora dirs relativos e vazios do PATH", () => {
    const fs = fsOf({ "/usr/bin/git": "elf", "bin/git": "elf", "./git": "elf" });
    const res = resolve("git", ["", ".", "bin"], fs);
    expect(res?.targets).toEqual(["/usr/bin/git"]);
  });

  it("devolve null (sem lançar) quando o comando não existe em lugar nenhum", () => {
    const fs = fsOf({ "/usr/bin/ls": "elf" });
    expect(resolve("npm-fantasma", ["/usr/bin"], fs)).toBeNull();
    expect(SYSTEM.every((dir) => !fs.exists(`${dir}/npm-fantasma`))).toBe(true);
  });

  it("symlink quebrado não conta como existente", () => {
    const fs = fsOf({}, { "/usr/bin/ghost": "/usr/lib/gone" });
    expect(resolve("ghost", ["/usr/bin"], fs)).toBeNull();
  });
});

describe("denyNote", () => {
  it.each([undefined, []])("é string vazia sem deny: %j", (deny) => {
    expect(denyNote(deny)).toBe("");
  });

  it("lista os comandos bloqueados e o exit 126", () => {
    const note = denyNote(["git push", "rm"]);
    expect(note).toContain("[Blocked commands:");
    expect(note).toContain("git push");
    expect(note).toContain("rm");
    expect(note).toContain("exit 126");
    expect(note).toContain("do not attempt them or work around them");
    expect(note.startsWith("\n\n")).toBe(true);
  });

  it("normaliza whitespace das entradas", () => {
    expect(denyNote(["  git    push "])).toContain("git push");
  });
});

describe("buildSandboxArgs com shims", () => {
  const spec: SandboxSpec = {
    home: "/home/u", user: "u", path: "/usr/bin", lang: "C.UTF-8", lcAll: "C.UTF-8",
    isoHome: "/tmp/iso", tmpDir: "/tmp/sbx", workspace: "/repo", workspaceRo: false,
    systemRo: ["/usr", "/bin"],
    homeRo: ["/home/u/.local"],
    homeRw: ["/home/u/.gradle"],
    extraBinds: ["/mnt/extra"],
    roBinds: ["/skills/audit"],
    shims: [
      { file: "/tmp/cbx-shim-x/git", target: "/usr/bin/git" },
      { file: "/tmp/cbx-shim-x/git", target: "/bin/git" },
    ],
    realBins: [{ src: "/usr/bin/git", dest: "/run/polyagent-real/git" }],
    shimDir: "/tmp/cbx-shim-x",
    extraEnv: [],
  };
  const binds = (args: string[]) =>
    args.flatMap((arg, i) => arg === "--bind" || arg === "--ro-bind" ? [args.slice(i, i + 3)] : []);

  it("binda o real e os shims DEPOIS do tmpfs /run e dos overlays do HOME, antes do workspace", () => {
    const args = buildSandboxArgs(spec);
    const runAt = args.indexOf("--tmpfs");
    expect(args[runAt + 1]).toBe("/run");
    const all = binds(args);
    const at = (dest: string) => all.findIndex((b) => b[2] === dest);
    const argsAt = (dest: string) => args.findIndex((a, i) => a === dest && args[i - 2] === "--ro-bind");
    expect(argsAt("/run/polyagent-real/git")).toBeGreaterThan(runAt);
    expect(argsAt("/usr/bin/git")).toBeGreaterThan(runAt);
    expect(at("/usr/bin/git")).toBeGreaterThan(at("/home/u/.local"));
    expect(at("/usr/bin/git")).toBeGreaterThan(at("/home/u/.gradle"));
    expect(at("/bin/git")).toBeGreaterThan(at("/skills/audit"));
    expect(at("/usr/bin/git")).toBeLessThan(at("/repo"));
  });

  it("mantém o workspace como último bind, RW ou RO", () => {
    for (const workspaceRo of [false, true]) {
      const all = binds(buildSandboxArgs({ ...spec, workspaceRo }));
      expect(all[all.length - 1]).toEqual([workspaceRo ? "--ro-bind" : "--bind", "/repo", "/repo"]);
    }
  });

  it("monta shim e real como --ro-bind (arquivo do host → destino)", () => {
    const all = binds(buildSandboxArgs(spec));
    expect(all).toContainEqual(["--ro-bind", "/tmp/cbx-shim-x/git", "/usr/bin/git"]);
    expect(all).toContainEqual(["--ro-bind", "/tmp/cbx-shim-x/git", "/bin/git"]);
    expect(all).toContainEqual(["--ro-bind", "/usr/bin/git", "/run/polyagent-real/git"]);
  });

  it("binda o dir dos shims RO em /run/polyagent-shims, depois do tmpfs /run e antes do workspace", () => {
    const args = buildSandboxArgs(spec);
    const all = binds(args);
    const dirAt = all.findIndex((b) => b[2] === "/run/polyagent-shims");
    expect(all[dirAt]).toEqual(["--ro-bind", "/tmp/cbx-shim-x", "/run/polyagent-shims"]);
    const tmpfsAt = args.indexOf("--tmpfs");
    expect(args.indexOf("/run/polyagent-shims")).toBeGreaterThan(tmpfsAt);
    expect(dirAt).toBeGreaterThan(all.findIndex((b) => b[2] === "/home/u/.gradle"));
    expect(dirAt).toBeLessThan(all.findIndex((b) => b[2] === "/repo"));
    expect(all[all.length - 1][2]).toBe("/repo");
  });

  it("sem shimDir não há bind de /run/polyagent-shims", () => {
    const args = buildSandboxArgs({ ...spec, shimDir: null });
    expect(args).not.toContain("/run/polyagent-shims");
  });

  it("sem shims o argv segue igual (nenhum bind extra)", () => {
    const plain = binds(buildSandboxArgs({ ...spec, shims: [], realBins: [], shimDir: null }));
    expect(plain.some((b) => b[2].includes("polyagent-real"))).toBe(false);
    expect(plain[plain.length - 1]).toEqual(["--bind", "/repo", "/repo"]);
  });
});

describe("fallbackOpts carrega deny", () => {
  it("mantém deny no retry em outro engine", () => {
    const result = fallbackOpts({ prompt: "q", engine: "codex", deny: ["git push", "rm"] }, "claude");
    expect(result.deny).toEqual(["git push", "rm"]);
    expect(result.engine).toBe("claude");
  });

  it("deny ausente continua ausente", () => {
    expect(fallbackOpts({ prompt: "q", engine: "codex" }, "grok").deny).toBeUndefined();
  });
});

describe("buildShimScript — comportamento real via sh", () => {
  const FAKE_REAL = [
    "#!/bin/sh",
    'if [ "$1" = config ] && [ "$2" = --get ]; then',
    '  case "$3" in',
    "    alias.p) echo push; exit 0 ;;",
    "    alias.pf) echo 'push --force'; exit 0 ;;",
    "    alias.sh) echo '!git push'; exit 0 ;;",
    "    alias.st) echo 'status -sb'; exit 0 ;;",
    "  esac",
    "  exit 1",
    "fi",
    'for a in "$@"; do printf "[%s]\\n" "$a"; done',
  ].join("\n");

  const withShim = (cmd: string, rules: DenyRule[], run: (shim: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), "cbx-shim-test-"));
    try {
      const real = join(dir, "real");
      const shim = join(dir, "shim");
      writeFileSync(real, FAKE_REAL);
      chmodSync(real, 0o755);
      writeFileSync(shim, buildShimScript(cmd, rules, real));
      chmodSync(shim, 0o755);
      run(shim);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const exec = (shim: string, args: string[]) => {
    const res = spawnSync("sh", [shim, ...args], { encoding: "utf8" });
    return { code: res.status, out: res.stdout, err: res.stderr };
  };
  const GIT_PUSH: DenyRule[] = [{ cmd: "git", args: ["push"] }];

  it("repassa `git commit -m x` ao real com os args EXATOS", () => {
    withShim("git", GIT_PUSH, (shim) => {
      const r = exec(shim, ["commit", "-m", "a b  c"]);
      expect(r.code).toBe(0);
      expect(r.out).toBe("[commit]\n[-m]\n[a b  c]\n");
    });
  });

  it("bloqueia `git push origin main` com exit 126 e a mensagem no stderr", () => {
    withShim("git", GIT_PUSH, (shim) => {
      const r = exec(shim, ["push", "origin", "main"]);
      expect(r.code).toBe(126);
      expect(r.err).toContain("polyagent: 'git push' is blocked in this sandbox (deny list)");
      expect(r.out).toBe("");
    });
  });

  it("bloqueia push atrás de opções globais (-C, -c, --git-dir=, --no-pager)", () => {
    withShim("git", GIT_PUSH, (shim) => {
      for (const args of [
        ["-C", "/tmp", "push"],
        ["-c", "a=b", "push"],
        ["--git-dir=/x/.git", "push", "origin"],
        ["--git-dir", "/x/.git", "--work-tree", "/x", "push"],
        ["--no-pager", "-p", "-c", "k=v", "-C", "..", "push"],
      ]) {
        const r = exec(shim, args);
        expect([args.join(" "), r.code]).toEqual([args.join(" "), 126]);
      }
    });
  });

  it("opções globais em subcomandos permitidos continuam passando com args originais", () => {
    withShim("git", GIT_PUSH, (shim) => {
      const r = exec(shim, ["-C", "/tmp", "status", "-s"]);
      expect(r.code).toBe(0);
      expect(r.out).toBe("[-C]\n[/tmp]\n[status]\n[-s]\n");
    });
  });

  it("resolve alias: `git p` (alias.p = push) é bloqueado", () => {
    withShim("git", GIT_PUSH, (shim) => {
      const r = exec(shim, ["p", "origin"]);
      expect(r.code).toBe(126);
      expect(r.err).toContain("'git push' is blocked");
    });
  });

  it("resolve alias de shell `!git push` e alias com flags", () => {
    withShim("git", [{ cmd: "git", args: ["push", "--force"] }], (shim) => {
      expect(exec(shim, ["pf"]).code).toBe(126); // alias.pf = push --force
      expect(exec(shim, ["p"]).code).toBe(0); // push sem --force não casa com a regra
    });
    withShim("git", GIT_PUSH, (shim) => {
      expect(exec(shim, ["sh"]).code).toBe(126); // alias.sh = !git push
    });
  });

  it("alias inofensivo passa (git st → status)", () => {
    withShim("git", GIT_PUSH, (shim) => {
      const r = exec(shim, ["st"]);
      expect(r.code).toBe(0);
      expect(r.out).toBe("[st]\n");
    });
  });

  it("não confunde prefixo: `git pushx` e `git status` passam", () => {
    withShim("git", GIT_PUSH, (shim) => {
      expect(exec(shim, ["pushx"]).code).toBe(0);
      expect(exec(shim, ["status"]).code).toBe(0);
      expect(exec(shim, []).code).toBe(0);
    });
  });

  it("regra sem args (`rm`) bloqueia toda invocação", () => {
    withShim("rm", [{ cmd: "rm", args: [] }], (shim) => {
      const r = exec(shim, ["-rf", "x"]);
      expect(r.code).toBe(126);
      expect(r.err).toContain("polyagent: 'rm' is blocked in this sandbox (deny list)");
      expect(exec(shim, []).code).toBe(126);
    });
  });

  it("regra com args em comando não-git casa como subsequência ordenada (`npm publish`)", () => {
    withShim("npm", [{ cmd: "npm", args: ["publish"] }], (shim) => {
      expect(exec(shim, ["publish", "--tag", "x"]).code).toBe(126);
      expect(exec(shim, ["--registry", "x", "publish"]).code).toBe(126);
      expect(exec(shim, ["install"]).code).toBe(0);
      expect(exec(shim, ["install", "publisher"]).code).toBe(0);
    });
  });

  const blockedBy = (cmd: string, rule: string[], cases: string[][], allowed: string[][]) =>
    withShim(cmd, [{ cmd, args: rule }], (shim) => {
      for (const args of cases) expect([args.join(" "), exec(shim, args).code]).toEqual([args.join(" "), 126]);
      for (const args of allowed) expect([args.join(" "), exec(shim, args).code]).toEqual([args.join(" "), 0]);
    });

  it("make db-up: opções e alvos antes da regra não escapam; db-up2 e outros alvos passam", () => {
    blockedBy("make", ["db-up"],
      [["db-up"], ["-j4", "db-up"], ["-C", "infra", "db-up"], ["build", "db-up"], ["db-up", "build"]],
      [["build"], ["db-up2"], ["-C", "db-up2"], []]);
  });

  it("npx prisma migrate: flags intercaladas bloqueiam, prisma generate passa", () => {
    blockedBy("npx", ["prisma", "migrate"],
      [["prisma", "migrate", "deploy"], ["-y", "prisma", "migrate", "deploy"], ["prisma", "-q", "migrate"]],
      [["prisma", "generate"], ["migrate"], ["-y", "prisma"], ["migrate", "prisma"]]);
  });

  it("docker compose down: -f x.yml no meio não escapa, compose up passa", () => {
    blockedBy("docker", ["compose", "down"],
      [["compose", "down"], ["compose", "-f", "x.yml", "down"], ["compose", "-f", "x.yml", "down", "-v"]],
      [["compose", "up"], ["compose", "-f", "x.yml", "up", "-d"], ["down", "compose"], ["ps"]]);
  });

  it("python manage.py migrate: -u antes bloqueia, runserver e ordem invertida passam", () => {
    blockedBy("python", ["manage.py", "migrate"],
      [["manage.py", "migrate"], ["-u", "manage.py", "migrate"], ["manage.py", "--noinput", "migrate"]],
      [["manage.py", "runserver"], ["migrate", "manage.py"], ["manage.py"], ["-m", "migrate"]]);
  });

  it("bundle exec rails db:migrate: igualdade exata de token (db:migrate:status passa)", () => {
    blockedBy("bundle", ["exec", "rails", "db:migrate"],
      [["exec", "rails", "db:migrate"], ["exec", "rails", "db:migrate", "VERSION=1"], ["exec", "-v", "rails", "db:migrate"]],
      [["exec", "rails", "db:migrate:status"], ["exec", "rails", "server"], ["exec", "db:migrate", "rails"]]);
    blockedBy("rake", ["db:migrate"], [["db:migrate"], ["-t", "db:migrate"]], [["db:migrate:status"], ["db:rollback"]]);
  });

  it("subsequência exige tokens inteiros e não reaproveita um token para duas posições", () => {
    blockedBy("tool", ["a", "a"], [["a", "x", "a"]], [["a"], ["aa"], ["a", "b"]]);
  });

  it("git mantém a lógica de subcomando: `git commit -m push` passa, sem subsequência", () => {
    withShim("git", GIT_PUSH, (shim) => {
      expect(exec(shim, ["commit", "-m", "push"]).code).toBe(0);
      expect(exec(shim, ["log", "push"]).code).toBe(0);
      expect(exec(shim, ["push"]).code).toBe(126);
    });
    withShim("git", [{ cmd: "git", args: ["push", "--force"] }], (shim) => {
      expect(exec(shim, ["push", "origin", "--force"]).code).toBe(0); // git continua por prefixo
      expect(exec(shim, ["push", "--force"]).code).toBe(126);
    });
  });

  it("várias regras para o mesmo comando: qualquer uma bloqueia", () => {
    withShim("git", [{ cmd: "git", args: ["push"] }, { cmd: "git", args: ["merge"] }], (shim) => {
      expect(exec(shim, ["push"]).code).toBe(126);
      expect(exec(shim, ["merge", "x"]).code).toBe(126);
      expect(exec(shim, ["-C", "d", "merge"]).err).toContain("'git merge' is blocked");
      expect(exec(shim, ["log"]).code).toBe(0);
    });
  });

  it("ignora regras de outro comando", () => {
    withShim("git", [{ cmd: "rm", args: [] }], (shim) => {
      expect(exec(shim, ["push"]).code).toBe(0);
    });
  });

  it("escapa o path do real com aspas simples", () => {
    const script = buildShimScript("rm", [{ cmd: "rm", args: ["x"] }], "/run/it's/real");
    expect(script).toContain(`REAL='/run/it'\\''s/real'`);
  });
});
