---
name: ship
description: Use when a polyagent-mcp change is ready to commit, open a PR, merge, or "go live" — including "abre o PR", "mergeia", "commita", or when a newly added/changed MCP tool does not show up (or still behaves the old way) in the host session after merging.
---

# ship — do diff até a tool nova aparecer no host

A entrega só termina quando o **processo MCP que o host roda** tem o código novo. O host executa
`dist/index.js` (registrado em `~/.claude.json`, servidor `polyagent`), e esse processo foi iniciado
antes do seu build: merge sem rebuild + restart = tool nova invisível.

## Sequência

1. **Branch:** nunca commit direto no `master`. Se estiver nele, `git switch -c <feat/...>`.
2. **Gate:** `npm run build` (tsc strict é o type-check) e `npm test` — em série, um por vez.
3. **Segredo:** `git status --porcelain --ignored | grep -i '\.env'` antes de `git add`. Adicione
   caminhos explícitos, não `git add -A` na raiz (`.claude/settings.local.json` é da máquina e não vai).
4. **Commit/PR:** mensagem em português (convenção do repo), com o trailer de co-autoria que a
   sessão pedir. PR com: o que muda, por quê, evidência (build, contagem de testes, execução real).
5. **Merge:** só com pedido explícito do dono. `gh pr merge <n> --merge --delete-branch` — o
   histórico usa merge commit. O repo não tem CI: a evidência é a suíte local — diga isso.
6. **Pós-merge:** `git switch master && git pull --ff-only && npm run build && npm test`.
7. **Restart:** avise que o MCP precisa reiniciar (`/mcp` num `claude` interativo, ou sessão nova).
   Para provar antes do restart, suba o servidor novo por stdio e chame a tool:

```js
// node --input-type=module -e '...' na raiz do repo
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const c = new Client({ name: "t", version: "0" });
await c.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env } }));
console.log((await c.listTools()).tools.map((t) => t.name));
await c.close();
```

## Armadilhas

- Um `delegate` recusado pelo dono **pode já ter iniciado** o worker. Antes de revisar o diff de um
  worker, confira `ps aux | grep "codex .*exec"` e o `git status`: dois workers no mesmo arquivo
  deixam mudanças que ninguém pediu.
- Bench rodando (`npm run bench`) lê `src/` e `test/` com gabarito por número de linha: não edite
  esses caminhos até ele terminar.
