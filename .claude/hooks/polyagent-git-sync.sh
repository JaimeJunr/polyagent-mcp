#!/usr/bin/env bash
# polyagent-mcp: mantem o contexto atualizado com o time no INICIO da sessao (SEGURO).
#
# SessionStart (startup/resume). Faz git fetch e:
#   - local estritamente ATRAS + arvore LIMPA  -> fast-forward automatico
#   - qualquer outro caso (divergiu / mudanca local / commit nao publicado) -> so AVISA
# NUNCA faz pull/merge cego. Nunca falha a sessao (sai sempre com 0).

# GIT_* herdado do ambiente vence cwd; sem limpar, o hook le/escreve o repo errado.
for _k in $(env | awk -F= '/^GIT_/ {print $1}'); do
  unset "$_k"
done

ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$ROOT" ]; then
  ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
fi
cd "$ROOT" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1 || exit 0

if command -v timeout >/dev/null 2>&1; then TO="timeout 10"; else TO=""; fi
$TO git fetch --quiet 2>/dev/null || {
  echo "polyagent-mcp: sem rede pra checar atualizacoes do time (seguindo offline)."
  exit 0
}

local_sha=$(git rev-parse @ 2>/dev/null)
remote_sha=$(git rev-parse '@{u}' 2>/dev/null)
base_sha=$(git merge-base @ '@{u}' 2>/dev/null)

[ "$local_sha" = "$remote_sha" ] && exit 0

behind=$(git rev-list --count '@..@{u}' 2>/dev/null)
ahead=$(git rev-list --count '@{u}..@' 2>/dev/null)

if [ "$local_sha" = "$base_sha" ]; then
  if [ -z "$(git status --porcelain)" ]; then
    if git merge --ff-only --quiet '@{u}' 2>/dev/null; then
      echo "polyagent-mcp: atualizado com o time (+${behind} commit(s), fast-forward)."
    else
      echo "polyagent-mcp: ha +${behind} commit(s) do time. Rode 'git pull' pra atualizar."
    fi
  else
    echo "polyagent-mcp: ha +${behind} commit(s) do time, mas voce tem mudancas nao-commitadas — nao puxei pra nao sobrescrever. Rode 'git pull' quando quiser."
  fi
elif [ "$remote_sha" = "$base_sha" ]; then
  echo "polyagent-mcp: voce tem ${ahead} commit(s) local(is) nao publicado(s) — 'git push' quando quiser compartilhar com o time."
else
  echo "polyagent-mcp: local e time divergiram (${ahead} local x ${behind} do time). Reconcilie com 'git pull'."
fi
exit 0
