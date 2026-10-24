# OpenShell (NVIDIA) e o `deny` de comandos

**Decisão:** não adotar o OpenShell como sandbox. O bwrap continua, e o bloqueio de comandos vira o
parâmetro `deny` do `delegate`/`fast_delegate` (shims em `/bin/sh` sobrepostos ao binário real).
Sem medição de latência do OpenShell: a comparação é pela documentação dele.

## O que é o OpenShell

Runtime Apache-2.0 que roda agentes (Claude Code, Codex, OpenCode…) em sandbox isolado no kernel,
com política declarativa em YAML. Gateway (plano de controle), driver de compute (Docker, Podman,
Kubernetes ou VM), supervisor confiável que decide a política e injeta credenciais, e o sandbox,
que só repassa. Linux: Landlock (arquivos), seccomp user notification (rede), cerca de rede externa.
Política: `filesystem_policy`, `landlock`, `process`, `network_policies`, `network_middlewares`;
rede e credenciais recarregam ao vivo, o resto fica fixo na criação.
Fontes: <https://github.com/NVIDIA/OpenShell>, <https://docs.nvidia.com/openshell/about/architecture>,
<https://docs.nvidia.com/openshell/how-it-works/policies/overview> (consultadas em 2026-10-24).

## Por que não adotar

- **Não tem lista de comandos.** `process` só define usuário e grupo; binário só aparece atrelado a
  destino de rede. O `deny` (`git push` sim, `git commit` não) teria de ser feito de todo jeito.
- **Peso por chamada.** Cada sandbox é container ou VM mais supervisor; nossas chamadas nascem e
  morrem a cada `delegate`, e o bwrap abre em milissegundos. A máquina do dono é curta de RAM.
- **Credenciais.** Ele injeta chave de API na requisição; nós usamos OAuth de assinatura (codex,
  claude) que renova gravando em arquivo — o ponto que já queimou o token do host (bind RO → EROFS).
  Não confirmado se o OpenShell suporta isso.
- **Maturidade.** Alpha (0.1.x), single-player, telemetria ligada por padrão
  (`OPENSHELL_TELEMETRY_ENABLED=false`).
- O motivo do nosso sandbox (esconder a config global de cada CLI, −80% de tokens) já está resolvido.

## O que ele faz e nós não

Política de rede por programa: hoje o worker roda com `--share-net` e alcança qualquer destino.
Também: credencial que o worker nunca vê. Achado lateral: `SANDBOX_HOME_RO` monta `~/.local`
inteiro, então qualquer worker lê `~/.local/share/opencode/auth.json` (chave OpenRouter).

## Descartado para o `deny`

- seccomp: não enxerga argv, não separa `git commit` de `git push`.
- Desligar a rede: derruba a API do próprio engine.
- Regra nativa por engine (`--disallowedTools` no claude): cada engine tem um dialeto, alguns nenhum.
- Shim só no começo do PATH: caminho absoluto (`/usr/bin/git`) escapa. Por isso o overlay em cada
  cópia do binário.

## Medido (bwrap real, `dist/` compilado, 2026-10-24)

Com `deny: ["git push", "git merge", "rm"]`: exit 126 em `git push origin main`,
`git -C . -c a=b push`, alias `git p` → push, `git merge x`, `/usr/bin/git push`, `rm`, `/bin/rm`,
`git --exec-path=/usr/lib/git-core push`. Passam: `git commit`, `git log`, `git status`.
`/usr/lib/git-core/git-push` é symlink para `/usr/bin/git` (o shim): falha sem dar push, só sem a
mensagem de bloqueio. Escapam (documentado): `git pull` (merge interno), `-c alias.x=push`, scripts do projeto chamados
por caminho (`bin/rails`, `./manage.py`, `node_modules/.bin/*`) e execuções indiretas (`npm run
migrate`, um alvo de make que roda migrate por dentro, `bundle exec` carregando em-processo): só
comandos no PATH/dirs de sistema recebem shim e o `cmd` rejeita barra. Fora do git a regra casa por
subsequência ordenada de tokens inteiros, então `npm --registry x publish`, `make -j4 db-up` e
`docker compose -f x.yml down` são bloqueados.

## Reavaliar

- Se política de rede virar prioridade (exfiltração), testar o OpenShell como backend opcional
  (`POLYAGENT_SANDBOX=openshell`), depois que sair do alpha, medindo a subida por chamada.
- Se o OpenShell ganhar lista de comandos ou suporte a OAuth que renova em arquivo.
