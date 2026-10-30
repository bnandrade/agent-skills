#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# install.sh — Cria symlinks das skills do repo para os agentes
# instalados. Sincroniza Claude Code (~/.claude/skills) e, se
# presente, Codex (~/.codex/skills), num unico comando.
# ============================================================

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_SRC="$REPO_DIR/skills"

if [[ ! -d "$SKILLS_SRC" ]]; then
  echo "Erro: pasta skills/ não encontrada em $REPO_DIR"
  exit 1
fi

# Destinos: instala em cada agente cujo diretorio base existe.
# ~/.claude sempre; ~/.codex apenas se o Codex estiver instalado.
DESTS=()
[[ -d "$HOME/.claude" ]] && DESTS+=("$HOME/.claude/skills")
[[ -d "$HOME/.codex" ]]  && DESTS+=("$HOME/.codex/skills")

if [[ ${#DESTS[@]} -eq 0 ]]; then
  echo "Erro: nenhum agente encontrado (~/.claude ou ~/.codex)."
  exit 1
fi

install_into() {
  local dst="$1"
  local backup_dir="$dst/.backup-$(date +%Y%m%d-%H%M%S)"
  local backed_up=false

  mkdir -p "$dst"
  echo "==> Instalando em: $dst"

  for skill_dir in "$SKILLS_SRC"/*/; do
    local skill_name target current_target expected_target
    skill_name="$(basename "$skill_dir")"
    target="$dst/$skill_name"

    # Já é um symlink apontando para o lugar certo
    if [[ -L "$target" ]]; then
      current_target="$(readlink -f "$target")"
      expected_target="$(readlink -f "$skill_dir")"
      if [[ "$current_target" == "$expected_target" ]]; then
        echo "  [ok] $skill_name (symlink já existe)"
        continue
      fi
      echo "  [update] $skill_name (atualizando symlink)"
      rm "$target"
    elif [[ -d "$target" ]]; then
      # Diretório real (ex.: cópia antiga) — fazer backup antes de trocar
      if [[ "$backed_up" == false ]]; then
        mkdir -p "$backup_dir"
        backed_up=true
      fi
      echo "  [backup] $skill_name -> $backup_dir/$skill_name"
      mv "$target" "$backup_dir/$skill_name"
    fi

    ln -s "$skill_dir" "$target"
    echo "  [link] $skill_name -> $skill_dir"
  done

  if [[ "$backed_up" == true ]]; then
    echo "  Skills originais salvas em: $backup_dir"
  fi
  echo ""
}

echo "Instalando skills de: $SKILLS_SRC"
echo ""

for dst in "${DESTS[@]}"; do
  install_into "$dst"
done

echo "Instalacao concluida! (${#DESTS[@]} agente(s))"
echo "Para reverter: ./uninstall.sh"
