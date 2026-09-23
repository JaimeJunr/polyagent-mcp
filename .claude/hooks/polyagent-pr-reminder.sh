#!/usr/bin/env bash
# polyagent-mcp: lembrete de realimentar o CLAUDE.md do repo ao abrir/atualizar um PR.
#
# Variante do context-pr-reminder.sh para o CAMINHO LEVE (1 repo, Fase 0b): o
# destino do aprendizado e o proprio CLAUDE.md da raiz — nao ha arquivos/,
# repos/, glossario.md nem memory/ aqui.
#
# PostToolUse(Bash). So age quando o comando contem "git push".
# Nunca falha o push: sai sempre com 0.

input="$(cat)"

extract_cmd() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))' 2>/dev/null
    return
  fi
  printf '%s' "$input"
}

cmd="$(extract_cmd)"

case "$cmd" in
  *"git push"*)
    msg="polyagent-mcp — checkpoint de PR: se esta tarefa revelou um gotcha, mudou um comando/stack ou firmou uma convencao, atualize o CLAUDE.md da raiz ANTES de fechar; se mediu ou pesquisou algo (modelo, latencia, custo), registre em research/ e no indice research/README.md. Se nada novo surgiu, ignore."
    if command -v jq >/dev/null 2>&1; then
      jq -n --arg m "$msg" '{systemMessage:$m, hookSpecificOutput:{hookEventName:"PostToolUse", additionalContext:$m}}' 2>/dev/null
    else
      echo "$msg"
    fi
    ;;
esac

exit 0
