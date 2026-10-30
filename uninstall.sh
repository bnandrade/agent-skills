#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# uninstall.sh — Remove os symlinks e restaura backups, em cada
# agente onde as skills foram instaladas (Claude e/ou Codex).
# ============================================================

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_SRC="$REPO_DIR/skills"

if [[ ! -d "$SKILLS_SRC" ]]; then
  echo "Erro: pasta skills/ nao encontrada em $REPO_DIR"
  exit 1
fi

DESTS=()
[[ -d "$HOME/.claude/skills" ]] && DESTS+=("$HOME/.claude/skills")
[[ -d "$HOME/.codex/skills" ]]  && DESTS+=("$HOME/.codex/skills")

uninstall_from() {
  local dst="$1"
  echo "==> Removendo de: $dst"

  # Backup mais recente neste destino
  local latest_backup=""
  for d in "$dst"/.backup-*/; do
    [[ -d "$d" ]] && latest_backup="$d"
  done

  for skill_dir in "$SKILLS_SRC"/*/; do
    local skill_name target
    skill_name="$(basename "$skill_dir")"
    target="$dst/$skill_name"

    if [[ -L "$target" ]]; then
      rm "$target"
      echo "  [removed] $skill_name"
      if [[ -n "$latest_backup" && -d "$latest_backup/$skill_name" ]]; then
        mv "$latest_backup/$skill_name" "$target"
        echo "  [restored] $skill_name (do backup)"
      fi
    else
      echo "  [skip] $skill_name (nao e symlink)"
    fi
  done

  if [[ -n "$latest_backup" && -d "$latest_backup" ]]; then
    rmdir "$latest_backup" 2>/dev/null && echo "  Backup removido (estava vazio)." || true
  fi
  echo ""
}

if [[ ${#DESTS[@]} -eq 0 ]]; then
  echo "Nada a remover (nenhum destino encontrado)."
  exit 0
fi

echo "Removendo symlinks..."
echo ""

for dst in "${DESTS[@]}"; do
  uninstall_from "$dst"
done

echo "Desinstalacao concluida!"
