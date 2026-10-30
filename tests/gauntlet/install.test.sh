#!/usr/bin/env bash
# Functional test of install-gauntlet.sh against a throwaway CLAUDE_DIR.
# Covers: fresh install, idempotency, --check (including that it is side-effect
# free), backup of a real file / a real directory / a foreign symlink,
# stale-link cleanup after an agent is removed, --uninstall restoring every
# backup, the relative-symlink fallback of resolve_path, a missing harness entry
# point, backups with [kept] items left unpruned, a moved checkout (dangling
# links of a previous install replaced without backup only when the install
# manifest proves them; a user's look-alike dangling link, or an install made by
# an older installer without a manifest, goes to backup), --check never writing
# the manifest, and a dangling agents/.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd -P)"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/gauntlet-install.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT

FAILURES=0
SKIPS=0
check() { # check <descrição> <comando...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "  ok   $label"; else echo "  FAIL $label"; FAILURES=$((FAILURES + 1)); fi
}
snapshot() { (cd "$1" && find . -printf '%p %y %l\n' | sort); }

# Uma cópia do repo para poder simular a remoção de um agente sem tocar o real.
REPO_COPY="$SANDBOX/repo"
mkdir -p "$REPO_COPY"
cp -R "$REPO/claude-agents" "$REPO/claude-skills" "$REPO/install-gauntlet.sh" "$REPO_COPY/"
CLAUDE_DIR="$SANDBOX/claude"
mkdir -p "$CLAUDE_DIR"
export CLAUDE_DIR
INSTALLER="$REPO_COPY/install-gauntlet.sh"
AGENTS=(gauntlet-builder gauntlet-critic gauntlet-judge)

echo "0. --check em diretório vazio não tem efeito colateral"
BEFORE="$(snapshot "$CLAUDE_DIR")"
check "--check sai 1 quando nada instalado" bash -c "! '$INSTALLER' --check"
check "nenhum arquivo criado pelo --check" test "$BEFORE" = "$(snapshot "$CLAUDE_DIR")"

echo "1. instalação limpa"
"$INSTALLER" >"$SANDBOX/out1.txt"
check "cria agents/" test -d "$CLAUDE_DIR/agents"
for agent in "${AGENTS[@]}"; do
  check "link $agent" test -L "$CLAUDE_DIR/agents/$agent.md"
  check "alvo $agent resolve" test -f "$CLAUDE_DIR/agents/$agent.md"
done
check "link da skill" test -L "$CLAUDE_DIR/skills/gauntlet"
check "SKILL.md acessível pelo link" test -f "$CLAUDE_DIR/skills/gauntlet/SKILL.md"
check "harness acessível pelo link" test -f "$CLAUDE_DIR/skills/gauntlet/scripts/gauntlet.mjs"
check "relata config lida do frontmatter" grep -q "gauntlet-judge.*model=opus" "$SANDBOX/out1.txt"
check "não hardcoda modelo do builder" grep -q "gauntlet-builder.*model=inherit" "$SANDBOX/out1.txt"

echo "2. idempotência"
"$INSTALLER" >"$SANDBOX/out2.txt"
check "segunda execução não altera nada" grep -q "Nada a fazer" "$SANDBOX/out2.txt"
check "todos [ok] (3 agentes + skill + harness)" test "$(grep -c '\[ok\]' "$SANDBOX/out2.txt")" -eq 5

echo "3. --check em estado consistente é side-effect free"
BEFORE="$(snapshot "$CLAUDE_DIR")"
check "--check sai 0" "$INSTALLER" --check
check "snapshot idêntico após --check" test "$BEFORE" = "$(snapshot "$CLAUDE_DIR")"

echo "4. arquivo real, diretório real e symlink alheio vão para backup (nunca rm)"
rm "$CLAUDE_DIR/agents/gauntlet-critic.md"
echo "meu agente antigo" >"$CLAUDE_DIR/agents/gauntlet-critic.md"
rm "$CLAUDE_DIR/skills/gauntlet"
mkdir -p "$CLAUDE_DIR/skills/gauntlet/references"
echo "skill copiada à mão" >"$CLAUDE_DIR/skills/gauntlet/SKILL.md"
echo "ref" >"$CLAUDE_DIR/skills/gauntlet/references/x.md"
mkdir -p "$SANDBOX/dotfiles"; echo "judge dos dotfiles" >"$SANDBOX/dotfiles/judge.md"
rm "$CLAUDE_DIR/agents/gauntlet-judge.md"
ln -s "$SANDBOX/dotfiles/judge.md" "$CLAUDE_DIR/agents/gauntlet-judge.md"
check "--check detecta divergências (sai 1)" bash -c "! '$INSTALLER' --check"
"$INSTALLER" >"$SANDBOX/out4.txt"
check "relink do arquivo real" test -L "$CLAUDE_DIR/agents/gauntlet-critic.md"
check "relink do diretório real" test -L "$CLAUDE_DIR/skills/gauntlet"
check "relink do symlink alheio" test "$(readlink "$CLAUDE_DIR/agents/gauntlet-judge.md")" = "$REPO_COPY/claude-agents/gauntlet-judge.md"
BACKUP1="$(ls -d "$CLAUDE_DIR"/.gauntlet-backup-* | tail -1)"
check "backup criado" test -d "$BACKUP1"
check "arquivo real preservado" grep -q "meu agente antigo" "$BACKUP1/agents/gauntlet-critic.md"
check "diretório real preservado com conteúdo" grep -q "ref" "$BACKUP1/skills/gauntlet/references/x.md"
check "symlink alheio preservado como link" test -L "$BACKUP1/agents/gauntlet-judge.md"
check "symlink alheio ainda aponta para os dotfiles" test "$(readlink "$BACKUP1/agents/gauntlet-judge.md")" = "$SANDBOX/dotfiles/judge.md"
check "dotfiles intocados" grep -q "judge dos dotfiles" "$SANDBOX/dotfiles/judge.md"

echo "5. link obsoleto (agente removido do repo) é limpo; link externo é preservado"
ln -s "$REPO_COPY/claude-agents/gauntlet-critic-a.md" "$CLAUDE_DIR/agents/gauntlet-critic-a.md"   # alvo não existe
ln -s "$SANDBOX/outro-repo/gauntlet-x.md" "$CLAUDE_DIR/agents/gauntlet-x.md"                       # fora do repo
check "--check detecta stale (sai 1)" bash -c "! '$INSTALLER' --check"
"$INSTALLER" >"$SANDBOX/out5.txt"
check "stale removido" test ! -L "$CLAUDE_DIR/agents/gauntlet-critic-a.md"
check "link de fora do repo intocado" test -L "$CLAUDE_DIR/agents/gauntlet-x.md"
rm "$CLAUDE_DIR/agents/gauntlet-x.md"

echo "6. segundo backup (outro arquivo real) para testar restauração de todos os backups"
sleep 1.1
rm "$CLAUDE_DIR/agents/gauntlet-builder.md"
echo "builder antigo" >"$CLAUDE_DIR/agents/gauntlet-builder.md"
"$INSTALLER" >"$SANDBOX/out6.txt"
check "dois diretórios de backup" test "$(ls -d "$CLAUDE_DIR"/.gauntlet-backup-* | wc -l)" -eq 2

echo "7. --uninstall remove os links e restaura TODOS os backups"
"$INSTALLER" --uninstall >"$SANDBOX/out7.txt"
for agent in "${AGENTS[@]}"; do
  check "link $agent não aponta mais para o repo" bash -c "! test -L '$CLAUDE_DIR/agents/$agent.md' || [[ \"\$(readlink '$CLAUDE_DIR/agents/$agent.md')\" != '$REPO_COPY'/* ]]"
done
check "nenhum symlink do repo restou em agents/" bash -c "! find '$CLAUDE_DIR/agents' -maxdepth 1 -type l -lname '$REPO_COPY/*' | grep -q ."
check "skill link removido" test ! -L "$CLAUDE_DIR/skills/gauntlet"
check "arquivo real restaurado (backup mais recente)" grep -q "builder antigo" "$CLAUDE_DIR/agents/gauntlet-builder.md"
check "arquivo real restaurado (backup mais antigo)" grep -q "meu agente antigo" "$CLAUDE_DIR/agents/gauntlet-critic.md"
check "restaurado não é symlink" test ! -L "$CLAUDE_DIR/agents/gauntlet-critic.md"
check "diretório real restaurado" grep -q "ref" "$CLAUDE_DIR/skills/gauntlet/references/x.md"
check "diretório restaurado não é symlink" test -d "$CLAUDE_DIR/skills/gauntlet" -a ! -L "$CLAUDE_DIR/skills/gauntlet"
check "symlink alheio restaurado" test "$(readlink "$CLAUDE_DIR/agents/gauntlet-judge.md")" = "$SANDBOX/dotfiles/judge.md"
check "todos os backups consumidos" bash -c "! ls -d '$CLAUDE_DIR'/.gauntlet-backup-* >/dev/null 2>&1"

echo "8. instalação após uninstall funciona e faz backup do restaurado"
"$INSTALLER" >"$SANDBOX/out8.txt"
check "reinstalado" test -L "$CLAUDE_DIR/agents/gauntlet-critic.md"
check "arquivo real foi para backup de novo" bash -c "ls -d '$CLAUDE_DIR'/.gauntlet-backup-* >/dev/null 2>&1"

echo "9. fallback de resolve_path sem readlink -f resolve symlink relativo a partir do diretório do link"
SHIM="$SANDBOX/shim"; mkdir -p "$SHIM"
printf '#!/bin/sh\n[ "$1" = "-f" ] && exit 1\nexec /usr/bin/readlink "$@"\n' >"$SHIM/readlink"; chmod +x "$SHIM/readlink"
rm "$CLAUDE_DIR/agents/gauntlet-builder.md"
( cd "$CLAUDE_DIR/agents" && ln -s "$(realpath --relative-to=. "$REPO_COPY/claude-agents/gauntlet-builder.md")" gauntlet-builder.md )
check "link relativo é reconhecido como [ok] a partir de /tmp" bash -c "cd /tmp && PATH='$SHIM:$PATH' '$INSTALLER' --check | grep -q '\[ok\] *gauntlet-builder.md'"
check "link relativo é reconhecido como [ok] a partir de um cwd profundo" bash -c "cd '$REPO_COPY/claude-skills/gauntlet/references' && PATH='$SHIM:$PATH' '$INSTALLER' --check | grep -q '\[ok\] *gauntlet-builder.md'"

echo "10. harness responde ATRAVÉS do link instalado (é assim que a skill o invoca)"
check "version pelo link" bash -c "node '$CLAUDE_DIR/skills/gauntlet/scripts/gauntlet.mjs' version | grep -q '^gauntlet-harness '"
check "erro de uso pelo link sai 2" bash -c "node '$CLAUDE_DIR/skills/gauntlet/scripts/gauntlet.mjs' frobnicate >/dev/null 2>&1; test \$? -eq 2"
check "--check relata o harness" bash -c "'$INSTALLER' --check | grep -q 'harness responde pelo link'"

echo "11. loop de symlink no destino não trava: vai para backup"
rm "$CLAUDE_DIR/agents/gauntlet-builder.md"
ln -s gauntlet-builder.md "$CLAUDE_DIR/agents/gauntlet-builder.md"
check "--check termina (sai 1) com loop" bash -c "! timeout 20 '$INSTALLER' --check"
check "instalação termina com loop" timeout 20 "$INSTALLER"
check "loop relinkado corretamente" test "$(readlink "$CLAUDE_DIR/agents/gauntlet-builder.md")" = "$REPO_COPY/claude-agents/gauntlet-builder.md"
check "loop preservado em backup" bash -c "find '$CLAUDE_DIR'/.gauntlet-backup-*/agents -name gauntlet-builder.md -type l | grep -q ."

echo "12. dois backups no mesmo segundo não colidem (shim de date constante)"
DSHIM="$SANDBOX/dshim"; mkdir -p "$DSHIM"
printf '#!/bin/sh\necho 20260101-000000\n' >"$DSHIM/date"; chmod +x "$DSHIM/date"
rm "$CLAUDE_DIR/agents/gauntlet-critic.md"; echo FIRST >"$CLAUDE_DIR/agents/gauntlet-critic.md"
PATH="$DSHIM:$PATH" "$INSTALLER" >/dev/null
rm "$CLAUDE_DIR/agents/gauntlet-critic.md"; echo SECOND >"$CLAUDE_DIR/agents/gauntlet-critic.md"
PATH="$DSHIM:$PATH" "$INSTALLER" >/dev/null
check "ambos os backups preservados" bash -c "grep -rlq FIRST '$CLAUDE_DIR'/.gauntlet-backup-* && grep -rlq SECOND '$CLAUDE_DIR'/.gauntlet-backup-*"

echo "13. link relativo para dentro do repo é reconhecido pelo --uninstall"
rm "$CLAUDE_DIR/agents/gauntlet-judge.md"
( cd "$CLAUDE_DIR/agents" && ln -s "$(realpath --relative-to=. "$REPO_COPY/claude-agents/gauntlet-judge.md")" gauntlet-judge.md )
check "--check aceita o link relativo" bash -c "'$INSTALLER' --check | grep -q '\[ok\] *gauntlet-judge.md'"
"$INSTALLER" --uninstall >"$SANDBOX/out13.txt"
check "--uninstall removeu o link relativo" bash -c "grep -q '\[removed\] gauntlet-judge.md' '$SANDBOX/out13.txt'"

echo "14. --check nunca executa um harness alheio: link da skill divergente é só relatado"
FOREIGN="$SANDBOX/foreign"; mkdir -p "$FOREIGN/scripts"
printf 'import{writeFileSync}from"node:fs";writeFileSync(process.env.FOREIGN_MARKER,"x");console.log("gauntlet-harness 9.9.9 evil")\n' >"$FOREIGN/scripts/gauntlet.mjs"
export FOREIGN_MARKER="$SANDBOX/MARKER_FOREIGN_CODE_RAN"
rm -rf "$CLAUDE_DIR/skills/gauntlet"; ln -s "$FOREIGN" "$CLAUDE_DIR/skills/gauntlet"
"$INSTALLER" --check >"$SANDBOX/out14.txt" 2>&1 || true
check "--check relata [DIFF] no link da skill" grep -q '\[DIFF\] *gauntlet ->' "$SANDBOX/out14.txt"
check "--check não certifica o harness alheio" bash -c "! grep -q 'harness responde' '$SANDBOX/out14.txt'"
check "--check avisa que o harness não foi verificado" grep -q 'harness não verificado' "$SANDBOX/out14.txt"
check "código alheio NÃO executou no --check" test ! -e "$FOREIGN_MARKER"
"$INSTALLER" >"$SANDBOX/out14b.txt"
check "instalação relinka a skill" test "$(readlink "$CLAUDE_DIR/skills/gauntlet")" = "$REPO_COPY/claude-skills/gauntlet"
check "código alheio NÃO executou na instalação" test ! -e "$FOREIGN_MARKER"
check "harness verificado pelo link correto" grep -q 'harness responde pelo link instalado: gauntlet-harness 2' "$SANDBOX/out14b.txt"
unset FOREIGN_MARKER

echo "15. CLAUDE_DIR sem permissão de escrita: erro claro, sem travar"
if [[ "$EUID" -eq 0 ]]; then
  # chmod 555 não bloqueia UID 0 (CAP_DAC_OVERRIDE): o cenário não é
  # reproduzível como root e é pulado explicitamente, não dado como passado.
  echo "  SKIP cenário de diretório sem permissão: executando como UID 0, chmod 555 não impede a escrita (só é exercido sem privilégio)"
  SKIPS=$((SKIPS + 1))
else
  RO="$SANDBOX/ro-claude"; mkdir -p "$RO/agents" "$RO/skills"; echo real >"$RO/agents/gauntlet-critic.md"; chmod 555 "$RO"
  set +e; CLAUDE_DIR="$RO" timeout 20 "$INSTALLER" >"$SANDBOX/out15.txt" 2>&1; RC=$?; set -e
  chmod 755 "$RO"
  check "termina (não 124) com erro" test "$RC" -ne 0 -a "$RC" -ne 124
  check "mensagem explica o backup" grep -q 'não foi possível criar o diretório de backup' "$SANDBOX/out15.txt"
  check "arquivo real intocado" grep -q real "$RO/agents/gauntlet-critic.md"
fi

echo "16. checkout acessado por caminho com symlink: stale e uninstall reconhecem os links"
ALIAS="$SANDBOX/alias"; ln -s "$REPO_COPY" "$ALIAS"
rm -f "$CLAUDE_DIR/agents/gauntlet-judge.md"
ln -s "$ALIAS/claude-agents/gauntlet-judge.md" "$CLAUDE_DIR/agents/gauntlet-judge.md"
ln -s "$ALIAS/claude-agents/gauntlet-critic-a.md" "$CLAUDE_DIR/agents/gauntlet-critic-a.md"   # agente removido, via alias
"$INSTALLER" --check >"$SANDBOX/out16.txt" 2>&1 || true
check "--check aceita o link via alias" grep -q '\[ok\] *gauntlet-judge.md' "$SANDBOX/out16.txt"
check "--check detecta stale via alias" grep -q '\[STALE\] *gauntlet-critic-a.md' "$SANDBOX/out16.txt"
"$INSTALLER" >/dev/null
check "stale via alias removido" test ! -L "$CLAUDE_DIR/agents/gauntlet-critic-a.md"
"$INSTALLER" --uninstall >"$SANDBOX/out16b.txt"
check "--uninstall removeu o link via alias" grep -q '\[removed\] gauntlet-judge.md' "$SANDBOX/out16b.txt"
"$INSTALLER" >/dev/null

echo "17. ~/.claude/agents e skills como symlinks de diretório para dentro do repo: destino é a própria fonte"
REPO_LINKED="$SANDBOX/repo-linked"; mkdir -p "$REPO_LINKED"
cp -R "$REPO/claude-agents" "$REPO/claude-skills" "$REPO/install-gauntlet.sh" "$REPO_LINKED/"
( cd "$REPO_LINKED" && git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init )
LINKED_CLAUDE="$SANDBOX/claude-linked"; mkdir -p "$LINKED_CLAUDE"
ln -s "$REPO_LINKED/claude-agents" "$LINKED_CLAUDE/agents"
ln -s "$REPO_LINKED/claude-skills" "$LINKED_CLAUDE/skills"
CLAUDE_DIR="$LINKED_CLAUDE" "$REPO_LINKED/install-gauntlet.sh" >"$SANDBOX/out17.txt" 2>&1
RC17=$?
check "instalação termina com sucesso" test "$RC17" -eq 0
check "agentes reconhecidos como a própria fonte" test "$(grep -c 'o destino já é a própria fonte' "$SANDBOX/out17.txt")" -eq 4
check "nenhum arquivo do repo foi movido ou apagado" bash -c "cd '$REPO_LINKED' && [ -z \"\$(git status --porcelain)\" ]"
check "claude-agents/ intacto (3 agentes)" test "$(ls "$REPO_LINKED"/claude-agents/gauntlet-*.md | wc -l)" -eq 3
check "SKILL.md legível (sem loop de symlink)" test -f "$REPO_LINKED/claude-skills/gauntlet/SKILL.md"
check "nenhum backup criado" bash -c "! ls -d '$LINKED_CLAUDE'/.gauntlet-backup-* >/dev/null 2>&1"
check "--check nesse layout sai 0" bash -c "CLAUDE_DIR='$LINKED_CLAUDE' '$REPO_LINKED/install-gauntlet.sh' --check >/dev/null"
( cd "$REPO_LINKED/claude-agents" && ln -s gauntlet-judge.md gauntlet-alias.md && git add -A && git -c user.email=t@t -c user.name=t commit -qm alias )
check "--uninstall nesse layout não apaga a fonte (nem um symlink dentro de claude-agents/)" bash -c "CLAUDE_DIR='$LINKED_CLAUDE' '$REPO_LINKED/install-gauntlet.sh' --uninstall >/dev/null && cd '$REPO_LINKED' && [ -z \"\$(git status --porcelain)\" ] && test -L claude-agents/gauntlet-alias.md"

echo "18. fonte incompleta: --check e instalação falham sem tocar nada; --uninstall ainda funciona"
REPO_BROKEN="$SANDBOX/repo-broken"; mkdir -p "$REPO_BROKEN/claude-agents"
cp -R "$REPO/claude-skills" "$REPO/install-gauntlet.sh" "$REPO_BROKEN/"
BROKEN_CLAUDE="$SANDBOX/claude-broken"; mkdir -p "$BROKEN_CLAUDE/agents" "$BROKEN_CLAUDE/skills"
check "--check falha sem agentes na fonte" bash -c "! CLAUDE_DIR='$BROKEN_CLAUDE' '$REPO_BROKEN/install-gauntlet.sh' --check >/dev/null 2>&1"
check "instalação falha sem agentes na fonte" bash -c "! CLAUDE_DIR='$BROKEN_CLAUDE' '$REPO_BROKEN/install-gauntlet.sh' >/dev/null 2>&1"
check "nada foi criado no destino" test -z "$(ls -A "$BROKEN_CLAUDE/agents")"
rm -rf "$REPO_BROKEN/claude-skills"
ln -s "$SANDBOX/somewhere-else/gauntlet" "$BROKEN_CLAUDE/skills/gauntlet"   # link alheio e quebrado
check "--uninstall funciona mesmo com a fonte da skill ausente" bash -c "CLAUDE_DIR='$BROKEN_CLAUDE' '$REPO_BROKEN/install-gauntlet.sh' --uninstall >'$SANDBOX/out18.txt' 2>&1"
check "--uninstall não remove um link alheio quebrado quando a fonte sumiu" test -L "$BROKEN_CLAUDE/skills/gauntlet"

echo "20. --uninstall nunca restaura um backup para dentro do repositório fonte (agents/ e skills/ como symlinks de diretório)"
REPO_GUARD="$SANDBOX/repo-guard"; mkdir -p "$REPO_GUARD"
cp -R "$REPO/claude-agents" "$REPO/claude-skills" "$REPO/install-gauntlet.sh" "$REPO_GUARD/"
( cd "$REPO_GUARD" && git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init )
GUARD_CLAUDE="$SANDBOX/claude-guard"; mkdir -p "$GUARD_CLAUDE"
ln -s "$REPO_GUARD/claude-agents" "$GUARD_CLAUDE/agents"
ln -s "$REPO_GUARD/claude-skills" "$GUARD_CLAUDE/skills"
# Backup antigo (de um layout anterior) com itens cujo destino hoje resolve para dentro do repo.
OLD_BACKUP="$GUARD_CLAUDE/.gauntlet-backup-20200101-000000"
mkdir -p "$OLD_BACKUP/agents" "$OLD_BACKUP/skills"
echo "agente antigo removido do repo" >"$OLD_BACKUP/agents/gauntlet-critic-a.md"
mkdir -p "$OLD_BACKUP/skills/outra-skill"; echo "skill antiga" >"$OLD_BACKUP/skills/outra-skill/SKILL.md"
CLAUDE_DIR="$GUARD_CLAUDE" "$REPO_GUARD/install-gauntlet.sh" --uninstall >"$SANDBOX/out20.txt" 2>&1
RC20=$?
check "--uninstall termina com sucesso" test "$RC20" -eq 0
check "nada foi escrito no repositório fonte" bash -c "cd '$REPO_GUARD' && [ -z \"\$(git status --porcelain --ignored)\" ]"
check "agente do backup não foi para claude-agents/ do repo" test ! -e "$REPO_GUARD/claude-agents/gauntlet-critic-a.md"
check "skill do backup não foi para claude-skills/ do repo" test ! -e "$REPO_GUARD/claude-skills/outra-skill"
check "itens permanecem no backup" bash -c "grep -q 'agente antigo' '$OLD_BACKUP/agents/gauntlet-critic-a.md' && grep -q 'skill antiga' '$OLD_BACKUP/skills/outra-skill/SKILL.md'"
check "saída explica que o destino resolve para o repo" grep -q 'resolve para dentro do repositório fonte' "$SANDBOX/out20.txt"
check "symlinks de diretório intactos" bash -c "[ -L '$GUARD_CLAUDE/agents' ] && [ -L '$GUARD_CLAUDE/skills' ]"
# Layout normal: o mesmo backup É restaurado (a regra só protege o repo, não bloqueia a restauração legítima).
NORMAL_CLAUDE="$SANDBOX/claude-normal"; mkdir -p "$NORMAL_CLAUDE/agents" "$NORMAL_CLAUDE/skills"
mv "$OLD_BACKUP" "$NORMAL_CLAUDE/"
CLAUDE_DIR="$NORMAL_CLAUDE" "$REPO_GUARD/install-gauntlet.sh" --uninstall >"$SANDBOX/out20b.txt" 2>&1 || true
check "no layout normal o backup é restaurado" bash -c "grep -q 'agente antigo' '$NORMAL_CLAUDE/agents/gauntlet-critic-a.md' && grep -q 'skill antiga' '$NORMAL_CLAUDE/skills/outra-skill/SKILL.md'"

echo "21. ~/.claude/skills ou agents apontando para OUTRO diretório dentro do repo: instalar recusa, --check relata, --uninstall não remove nada no repo"
REPO_IN="$SANDBOX/repo-in"; mkdir -p "$REPO_IN/skills/outra"
cp -R "$REPO/claude-agents" "$REPO/claude-skills" "$REPO/install-gauntlet.sh" "$REPO_IN/"; echo x >"$REPO_IN/skills/outra/SKILL.md"
( cd "$REPO_IN" && git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init )
IN_CLAUDE="$SANDBOX/claude-in"; mkdir -p "$IN_CLAUDE/agents"
echo "MEU CRITIC PESSOAL" >"$IN_CLAUDE/agents/gauntlet-critic.md"   # arquivo real do usuário: não pode ir para backup numa instalação recusada
ln -s "$REPO_IN/skills" "$IN_CLAUDE/skills"                       # skills compartilhadas do repo, não claude-skills/
check "instalação recusa (sai 1)" bash -c "! CLAUDE_DIR='$IN_CLAUDE' '$REPO_IN/install-gauntlet.sh' >'$SANDBOX/out21.txt' 2>&1"
check "mensagem explica o destino dentro do repo" grep -q 'resolve para dentro do repositório fonte' "$SANDBOX/out21.txt"
check "nada escrito no repo (skills/gauntlet não existe)" bash -c "cd '$REPO_IN' && [ -z \"\$(git status --porcelain --ignored)\" ] && [ ! -e skills/gauntlet ]"
check "recusa ANTES de escrever: nenhum link de agente criado" bash -c "! find '$IN_CLAUDE/agents' -maxdepth 1 -type l | grep -q ."
check "recusa ANTES de escrever: arquivo do usuário intacto, sem backup" bash -c "grep -q 'MEU CRITIC PESSOAL' '$IN_CLAUDE/agents/gauntlet-critic.md' && ! ls -d '$IN_CLAUDE'/.gauntlet-backup-* >/dev/null 2>&1"
rm "$IN_CLAUDE/agents/gauntlet-critic.md"
check "--check relata [REPO] e sai 1" bash -c "! CLAUDE_DIR='$IN_CLAUDE' '$REPO_IN/install-gauntlet.sh' --check 2>&1 | grep -q '\[REPO\]'; [ \${PIPESTATUS[0]} -ne 0 ]"
# Resíduo deixado por um instalador antigo dentro do repo: --uninstall não o remove.
ln -s "$REPO_IN/claude-skills/gauntlet" "$REPO_IN/skills/gauntlet"
CLAUDE_DIR="$IN_CLAUDE" "$REPO_IN/install-gauntlet.sh" --uninstall >"$SANDBOX/out21b.txt" 2>&1 || true
check "--uninstall não remove o resíduo dentro do repo" test -L "$REPO_IN/skills/gauntlet"
check "--uninstall avisa do resíduo" grep -q 'está dentro do repositório fonte' "$SANDBOX/out21b.txt"
rm "$REPO_IN/skills/gauntlet"
# agents -> raiz do repo
IN2_CLAUDE="$SANDBOX/claude-in2"; mkdir -p "$IN2_CLAUDE/skills"; ln -s "$REPO_IN" "$IN2_CLAUDE/agents"
check "agents -> raiz do repo: instalação recusa" bash -c "! CLAUDE_DIR='$IN2_CLAUDE' '$REPO_IN/install-gauntlet.sh' >/dev/null 2>&1"
check "nenhum gauntlet-*.md criado na raiz do repo" bash -c "cd '$REPO_IN' && [ -z \"\$(git status --porcelain --ignored)\" ]"
ln -s "$REPO_IN/claude-agents/gauntlet-critic-a.md" "$REPO_IN/gauntlet-critic-a.md"   # link stale dentro do repo
CLAUDE_DIR="$IN2_CLAUDE" "$REPO_IN/install-gauntlet.sh" --uninstall >/dev/null 2>&1 || true
CLAUDE_DIR="$IN2_CLAUDE" "$REPO_IN/install-gauntlet.sh" --check >/dev/null 2>&1 || true
check "link stale dentro do repo não é removido por uninstall nem por check" test -L "$REPO_IN/gauntlet-critic-a.md"
# CLAUDE_DIR dentro do próprio repo: recusa antes do mkdir; nada é criado.
mkdir -p "$REPO_IN/.claude-home"; touch "$REPO_IN/.claude-home/.keep"
( cd "$REPO_IN" && git add -A && git -c user.email=t@t -c user.name=t commit -qm home )
DIRS_BEFORE="$(find "$REPO_IN/.claude-home" -type d | wc -l)"
check "CLAUDE_DIR dentro do repo: instalação recusa" bash -c "! CLAUDE_DIR='$REPO_IN/.claude-home' '$REPO_IN/install-gauntlet.sh' >'$SANDBOX/out21c.txt' 2>&1"
check "CLAUDE_DIR dentro do repo: nenhum diretório criado" test "$(find "$REPO_IN/.claude-home" -type d | wc -l)" -eq "$DIRS_BEFORE"
check "CLAUDE_DIR dentro do repo: mensagem explica" grep -q 'CLAUDE_DIR .* resolve para dentro do repositório fonte' "$SANDBOX/out21c.txt"
# agents -> caminho inexistente dentro do repo (symlink pendente): recusa com explicação, não com erro cru do mkdir.
IN3_CLAUDE="$SANDBOX/claude-in3"; mkdir -p "$IN3_CLAUDE/skills"; ln -s "$REPO_IN/nonexistent" "$IN3_CLAUDE/agents"
check "agents pendente: instalação recusa com explicação" bash -c "! CLAUDE_DIR='$IN3_CLAUDE' '$REPO_IN/install-gauntlet.sh' >'$SANDBOX/out21d.txt' 2>&1 && grep -q 'symlink pendente' '$SANDBOX/out21d.txt' && ! grep -q 'mkdir:' '$SANDBOX/out21d.txt'"
check "agents pendente: nada criado no repo" bash -c "cd '$REPO_IN' && [ -z \"\$(git status --porcelain --ignored)\" ] && [ ! -e nonexistent ]"

echo "22. três backups no mesmo segundo: --uninstall restaura o mais novo primeiro e preserva os mais antigos"
REPO_SEQ="$SANDBOX/repo-seq"; mkdir -p "$REPO_SEQ"
cp -R "$REPO/claude-agents" "$REPO/claude-skills" "$REPO/install-gauntlet.sh" "$REPO_SEQ/"
SEQ_CLAUDE="$SANDBOX/claude-seq"; mkdir -p "$SEQ_CLAUDE/agents"
for content in OLD MIDDLE NEWEST; do
  rm -f "$SEQ_CLAUDE/agents/gauntlet-critic.md"; echo "$content" >"$SEQ_CLAUDE/agents/gauntlet-critic.md"
  CLAUDE_DIR="$SEQ_CLAUDE" PATH="$DSHIM:$PATH" "$REPO_SEQ/install-gauntlet.sh" >/dev/null
done
check "três backups com o mesmo timestamp base" test "$(ls -d "$SEQ_CLAUDE"/.gauntlet-backup-20260101-000000* | wc -l)" -eq 3
check "sufixos sequenciais (-01, -02), não aleatórios" bash -c "test -d '$SEQ_CLAUDE/.gauntlet-backup-20260101-000000' && test -d '$SEQ_CLAUDE/.gauntlet-backup-20260101-000000-01' && test -d '$SEQ_CLAUDE/.gauntlet-backup-20260101-000000-02'"
check "ordem lexical = ordem de criação" bash -c "grep -q OLD '$SEQ_CLAUDE/.gauntlet-backup-20260101-000000/agents/gauntlet-critic.md' && grep -q MIDDLE '$SEQ_CLAUDE/.gauntlet-backup-20260101-000000-01/agents/gauntlet-critic.md' && grep -q NEWEST '$SEQ_CLAUDE/.gauntlet-backup-20260101-000000-02/agents/gauntlet-critic.md'"
CLAUDE_DIR="$SEQ_CLAUDE" "$REPO_SEQ/install-gauntlet.sh" --uninstall >"$SANDBOX/out22.txt" 2>&1 || true
check "o backup mais novo é restaurado" grep -q NEWEST "$SEQ_CLAUDE/agents/gauntlet-critic.md"
check "o mais novo foi restaurado primeiro (log)" bash -c "grep -n 'restored\] agents/gauntlet-critic.md' '$SANDBOX/out22.txt' | grep -q 'de .gauntlet-backup-20260101-000000-02'"
check "backups mais antigos preservados (destino ocupado)" bash -c "grep -q OLD '$SEQ_CLAUDE/.gauntlet-backup-20260101-000000/agents/gauntlet-critic.md' && grep -q MIDDLE '$SEQ_CLAUDE/.gauntlet-backup-20260101-000000-01/agents/gauntlet-critic.md'"
check "backup mais novo consumido" test ! -d "$SEQ_CLAUDE/.gauntlet-backup-20260101-000000-02"
# Esquema antigo (sufixo aleatório) já presente no mesmo segundo: o novo backup fica depois dele e é restaurado antes.
rm -rf "$SEQ_CLAUDE"/.gauntlet-backup-*; mkdir -p "$SEQ_CLAUDE/.gauntlet-backup-20260101-000000-4711/agents"
echo LEGACY >"$SEQ_CLAUDE/.gauntlet-backup-20260101-000000-4711/agents/gauntlet-critic.md"
CLAUDE_DIR="$SEQ_CLAUDE" PATH="$DSHIM:$PATH" "$REPO_SEQ/install-gauntlet.sh" >/dev/null   # NEWEST (restaurado acima) vai para backup
check "novo backup recebe max(sufixo)+1 e fica depois do legado" grep -q NEWEST "$SEQ_CLAUDE/.gauntlet-backup-20260101-000000-4712/agents/gauntlet-critic.md"
CLAUDE_DIR="$SEQ_CLAUDE" "$REPO_SEQ/install-gauntlet.sh" --uninstall >/dev/null 2>&1 || true
check "o mais novo é restaurado antes do legado; o legado permanece" bash -c "grep -q NEWEST '$SEQ_CLAUDE/agents/gauntlet-critic.md' && grep -q LEGACY '$SEQ_CLAUDE/.gauntlet-backup-20260101-000000-4711/agents/gauntlet-critic.md'"

echo "23. node presente mas incapaz de rodar o harness: a instalação sai != 0 e não se anuncia concluída"
BROKEN_CLAUDE="$SANDBOX/claude-broken"; mkdir -p "$BROKEN_CLAUDE"
NSHIM="$SANDBOX/nshim"; mkdir -p "$NSHIM"
printf '#!/bin/sh\nexit 1\n' >"$NSHIM/node"; chmod +x "$NSHIM/node"
set +e
CLAUDE_DIR="$BROKEN_CLAUDE" PATH="$NSHIM:$PATH" "$INSTALLER" >"$SANDBOX/out23.txt" 2>&1
BROKEN_EXIT=$?
set -e
check "instalação com harness quebrado sai != 0" test "$BROKEN_EXIT" -ne 0
check "a saída aponta o [BROKEN]" grep -q '\[BROKEN\]' "$SANDBOX/out23.txt"
check "não diz \"Instalação concluída\"" bash -c "! grep -q 'Instalação concluída' '$SANDBOX/out23.txt'"
check "com um node funcional a mesma instalação se completa e sai 0" bash -c "CLAUDE_DIR='$BROKEN_CLAUDE' '$INSTALLER' >/dev/null 2>&1"

echo "24. link da skill correto mas sem o ponto de entrada do harness: [BROKEN] na instalação e no --check, sem o [skip] falso"
REPO_NOH="$SANDBOX/repo-noh"; mkdir -p "$REPO_NOH"
cp -R "$REPO/claude-agents" "$REPO/claude-skills" "$REPO/install-gauntlet.sh" "$REPO_NOH/"
rm "$REPO_NOH/claude-skills/gauntlet/scripts/gauntlet.mjs"
NOH_CLAUDE="$SANDBOX/claude-noh"; mkdir -p "$NOH_CLAUDE"
set +e
CLAUDE_DIR="$NOH_CLAUDE" "$REPO_NOH/install-gauntlet.sh" >"$SANDBOX/out24.txt" 2>&1; RC24=$?
CLAUDE_DIR="$NOH_CLAUDE" "$REPO_NOH/install-gauntlet.sh" --check >"$SANDBOX/out24b.txt" 2>&1; RC24B=$?
set -e
check "instalação sai 1 e se declara incompleta" bash -c "test $RC24 -eq 1 && grep -q 'Instalação incompleta' '$SANDBOX/out24.txt' && ! grep -q 'Instalação concluída' '$SANDBOX/out24.txt'"
check "instalação aponta o [BROKEN] do harness ausente" grep -q '\[BROKEN\] *harness ausente' "$SANDBOX/out24.txt"
check "--check sai 1: link da skill [ok], harness [BROKEN]" bash -c "test $RC24B -eq 1 && grep -q '\[ok\] *gauntlet\$' '$SANDBOX/out24b.txt' && grep -q '\[BROKEN\] *harness ausente' '$SANDBOX/out24b.txt'"
check "--check não alega que o link da skill não aponta para este repo" bash -c "! grep -q 'não aponta para este repo' '$SANDBOX/out24b.txt'"
ln -s "$SANDBOX/harness-sumiu.mjs" "$REPO_NOH/claude-skills/gauntlet/scripts/gauntlet.mjs"   # ponto de entrada como link pendente
check "ponto de entrada como link pendente: --check sai 1 com [BROKEN]" bash -c "CLAUDE_DIR='$NOH_CLAUDE' '$REPO_NOH/install-gauntlet.sh' --check >'$SANDBOX/out24c.txt' 2>&1; test \$? -eq 1 && grep -q '\[BROKEN\] *harness ausente' '$SANDBOX/out24c.txt'"

echo "25. --uninstall só poda um backup do qual nada ficou retido ([kept])"
PRUNE_CLAUDE="$SANDBOX/claude-prune"; mkdir -p "$PRUNE_CLAUDE/agents" "$PRUNE_CLAUDE/skills/gauntlet"
echo "skill do usuário" >"$PRUNE_CLAUDE/skills/gauntlet/SKILL.md"   # destino ocupado por diretório real
PRUNE_OLD="$PRUNE_CLAUDE/.gauntlet-backup-20200101-000000"           # item [kept] feito só de diretórios
mkdir -p "$PRUNE_OLD/skills/gauntlet/references/vazio"
PRUNE_MID="$PRUNE_CLAUDE/.gauntlet-backup-20200102-000000"           # item [kept] com arquivo e subdiretório vazio
mkdir -p "$PRUNE_MID/skills/gauntlet/references/vazio"; echo "skill antiga" >"$PRUNE_MID/skills/gauntlet/SKILL.md"
CLAUDE_DIR="$PRUNE_CLAUDE" "$INSTALLER" --uninstall >"$SANDBOX/out25.txt" 2>&1
check "subdiretório vazio de um item [kept] continua no backup" test -d "$PRUNE_MID/skills/gauntlet/references/vazio"
check "item [kept] feito só de diretórios continua no backup" test -d "$PRUNE_OLD/skills/gauntlet/references/vazio"
check "backup com item [kept] não é anunciado como consumido" bash -c "! grep -q 'consumido e removido' '$SANDBOX/out25.txt'"

echo "26. checkout movido (instalação anterior feita por ESTE instalador: o manifesto a prova): links pendentes dela são trocados sem backup; --uninstall não os ressuscita"
MOVED_CLAUDE="$SANDBOX/claude-moved"; mkdir -p "$MOVED_CLAUDE"
REPO_BEFORE="$SANDBOX/repo-before-move"; mkdir -p "$REPO_BEFORE"
cp -R "$REPO/claude-agents" "$REPO/claude-skills" "$REPO/install-gauntlet.sh" "$REPO_BEFORE/"
CLAUDE_DIR="$MOVED_CLAUDE" "$REPO_BEFORE/install-gauntlet.sh" >/dev/null
check "a instalação anterior gravou o manifesto" test -f "$MOVED_CLAUDE/.gauntlet-install-manifest"
rm "$MOVED_CLAUDE/agents/gauntlet-builder.md"   # builder como link relativo para o mesmo alvo (cobre link_target_abs)
( cd "$MOVED_CLAUDE/agents" && ln -s "$(realpath --relative-to=. "$REPO_BEFORE/claude-agents/gauntlet-builder.md")" gauntlet-builder.md )
REPO_AFTER="$SANDBOX/repo-after-move"; mv "$REPO_BEFORE" "$REPO_AFTER"
# Pendentes mas NÃO provados pelo manifesto (alvo diferente do registrado): continuam indo para backup.
rm "$MOVED_CLAUDE/agents/gauntlet-critic.md" "$MOVED_CLAUDE/agents/gauntlet-judge.md"
ln -s "$SANDBOX/dotfiles-sumiu/gauntlet-critic.md" "$MOVED_CLAUDE/agents/gauntlet-critic.md"      # diretório não é claude-agents/
ln -s "$REPO_BEFORE/claude-agents/gauntlet-critic.md" "$MOVED_CLAUDE/agents/gauntlet-judge.md"    # nome diferente do destino
BEFORE="$(snapshot "$MOVED_CLAUDE")"
set +e; CLAUDE_DIR="$MOVED_CLAUDE" "$REPO_AFTER/install-gauntlet.sh" --check >"$SANDBOX/out26.txt" 2>&1; RC26=$?; set -e
SAME26=no; [[ "$BEFORE" == "$(snapshot "$MOVED_CLAUDE")" ]] && SAME26=yes
check "--check relata os 2 links pendentes da instalação anterior (builder e skill), sai 1, sem alterar nada" bash -c "test $RC26 -eq 1 && test '$SAME26' = yes && test \"\$(grep -c 'link pendente de uma instalação anterior' '$SANDBOX/out26.txt')\" -eq 2"
CLAUDE_DIR="$MOVED_CLAUDE" "$REPO_AFTER/install-gauntlet.sh" >"$SANDBOX/out26b.txt" 2>&1
MOVED_BACKUP="$(ls -d "$MOVED_CLAUDE"/.gauntlet-backup-* | tail -1)"
check "instalação relinka para o checkout novo e só os links alheios vão para backup" bash -c "test \"\$(readlink '$MOVED_CLAUDE/agents/gauntlet-builder.md')\" = '$REPO_AFTER/claude-agents/gauntlet-builder.md' && test \"\$(readlink '$MOVED_CLAUDE/skills/gauntlet')\" = '$REPO_AFTER/claude-skills/gauntlet' && test \"\$(cd '$MOVED_BACKUP' && find . -mindepth 2 | LC_ALL=C sort | paste -sd' ')\" = './agents/gauntlet-critic.md ./agents/gauntlet-judge.md'"
check "instalação relata a remoção sem backup" bash -c "grep -q '\[stale\] *gauntlet-builder.md .*sem backup' '$SANDBOX/out26b.txt' && grep -q '\[stale\] *gauntlet .*sem backup' '$SANDBOX/out26b.txt'"
CLAUDE_DIR="$MOVED_CLAUDE" "$REPO_AFTER/install-gauntlet.sh" --uninstall >"$SANDBOX/out26c.txt" 2>&1
check "--uninstall não ressuscita os links da instalação anterior (só restaura os alheios)" bash -c "! test -L '$MOVED_CLAUDE/agents/gauntlet-builder.md' && ! test -L '$MOVED_CLAUDE/skills/gauntlet' && test \"\$(readlink '$MOVED_CLAUDE/agents/gauntlet-critic.md')\" = '$SANDBOX/dotfiles-sumiu/gauntlet-critic.md'"

echo "27. --uninstall com agents/ como symlink pendente: o item fica no backup ([kept]), o resto é restaurado, sai 0"
PEND_CLAUDE="$SANDBOX/claude-pend"; mkdir -p "$PEND_CLAUDE/skills"
PEND_BACKUP="$PEND_CLAUDE/.gauntlet-backup-20200101-000000"
mkdir -p "$PEND_BACKUP/agents/gauntlet-extra/vazio" "$PEND_BACKUP/skills/gauntlet"
echo "critic antigo" >"$PEND_BACKUP/agents/gauntlet-critic.md"; echo "skill antiga" >"$PEND_BACKUP/skills/gauntlet/SKILL.md"
ln -s "$SANDBOX/dotfiles-pendente/agents" "$PEND_CLAUDE/agents"
set +e; CLAUDE_DIR="$PEND_CLAUDE" "$INSTALLER" --uninstall >"$SANDBOX/out27.txt" 2>&1; RC27=$?; set -e
check "--uninstall sai 0, sem o erro cru do mkdir" bash -c "test $RC27 -eq 0 && ! grep -q 'mkdir:' '$SANDBOX/out27.txt'"
check "o item fica no backup com [kept] explicando o symlink quebrado" bash -c "grep -q '\[kept\] *agents/gauntlet-critic.md .*symlink quebrado' '$SANDBOX/out27.txt' && grep -q 'critic antigo' '$PEND_BACKUP/agents/gauntlet-critic.md'"
check "a desinstalação continua: o restante do backup é restaurado" bash -c "test $RC27 -eq 0 && grep -q 'skill antiga' '$PEND_CLAUDE/skills/gauntlet/SKILL.md'"
check "o backup com item retido não é podado" bash -c "test $RC27 -eq 0 && test -d '$PEND_BACKUP/agents/gauntlet-extra/vazio'"

echo "28. link pendente do USUÁRIO com alvo parecido (…/claude-agents/<nome>, …/claude-skills/gauntlet), nunca criado pelo instalador: vai para backup (nunca rm) e --uninstall o restaura"
USR_CLAUDE="$SANDBOX/claude-user-dangling"; mkdir -p "$USR_CLAUDE/agents" "$USR_CLAUDE/skills"
OFFLINE="$SANDBOX/dotfiles-offline"   # checkout de dotfiles desmontado/indisponível: o caminho não existe
ln -s "$OFFLINE/claude-agents/gauntlet-critic.md" "$USR_CLAUDE/agents/gauntlet-critic.md"
ln -s "$OFFLINE/claude-skills/gauntlet" "$USR_CLAUDE/skills/gauntlet"
set +e; CLAUDE_DIR="$USR_CLAUDE" "$INSTALLER" --check >"$SANDBOX/out28.txt" 2>&1; RC28=$?; set -e
check "--check relata [DIFF] comum (sem 'instalação anterior') para os dois links e sai 1" bash -c "test $RC28 -eq 1 && grep -q '\[DIFF\] *gauntlet-critic.md -> .*(esperado: ' '$SANDBOX/out28.txt' && grep -q '\[DIFF\] *gauntlet -> .*(esperado: ' '$SANDBOX/out28.txt' && ! grep -q 'instalação anterior' '$SANDBOX/out28.txt'"
CLAUDE_DIR="$USR_CLAUDE" "$INSTALLER" >"$SANDBOX/out28b.txt" 2>&1
USR_BACKUP="$(ls -d "$USR_CLAUDE"/.gauntlet-backup-* 2>/dev/null | tail -1 || true)"
check "os dois links do usuário vão para backup intactos; nada é removido sem backup" bash -c "test -n '$USR_BACKUP' && test \"\$(readlink '$USR_BACKUP/agents/gauntlet-critic.md')\" = '$OFFLINE/claude-agents/gauntlet-critic.md' && test \"\$(readlink '$USR_BACKUP/skills/gauntlet')\" = '$OFFLINE/claude-skills/gauntlet' && ! grep -q 'sem backup' '$SANDBOX/out28b.txt'"
check "a instalação relinka os dois destinos para a fonte" bash -c "test \"\$(readlink '$USR_CLAUDE/agents/gauntlet-critic.md')\" = '$REPO_COPY/claude-agents/gauntlet-critic.md' && test \"\$(readlink '$USR_CLAUDE/skills/gauntlet')\" = '$REPO_COPY/claude-skills/gauntlet'"
# Com o manifesto já presente, um link pendente do usuário cujo alvo não é o registrado também vai para backup.
rm "$USR_CLAUDE/agents/gauntlet-judge.md"; ln -s "$OFFLINE/claude-agents/gauntlet-judge.md" "$USR_CLAUDE/agents/gauntlet-judge.md"
CLAUDE_DIR="$USR_CLAUDE" "$INSTALLER" >"$SANDBOX/out28c.txt" 2>&1
check "com manifesto presente: alvo diferente do registrado vai para backup" bash -c "grep -q '\[backup\] *gauntlet-judge.md' '$SANDBOX/out28c.txt' && ! grep -q 'sem backup' '$SANDBOX/out28c.txt' && find '$USR_CLAUDE' -path '*/.gauntlet-backup-*/agents/gauntlet-judge.md' -type l -lname '$OFFLINE/claude-agents/gauntlet-judge.md' | grep -q ."
CLAUDE_DIR="$USR_CLAUDE" "$INSTALLER" --uninstall >"$SANDBOX/out28d.txt" 2>&1
check "--uninstall restaura os três links do usuário exatamente como eram" bash -c "test \"\$(readlink '$USR_CLAUDE/agents/gauntlet-critic.md')\" = '$OFFLINE/claude-agents/gauntlet-critic.md' && test \"\$(readlink '$USR_CLAUDE/agents/gauntlet-judge.md')\" = '$OFFLINE/claude-agents/gauntlet-judge.md' && test \"\$(readlink '$USR_CLAUDE/skills/gauntlet')\" = '$OFFLINE/claude-skills/gauntlet'"
check "--uninstall consome os backups e apaga o manifesto" bash -c "! ls -d '$USR_CLAUDE'/.gauntlet-backup-* >/dev/null 2>&1 && test ! -e '$USR_CLAUDE/.gauntlet-install-manifest'"

echo "29. checkout movido, instalado por ESTE instalador: o manifesto prova os links pendentes — trocados sem backup; --uninstall não deixa link pendente"
MAN_CLAUDE="$SANDBOX/claude-manifest"; mkdir -p "$MAN_CLAUDE"
MANIFEST29="$MAN_CLAUDE/.gauntlet-install-manifest"
MAN_V1="$SANDBOX/repo-man-v1"; mkdir -p "$MAN_V1"
cp -R "$REPO/claude-agents" "$REPO/claude-skills" "$REPO/install-gauntlet.sh" "$MAN_V1/"
cp "$MAN_V1/claude-agents/gauntlet-judge.md" "$MAN_V1/claude-agents/gauntlet-extra.md"   # agente que a versão seguinte remove
CLAUDE_DIR="$MAN_CLAUDE" "$MAN_V1/install-gauntlet.sh" >/dev/null
EXPECTED29="$(printf 'agents/gauntlet-%s.md\t%s/claude-agents/gauntlet-%s.md\n' builder "$MAN_V1" builder critic "$MAN_V1" critic extra "$MAN_V1" extra judge "$MAN_V1" judge; printf 'skills/gauntlet\t%s/claude-skills/gauntlet\n' "$MAN_V1")"
check "o manifesto registra cada link criado (destino relativo a CLAUDE_DIR, alvo absoluto)" test "$(LC_ALL=C sort "$MANIFEST29" 2>/dev/null)" = "$EXPECTED29"
MAN_V2="$SANDBOX/repo-man-v2"; mv "$MAN_V1" "$MAN_V2"; rm "$MAN_V2/claude-agents/gauntlet-extra.md"
cp "$MANIFEST29" "$SANDBOX/manifest29.before" 2>/dev/null || true
BEFORE="$(snapshot "$MAN_CLAUDE")"
set +e; CLAUDE_DIR="$MAN_CLAUDE" "$MAN_V2/install-gauntlet.sh" --check >"$SANDBOX/out29.txt" 2>&1; RC29=$?; set -e
SAME29=no; [[ "$BEFORE" == "$(snapshot "$MAN_CLAUDE")" ]] && SAME29=yes
check "--check: 4 [DIFF] provados pelo manifesto + [STALE] do agente removido, sai 1, sem alterar nada (nem o manifesto)" bash -c "test $RC29 -eq 1 && test '$SAME29' = yes && cmp -s '$MANIFEST29' '$SANDBOX/manifest29.before' && test \"\$(grep -c '\[DIFF\].*link pendente de uma instalação anterior, registrado no manifesto' '$SANDBOX/out29.txt')\" -eq 4 && grep -q '\[STALE\] *gauntlet-extra.md' '$SANDBOX/out29.txt'"
CLAUDE_DIR="$MAN_CLAUDE" "$MAN_V2/install-gauntlet.sh" >"$SANDBOX/out29b.txt" 2>&1
check "instalação troca os 4 links sem backup e limpa o do agente removido; nenhum backup criado" bash -c "test \"\$(grep -c '\[stale\].*sem backup' '$SANDBOX/out29b.txt')\" -eq 4 && grep -q '\[stale\] *gauntlet-extra.md removido' '$SANDBOX/out29b.txt' && ! test -L '$MAN_CLAUDE/agents/gauntlet-extra.md' && ! ls -d '$MAN_CLAUDE'/.gauntlet-backup-* >/dev/null 2>&1"
RELINKED29=yes
for agent in "${AGENTS[@]}"; do [[ "$(readlink "$MAN_CLAUDE/agents/$agent.md" || true)" == "$MAN_V2/claude-agents/$agent.md" ]] || RELINKED29=no; done
[[ "$(readlink "$MAN_CLAUDE/skills/gauntlet" || true)" == "$MAN_V2/claude-skills/gauntlet" ]] || RELINKED29=no
check "relinkado para o checkout novo" test "$RELINKED29" = yes
EXPECTED29="$(printf 'agents/gauntlet-%s.md\t%s/claude-agents/gauntlet-%s.md\n' builder "$MAN_V2" builder critic "$MAN_V2" critic judge "$MAN_V2" judge; printf 'skills/gauntlet\t%s/claude-skills/gauntlet\n' "$MAN_V2")"
check "manifesto atualizado: alvos do checkout novo, sem a entrada do link removido" test "$(LC_ALL=C sort "$MANIFEST29" 2>/dev/null)" = "$EXPECTED29"
CLAUDE_DIR="$MAN_CLAUDE" "$MAN_V2/install-gauntlet.sh" --uninstall >"$SANDBOX/out29c.txt" 2>&1
check "--uninstall não deixa link do Gauntlet (pendente ou não), backup nem manifesto" bash -c "! find '$MAN_CLAUDE' -type l | grep -q . && ! ls -d '$MAN_CLAUDE'/.gauntlet-backup-* >/dev/null 2>&1 && test ! -e '$MANIFEST29'"
# Checkout movido de novo e --uninstall direto, sem reinstalar: os links pendentes provados também saem.
CLAUDE_DIR="$MAN_CLAUDE" "$MAN_V2/install-gauntlet.sh" >/dev/null
MAN_V3="$SANDBOX/repo-man-v3"; mv "$MAN_V2" "$MAN_V3"
CLAUDE_DIR="$MAN_CLAUDE" "$MAN_V3/install-gauntlet.sh" --uninstall >"$SANDBOX/out29d.txt" 2>&1
check "--uninstall a partir do checkout movido remove os próprios links pendentes (manifesto) e o manifesto" bash -c "test \"\$(grep -c '\[removed\].*registrado no manifesto' '$SANDBOX/out29d.txt')\" -eq 4 && ! find '$MAN_CLAUDE' -type l | grep -q . && test ! -e '$MANIFEST29'"

echo "30. checkout movido, instalado por um instalador ANTIGO (sem manifesto): nada prova os links pendentes — vão para backup, nunca rm"
OLDI_CLAUDE="$SANDBOX/claude-old-installer"; mkdir -p "$OLDI_CLAUDE"
OLDI_V1="$SANDBOX/repo-oldi-v1"; mkdir -p "$OLDI_V1"
cp -R "$REPO/claude-agents" "$REPO/claude-skills" "$REPO/install-gauntlet.sh" "$OLDI_V1/"
CLAUDE_DIR="$OLDI_CLAUDE" "$OLDI_V1/install-gauntlet.sh" >/dev/null
rm -f "$OLDI_CLAUDE/.gauntlet-install-manifest"   # o instalador antigo não gravava manifesto
OLDI_V2="$SANDBOX/repo-oldi-v2"; mv "$OLDI_V1" "$OLDI_V2"
set +e; CLAUDE_DIR="$OLDI_CLAUDE" "$OLDI_V2/install-gauntlet.sh" --check >"$SANDBOX/out30.txt" 2>&1; RC30=$?; set -e
check "--check relata 4 [DIFF] comuns (sem 'instalação anterior') e sai 1" bash -c "test $RC30 -eq 1 && test \"\$(grep -c '\[DIFF\].*(esperado: ' '$SANDBOX/out30.txt')\" -eq 4 && ! grep -q 'instalação anterior' '$SANDBOX/out30.txt'"
CLAUDE_DIR="$OLDI_CLAUDE" "$OLDI_V2/install-gauntlet.sh" >"$SANDBOX/out30b.txt" 2>&1
OLDI_BACKUP="$(ls -d "$OLDI_CLAUDE"/.gauntlet-backup-* 2>/dev/null | tail -1 || true)"
check "os 4 links pendentes vão para backup como links; nada removido sem backup" bash -c "test -n '$OLDI_BACKUP' && test \"\$(cd '$OLDI_BACKUP' && find . -mindepth 2 -type l | LC_ALL=C sort | paste -sd' ')\" = './agents/gauntlet-builder.md ./agents/gauntlet-critic.md ./agents/gauntlet-judge.md ./skills/gauntlet' && ! grep -q 'sem backup' '$SANDBOX/out30b.txt'"
check "relinkado para o checkout novo; a partir daqui o manifesto existe" bash -c "test \"\$(readlink '$OLDI_CLAUDE/skills/gauntlet')\" = '$OLDI_V2/claude-skills/gauntlet' && test -f '$OLDI_CLAUDE/.gauntlet-install-manifest'"
CLAUDE_DIR="$OLDI_CLAUDE" "$OLDI_V2/install-gauntlet.sh" --uninstall >"$SANDBOX/out30c.txt" 2>&1
check "--uninstall devolve os links antigos do backup (custo da direção segura) e apaga o manifesto" bash -c "test \"\$(readlink '$OLDI_CLAUDE/agents/gauntlet-critic.md')\" = '$OLDI_V1/claude-agents/gauntlet-critic.md' && test ! -e '$OLDI_CLAUDE/.gauntlet-install-manifest'"

echo "31. --check nunca grava o manifesto (nem cria, nem atualiza, nem deixa temporário)"
CHK_CLAUDE="$SANDBOX/claude-check-manifest"; mkdir -p "$CHK_CLAUDE"
CHK_MANIFEST="$CHK_CLAUDE/.gauntlet-install-manifest"
TAB=$'\t'
CLAUDE_DIR="$CHK_CLAUDE" "$INSTALLER" --check >/dev/null 2>&1 || true
check "--check em diretório vazio não cria o manifesto" test ! -e "$CHK_MANIFEST"
CLAUDE_DIR="$CHK_CLAUDE" "$INSTALLER" >/dev/null
rm -f "$CHK_MANIFEST"   # como se a instalação tivesse sido feita por um instalador antigo
check "--check numa instalação sem manifesto sai 0 e não o cria" bash -c "CLAUDE_DIR='$CHK_CLAUDE' '$INSTALLER' --check >/dev/null 2>&1 && test ! -e '$CHK_MANIFEST'"
printf 'agents/gauntlet-critic.md\t/outro/checkout/claude-agents/gauntlet-critic.md\n' >"$CHK_MANIFEST"   # divergente: a instalação o reescreveria
cp "$CHK_MANIFEST" "$SANDBOX/manifest31.before"
CLAUDE_DIR="$CHK_CLAUDE" "$INSTALLER" --check >/dev/null 2>&1 || true
check "--check não reescreve um manifesto divergente" cmp -s "$CHK_MANIFEST" "$SANDBOX/manifest31.before"
check "--check não deixa arquivo temporário do manifesto" bash -c "! ls -A '$CHK_CLAUDE' | grep -q '^\.gauntlet-install-manifest\.'"
CLAUDE_DIR="$CHK_CLAUDE" "$INSTALLER" >/dev/null
check "a instalação corrige o manifesto: registra os 4 links [ok] e descarta a entrada falsa" bash -c "test \"\$(grep -c '$TAB$REPO_COPY/' '$CHK_MANIFEST')\" -eq 4 && ! grep -q '/outro/checkout/' '$CHK_MANIFEST'"

echo "19. sintaxe dos scripts shell"
check "bash -n install-gauntlet.sh" bash -n "$REPO/install-gauntlet.sh"
check "bash -n install.sh" bash -n "$REPO/install.sh"
check "bash -n uninstall.sh" bash -n "$REPO/uninstall.sh"

echo
if [[ "$FAILURES" -eq 0 ]]; then echo "install.test.sh: todos os checks passaram ($SKIPS cenário(s) pulado(s) por ambiente)"; else echo "install.test.sh: $FAILURES check(s) falharam ($SKIPS pulado(s))"; exit 1; fi
