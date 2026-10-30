#!/usr/bin/env bash
# install-gauntlet.sh — instala, atualiza, verifica ou remove o Gauntlet v2
# no Claude Code desta máquina.
#
#   ./install-gauntlet.sh              instala/atualiza (idempotente)
#   ./install-gauntlet.sh --check      só relata o estado, não altera nada
#   ./install-gauntlet.sh --uninstall  remove os symlinks e restaura todos os backups
#
# O que ele faz:
#   claude-agents/gauntlet-*.md   -> ~/.claude/agents/gauntlet-*.md   (symlinks)
#   claude-skills/gauntlet/       -> ~/.claude/skills/gauntlet        (symlink)
#   ~/.claude/.gauntlet-install-manifest   proveniência dos links que ele criou
#
# Seguro por construção:
#   - arquivo, diretório ou symlink de outra origem que já ocupe um destino vai
#     para backup antes (nunca é apagado); --uninstall restaura todos os backups;
#   - proveniência, não sufixo: a instalação registra no manifesto cada link
#     que criou ou confirmou como seu ("<destino relativo a ~/.claude><TAB>
#     <alvo absoluto>", gravado de forma atômica). Só um symlink PENDENTE cujo
#     destino e alvo exatos constam do manifesto (ex.: o checkout foi movido) é
#     removido sem backup — não guarda dado nenhum, e restaurá-lo só recriaria
#     um link quebrado. Qualquer outro link pendente, mesmo com alvo parecido
#     (…/claude-agents/gauntlet-*.md, …/claude-skills/gauntlet), vai para backup;
#   - symlink de agente gauntlet-* sem alvo (agente removido) é limpo só se
#     aponta para este repo ou se o manifesto o prova — nenhum outro é tocado;
#   - se ~/.claude/agents ou ~/.claude/skills já for um symlink de diretório para
#     dentro deste repo, o destino é reconhecido como a própria fonte ([ok]) e
#     --uninstall nunca restaura um backup para dentro deste repo (o destino
#     resolvido fica fora da árvore fonte, ou o item permanece no backup);
#   - --check não escreve nada (nem o manifesto) e só executa o harness por um
#     link deste repo;
#   - modelo/esforço são lidos do frontmatter dos agentes, nunca hardcoded aqui.
set -euo pipefail

MODE="install"
case "${1:-}" in
  "") ;;
  --check) MODE="check" ;;
  --uninstall) MODE="uninstall" ;;
  -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
  *) echo "Opção desconhecida: $1 (use --check, --uninstall ou nada)"; exit 2 ;;
esac

REPO_DIR="$(cd "$(dirname "$0")" && pwd -P)"
AGENTS_SRC="$REPO_DIR/claude-agents"
SKILL_SRC="$REPO_DIR/claude-skills/gauntlet"

CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
AGENTS_DST="$CLAUDE_DIR/agents"
SKILL_DST="$CLAUDE_DIR/skills/gauntlet"

BACKUP_DIR="$CLAUDE_DIR/.gauntlet-backup-$(date +%Y%m%d-%H%M%S)"
MANIFEST="$CLAUDE_DIR/.gauntlet-install-manifest"
MANIFEST_USABLE=true
MANIFEST_RELS=()      # destinos relativos a CLAUDE_DIR (agents/gauntlet-*.md, skills/gauntlet)
MANIFEST_TARGETS=()   # alvo absoluto gravado para cada destino (mesmo índice)
BACKED_UP=false
HARNESS_VERSION=""
SKILL_LINK_OK=false
CHANGES=0
PROBLEMS=0

# readlink -f portátil (GNU coreutils e macOS >= 12.3 têm; fallback por cd/pwd -P).
# Devolve "" quando não consegue resolver (loop de symlink, componente ausente).
resolve_path() {
  local target="$1" depth="${2:-0}"
  if readlink -f "$target" >/dev/null 2>&1; then
    readlink -f "$target"
  else
    (( depth < 32 )) || { echo ""; return; }
    local dir base next
    dir="$(cd "$(dirname "$target")" 2>/dev/null && pwd -P)" || { echo ""; return; }
    base="$(basename "$target")"
    if [[ -L "$dir/$base" ]]; then
      next="$(readlink "$dir/$base")"
      # alvo relativo é relativo ao diretório do link, não ao cwd do script
      [[ "$next" == /* ]] || next="$dir/$next"
      resolve_path "$next" $((depth + 1))
    else
      echo "$dir/$base"
    fi
  fi
}

# true se o caminho (resolvendo symlinks do diretório pai) cai dentro da
# árvore deste repositório — o instalador nunca cria nem remove nada aí.
inside_repo() {
  local parent; parent="$(resolve_path "$(dirname "$1")")"
  [[ -n "$parent" && ( "$parent" == "$REPO_DIR" || "$parent" == "$REPO_DIR"/* ) ]]
}

# Alvo bruto de um symlink, absolutizado em relação ao diretório do link, sem
# seguir níveis adicionais — é o que decide se um link "é deste repo".
link_target_abs() {
  local link="$1" raw
  raw="$(readlink "$link")" || { echo ""; return; }
  [[ "$raw" == /* ]] || raw="$(cd "$(dirname "$link")" && pwd -P)/$raw"
  # normaliza ./ e ../ sem tocar o disco
  local -a parts=() out=()
  IFS=/ read -r -a parts <<<"$raw"
  local part
  for part in "${parts[@]}"; do
    case "$part" in
      ""|.) ;;
      ..) [[ ${#out[@]} -gt 0 ]] && unset 'out[${#out[@]}-1]' ;;
      *) out+=("$part") ;;
    esac
  done
  printf '/%s\n' "$(IFS=/; echo "${out[*]}")"
}

points_into_repo_agents() { # true se o link aponta para $AGENTS_SRC/<algo>
  local abs dirabs; abs="$(link_target_abs "$1")"
  [[ -n "$abs" ]] || return 1
  [[ "$abs" == "$AGENTS_SRC"/* ]] && return 0
  # checkout acessado por um caminho com symlink (ex.: instalador v1 usava `pwd` lógico):
  # o diretório do alvo resolve para claude-agents/ mesmo que o alvo em si não exista mais
  dirabs="$(resolve_path "$(dirname "$abs")")"
  [[ -n "$dirabs" && "$dirabs" == "$AGENTS_SRC" ]]
}

# ------------------------------------------------------------ manifesto
# O manifesto registra a PROVENIÊNCIA dos links: uma linha por link que a
# instalação criou ou confirmou como seu, "<destino relativo a CLAUDE_DIR>
# <TAB><alvo absoluto>". É o único critério que autoriza remover sem backup um
# link pendente — o sufixo do alvo (…/claude-agents/<nome>) não prova nada: um
# link dos dotfiles do usuário para um checkout desmontado tem o mesmo sufixo.

# Só destinos do Gauntlet podem constar do manifesto (uma linha editada à mão
# nunca estende o que o instalador remove).
manifest_rel_ok() {
  [[ "$1" == skills/gauntlet || ( "$1" == agents/gauntlet-*.md && "$1" != */*/* ) ]]
}

manifest_set() { # manifest_set <destino relativo> <alvo absoluto>
  local rel="$1" target="$2" i
  # Alvo relativo ou com TAB/quebra de linha não cabe no formato: sem registro,
  # o link apenas perde a prova (na dúvida, vai para backup).
  [[ "$target" == /* && "$target" != *$'\t'* && "$target" != *$'\n'* ]] || return 0
  for ((i = 0; i < ${#MANIFEST_RELS[@]}; i++)); do
    if [[ "${MANIFEST_RELS[$i]}" == "$rel" ]]; then MANIFEST_TARGETS[$i]="$target"; return 0; fi
  done
  MANIFEST_RELS+=("$rel"); MANIFEST_TARGETS+=("$target")
  return 0
}

manifest_target() { # manifest_target <destino relativo> — alvo gravado; falha se não há registro
  local i
  for ((i = 0; i < ${#MANIFEST_RELS[@]}; i++)); do
    if [[ "${MANIFEST_RELS[$i]}" == "$1" ]]; then printf '%s\n' "${MANIFEST_TARGETS[$i]}"; return 0; fi
  done
  return 1
}

# Lê o manifesto (só leitura; ausente = instalação antiga, nada é provado).
load_manifest() {
  MANIFEST_RELS=(); MANIFEST_TARGETS=()
  [[ -e "$MANIFEST" || -L "$MANIFEST" ]] || return 0
  if [[ -L "$MANIFEST" || ! -f "$MANIFEST" || ! -r "$MANIFEST" ]]; then
    MANIFEST_USABLE=false
    echo "  [warn]    $MANIFEST não é um arquivo regular legível: ignorado e não reescrito (links pendentes vão para backup)"
    return 0
  fi
  local rel target
  while IFS=$'\t' read -r rel target || [[ -n "$rel" ]]; do
    if manifest_rel_ok "$rel"; then manifest_set "$rel" "$target"; fi
  done <"$MANIFEST"
  return 0
}

# Grava o manifesto (temporário + mv: atômico) só com o que ainda é verdade — o
# destino é um symlink com exatamente o alvo registrado. Entradas de links
# removidos, trocados ou restaurados de backup caem aqui; sem nenhuma entrada o
# arquivo é apagado. Conteúdo igual não é regravado. Nunca escreve dentro do
# repositório fonte. Chamado só na instalação e no --uninstall, nunca no --check.
save_manifest() {
  [[ "$MANIFEST_USABLE" == true ]] || return 0
  if inside_repo "$MANIFEST"; then return 0; fi
  local i link content="" tmp
  for ((i = 0; i < ${#MANIFEST_RELS[@]}; i++)); do
    link="$CLAUDE_DIR/${MANIFEST_RELS[$i]}"
    [[ -L "$link" && "$(link_target_abs "$link")" == "${MANIFEST_TARGETS[$i]}" ]] || continue
    content+="${MANIFEST_RELS[$i]}"$'\t'"${MANIFEST_TARGETS[$i]}"$'\n'
  done
  if [[ -z "$content" ]]; then
    rm -f "$MANIFEST" || return 1
    return 0
  fi
  if [[ -f "$MANIFEST" ]] && printf '%s' "$content" | cmp -s - "$MANIFEST"; then return 0; fi
  tmp="$(mktemp "$MANIFEST.XXXXXX")" || return 1
  if printf '%s' "$content" >"$tmp" && mv -f "$tmp" "$MANIFEST"; then return 0; fi
  rm -f "$tmp"; return 1
}

# true se <link> é um symlink PENDENTE que o manifesto prova ser desta
# instalação: o mesmo destino, com exatamente o alvo que ela gravou (ex.: o
# checkout foi movido). Não guarda dado do usuário; fazer backup dele só
# devolveria um link quebrado no --uninstall. Sem registro — instalação feita
# por um instalador antigo, ou link do usuário com alvo parecido — é falso, e
# o link é tratado como qualquer item alheio (backup, nunca rm).
previous_install_link() { # previous_install_link <link> <destino relativo a CLAUDE_DIR>
  local link="$1" rel="$2" recorded abs
  [[ -L "$link" && ! -e "$link" ]] || return 1
  recorded="$(manifest_target "$rel")" || return 1
  abs="$(link_target_abs "$link")"
  [[ -n "$abs" && "$abs" == "$recorded" ]]
}

frontmatter_field() {
  # frontmatter_field <arquivo> <campo> — valor do campo no bloco YAML inicial
  awk -v key="$2" '
    NR == 1 && $0 != "---" { exit }
    NR > 1 && $0 == "---" { exit }
    NR > 1 && index($0, key ":") == 1 { sub("^" key ":[ ]*", ""); print; exit }
  ' "$1"
}

backup_existing() {
  local target="$1" relative_name="$2"
  if [[ "$BACKED_UP" == false ]]; then
    # mkdir sem -p é atômico: dois backups no mesmo segundo nunca colidem.
    # O sufixo de colisão é sequencial (-01, -02, ...), nunca aleatório: a
    # ordem lexical dos nomes (LC_ALL=C) é a ordem de criação, e é por ela
    # que --uninstall restaura do mais novo ao mais antigo. Se já existe
    # algum irmão "<base>-N" (inclusive do esquema antigo, aleatório), o
    # novo recebe max(N)+1 — depois de todos os irmãos de mesma largura;
    # entre backups legados de larguras distintas a ordem é a lexical dos
    # nomes, sem garantia (eles são sempre preservados e restaurados quando
    # o destino está livre).
    # Só tenta de novo em colisão; outra falha (permissão, disco) aborta.
    local base="$BACKUP_DIR" attempt=0 seq=0 sibling
    for sibling in "$base"-*/; do
      sibling="${sibling%/}"; sibling="${sibling##*-}"
      if [[ "$sibling" =~ ^[0-9]{1,9}$ ]] && (( 10#$sibling > seq )); then seq=$((10#$sibling)); fi
    done
    if (( seq > 0 )); then seq=$((seq + 1)); BACKUP_DIR="$(printf '%s-%02d' "$base" "$seq")"; fi
    until mkdir "$BACKUP_DIR" 2>/dev/null; do
      if [[ ! -e "$BACKUP_DIR" || $attempt -ge 20 ]]; then
        echo "Erro: não foi possível criar o diretório de backup $BACKUP_DIR (permissão? disco?). Nada foi apagado; reexecute após corrigir."; exit 1
      fi
      attempt=$((attempt + 1)); seq=$((seq + 1)); BACKUP_DIR="$(printf '%s-%02d' "$base" "$seq")"
    done
    BACKED_UP=true
  fi
  mkdir -p "$(dirname "$BACKUP_DIR/$relative_name")"
  if [[ -e "$BACKUP_DIR/$relative_name" || -L "$BACKUP_DIR/$relative_name" ]]; then
    echo "Erro interno: $BACKUP_DIR/$relative_name já existe; abortando sem sobrescrever"; exit 1
  fi
  mv "$target" "$BACKUP_DIR/$relative_name"
}

install_link() {
  local source="$1" target="$2" label="$3" backup_name="$4"
  local expected current
  expected="$(resolve_path "$source")"

  # Destino cujo diretório resolve para dentro deste repo e que não é a própria
  # fonte (ex.: ~/.claude/skills -> <repo>/skills, ~/.claude/agents -> <repo>):
  # instalar escreveria (link, backup) no repositório fonte. Nunca.
  if inside_repo "$target" && [[ "$(resolve_path "$target")" != "$expected" ]]; then
    # Já relatado pelo pré-voo (--check) ou inalcançável (instalação recusa antes de escrever).
    [[ "$MODE" == "check" ]] && return
    echo "Erro interno: destino $target resolve para dentro do repositório fonte; abortando"; exit 1
  fi

  if [[ -L "$target" ]]; then
    current="$(resolve_path "$target")"
    if [[ -n "$current" && "$current" == "$expected" ]]; then
      echo "  [ok]      $label"
      if [[ "$label" == "gauntlet" ]]; then SKILL_LINK_OK=true; fi
      # Confirmado como da instalação só o link cujo alvo é literalmente a fonte
      # (o que ela mesma criaria); cadeias e aliases continuam [ok], sem registro.
      if [[ "$(link_target_abs "$target")" == "$source" ]]; then manifest_set "$backup_name" "$source"; fi
      return
    fi
    if previous_install_link "$target" "$backup_name"; then
      if [[ "$MODE" == "check" ]]; then
        echo "  [DIFF]    $label -> $(readlink "$target") (link pendente de uma instalação anterior, registrado no manifesto; a instalação o substitui sem backup)"
        PROBLEMS=$((PROBLEMS + 1)); return
      fi
      # link do próprio instalador (o manifesto prova) para um checkout que não existe mais: nada a preservar
      current="$(readlink "$target")"
      rm "$target"
      echo "  [stale]   $label -> $current removido (link pendente de uma instalação anterior, registrado no manifesto; sem backup)"
    elif [[ "$MODE" == "check" ]]; then
      echo "  [DIFF]    $label -> $(readlink "$target") (esperado: $source)"; PROBLEMS=$((PROBLEMS + 1)); return
    else
      # symlink de outra origem (dotfiles, outro checkout): preserva o link em backup em vez de apagar
      echo "  [backup]  $label (symlink -> $(readlink "$target"))"
      backup_existing "$target" "$backup_name"
    fi
  elif [[ -e "$target" ]]; then
    current="$(resolve_path "$target")"
    if [[ -n "$current" && "$current" == "$expected" ]]; then
      # ~/.claude/agents (ou skills) é um symlink de diretório para dentro deste
      # repo: o destino já É a fonte. Nada a linkar, nada a mover.
      echo "  [ok]      $label (o destino já é a própria fonte)"
      if [[ "$label" == "gauntlet" ]]; then SKILL_LINK_OK=true; fi
      return
    fi
    if [[ "$MODE" == "check" ]]; then
      echo "  [REAL]    $label ocupa o destino como arquivo/diretório real (será preservado em backup na instalação)"
      PROBLEMS=$((PROBLEMS + 1)); return
    fi
    echo "  [backup]  $label"
    backup_existing "$target" "$backup_name"
  elif [[ "$MODE" == "check" ]]; then
    echo "  [MISSING] $label"; PROBLEMS=$((PROBLEMS + 1)); return
  fi

  ln -s "$source" "$target"
  manifest_set "$backup_name" "$source"
  CHANGES=$((CHANGES + 1))
  if [[ "$label" == "gauntlet" ]]; then SKILL_LINK_OK=true; fi
  echo "  [link]    $label -> $source"
}

# Pré-voo: ANTES de qualquer mkdir/ln/mv, todo destino é verificado. Um destino
# que resolve para dentro deste repositório e não é a própria fonte, ou um
# diretório de destino que é um symlink pendente, recusa a instalação inteira
# — nunca uma instalação pela metade, nunca um arquivo do usuário movido para
# backup e depois "nada foi alterado". Em --check apenas relata.
preflight_destinations() {
  local bad=0 dir target expected name
  if inside_repo "$CLAUDE_DIR/agents"; then
    echo "  [REPO]    CLAUDE_DIR ($CLAUDE_DIR) resolve para dentro do repositório fonte ($(resolve_path "$CLAUDE_DIR")); o instalador não escreve aí"
    bad=$((bad + 1))
  fi
  for dir in "$AGENTS_DST" "$CLAUDE_DIR/skills"; do
    if [[ -L "$dir" && ! -e "$dir" ]]; then
      echo "  [REPO]    $dir é um symlink pendente (-> $(readlink "$dir")); corrija-o antes de instalar"
      bad=$((bad + 1))
    fi
  done
  for target in "${AGENT_SOURCES[@]}"; do
    name="$(basename "$target")"; expected="$(resolve_path "$target")"
    if inside_repo "$AGENTS_DST/$name" && [[ "$(resolve_path "$AGENTS_DST/$name")" != "$expected" ]]; then
      echo "  [REPO]    $name: o destino ($AGENTS_DST/$name) resolve para dentro do repositório fonte; o instalador não escreve aí"
      bad=$((bad + 1))
    fi
  done
  if inside_repo "$SKILL_DST" && [[ "$(resolve_path "$SKILL_DST")" != "$(resolve_path "$SKILL_SRC")" ]]; then
    echo "  [REPO]    gauntlet: o destino ($SKILL_DST) resolve para dentro do repositório fonte; o instalador não escreve aí"
    bad=$((bad + 1))
  fi
  if [[ "$bad" -gt 0 ]]; then
    if [[ "$MODE" == "check" ]]; then PROBLEMS=$((PROBLEMS + bad)); return 0; fi
    echo
    echo "Erro: $bad destino(s) resolvem para dentro do repositório fonte ou estão pendentes (ver acima). Ajuste os symlinks de $CLAUDE_DIR e reexecute. Nada foi alterado."
    exit 1
  fi
}

remove_stale_agent_links() {
  # Remove somente symlinks gauntlet-*.md sem alvo que são comprovadamente
  # desta instalação: apontam para dentro deste repo (agente removido em uma
  # versão nova) ou, pendentes, constam do manifesto com exatamente esse alvo
  # (agente removido E checkout movido). Os agentes atuais já passaram por
  # install_link. Se o diretório de destino é a própria fonte, não há o que limpar.
  [[ -d "$AGENTS_DST" ]] || return 0
  if [[ "$(cd "$AGENTS_DST" && pwd -P)" == "$AGENTS_SRC" ]]; then return 0; fi
  local link target name why
  for link in "$AGENTS_DST"/gauntlet-*.md; do
    [[ -L "$link" ]] || continue
    inside_repo "$link" && continue          # nunca remove nada dentro do repositório fonte
    name="$(basename "$link")"
    if points_into_repo_agents "$link"; then
      target="$(link_target_abs "$link")"
      [[ -e "$target" ]] && continue
      why="alvo não existe mais"
    elif [[ ! -e "$AGENTS_SRC/$name" && ! -L "$AGENTS_SRC/$name" ]] && previous_install_link "$link" "agents/$name"; then
      target="$(readlink "$link")"
      why="link pendente de uma instalação anterior, registrado no manifesto; agente não existe mais"
    else
      continue
    fi
    if [[ "$MODE" == "check" ]]; then
      echo "  [STALE]   $name -> $target ($why)"; PROBLEMS=$((PROBLEMS + 1))
    else
      rm "$link"; CHANGES=$((CHANGES + 1))
      echo "  [stale]   $name removido ($why)"
    fi
  done
}

verify_harness() {
  # Executa o harness ATRAVÉS do link instalado — é assim que a skill o invoca.
  local entry="$SKILL_DST/scripts/gauntlet.mjs"
  # O link da skill aponta para este repo; sem o ponto de entrada a skill não
  # funciona, com ou sem node — é defeito do checkout, não modo degradado.
  if [[ ! -f "$entry" ]]; then
    echo "  [BROKEN]  harness ausente: $entry não existe, não é um arquivo regular ou é um link pendente"
    PROBLEMS=$((PROBLEMS + 1)); return
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "  [warn]    node não encontrado: o harness roda em modo degradado (ver references/harness.md)"
    return
  fi
  if HARNESS_VERSION="$(node "$entry" version 2>/dev/null)" && [[ "$HARNESS_VERSION" == gauntlet-harness* ]]; then
    echo "  [ok]      harness responde pelo link instalado: $HARNESS_VERSION"
  else
    echo "  [BROKEN]  harness não responde por $entry"; PROBLEMS=$((PROBLEMS + 1))
  fi
}

print_config() {
  echo
  echo "Configuração declarada (frontmatter dos agentes é autoritativo):"
  echo
  local file name model effort
  for file in "$AGENTS_SRC"/gauntlet-*.md; do
    [[ -e "$file" ]] || continue
    name="$(frontmatter_field "$file" name)"
    model="$(frontmatter_field "$file" model)"
    effort="$(frontmatter_field "$file" effort)"
    printf "  %-18s model=%-8s effort=%s\n" "$name" "${model:-inherit}" "${effort:-inherit}"
  done
  echo "  /gauntlet           skill do orquestrador -> $SKILL_DST"
}

uninstall() {
  echo "Removendo o Gauntlet v2 de $CLAUDE_DIR ..."
  # Sem manifesto (instalação feita por um instalador antigo) nada é provado e
  # a remoção é a de sempre: só links que apontam para este repo.
  load_manifest
  local link removed=0
  # Se ~/.claude/agents é a própria pasta claude-agents/ deste repo, não há link
  # do instalador para remover — e nada dentro do repo pode ser tocado.
  if [[ -d "$AGENTS_DST" && "$(cd "$AGENTS_DST" && pwd -P)" == "$AGENTS_SRC" ]]; then
    echo "  [skip]    agents/ é a própria fonte deste repo; nada a remover"
  else
  for link in "$AGENTS_DST"/gauntlet-*.md; do
    [[ -L "$link" ]] || continue
    if inside_repo "$link"; then
      echo "  [skip]    $(basename "$link") está dentro do repositório fonte ($(resolve_path "$(dirname "$link")")); nada é removido aí — remova à mão se for um resíduo"
    elif points_into_repo_agents "$link"; then
      rm "$link"; removed=$((removed + 1)); echo "  [removed] $(basename "$link")"
    elif previous_install_link "$link" "agents/$(basename "$link")"; then
      rm "$link"; removed=$((removed + 1)); echo "  [removed] $(basename "$link") (link pendente de uma instalação anterior, registrado no manifesto)"
    else
      echo "  [skip]    $(basename "$link") aponta para fora deste repo"
    fi
  done
  fi
  if [[ -L "$SKILL_DST" ]] && inside_repo "$SKILL_DST"; then
    echo "  [skip]    skills/gauntlet está dentro do repositório fonte ($(resolve_path "$(dirname "$SKILL_DST")")); nada é removido aí — remova à mão se for um resíduo"
  elif [[ -L "$SKILL_DST" ]]; then
    local skill_real; skill_real="$(resolve_path "$SKILL_DST")"
    if [[ "$(link_target_abs "$SKILL_DST")" == "$SKILL_SRC" || ( -n "$skill_real" && "$skill_real" == "$(resolve_path "$SKILL_SRC")" ) ]]; then
      rm "$SKILL_DST"; removed=$((removed + 1)); echo "  [removed] skills/gauntlet"
    elif previous_install_link "$SKILL_DST" "skills/gauntlet"; then
      rm "$SKILL_DST"; removed=$((removed + 1)); echo "  [removed] skills/gauntlet (link pendente de uma instalação anterior, registrado no manifesto)"
    else
      echo "  [skip]    skills/gauntlet aponta para fora deste repo"
    fi
  elif [[ -e "$SKILL_DST" ]]; then
    echo "  [skip]    skills/gauntlet é um diretório real, não um symlink deste instalador"
  fi

  # Restaura os backups, do mais recente ao mais antigo, só em caminhos livres.
  # A ordem de criação é a ordem lexical dos nomes em LC_ALL=C (timestamp, e
  # sufixo sequencial dentro do mesmo segundo), independente do locale do glob.
  # Sem a barra final do glob: "<base>/" ordenaria depois de "<base>-01/".
  local backups=() candidate
  while IFS= read -r -d '' candidate; do
    [[ -d "$candidate" && ! -L "$candidate" ]] && backups+=("$candidate")
  done < <(for candidate in "$CLAUDE_DIR"/.gauntlet-backup-*; do printf '%s\0' "$candidate"; done | LC_ALL=C sort -z)
  local backup item rel dest dest_dir dest_parent kept_here leftover=0
  for ((i = ${#backups[@]} - 1; i >= 0; i--)); do
    backup="${backups[$i]}"; kept_here=0
    while IFS= read -r -d '' item; do
      rel="${item#"$backup"/}"
      dest="$CLAUDE_DIR/$rel"
      dest_dir="$(dirname "$dest")"
      # Nunca escrever dentro do repositório fonte: se o diretório de destino
      # (resolvendo symlinks, ex.: ~/.claude/agents -> <repo>/claude-agents) cai
      # na árvore deste repo, o item fica no backup.
      dest_parent="$(resolve_path "$dest_dir")"
      if [[ -n "$dest_parent" && ( "$dest_parent" == "$REPO_DIR" || "$dest_parent" == "$REPO_DIR"/* ) ]]; then
        echo "  [kept]    $rel continua em $(basename "$backup") — o destino resolve para dentro do repositório fonte ($dest_parent)"
        leftover=$((leftover + 1)); kept_here=$((kept_here + 1))
      elif [[ ( -L "$dest_dir" || -e "$dest_dir" ) && ! -d "$dest_dir" ]]; then
        # mkdir -p falharia (symlink quebrado ou arquivo no lugar do diretório): o item espera no backup
        if [[ -L "$dest_dir" && ! -e "$dest_dir" ]]; then
          echo "  [kept]    $rel continua em $(basename "$backup") — destino pendente: $dest_dir é um symlink quebrado (-> $(readlink "$dest_dir")); corrija-o e rode --uninstall de novo"
        else
          echo "  [kept]    $rel continua em $(basename "$backup") — destino pendente: $dest_dir não é um diretório; corrija-o e rode --uninstall de novo"
        fi
        leftover=$((leftover + 1)); kept_here=$((kept_here + 1))
      elif [[ ! -e "$dest" && ! -L "$dest" ]]; then
        mkdir -p "$dest_dir"
        mv "$item" "$dest"
        echo "  [restored] $rel (de $(basename "$backup"))"
      else
        echo "  [kept]    $rel continua em $(basename "$backup") — destino ocupado"
        leftover=$((leftover + 1)); kept_here=$((kept_here + 1))
      fi
    done < <(find "$backup" -mindepth 2 -maxdepth 2 -print0 2>/dev/null)
    # Só poda um backup do qual nada ficou retido: podar diretórios vazios de um
    # item [kept] alteraria (ou apagaria) o próprio item que o usuário vai buscar.
    if [[ "$kept_here" -eq 0 ]]; then
      find "$backup" -type d -empty -delete 2>/dev/null || true
      [[ -d "$backup" ]] || echo "  backup $(basename "$backup") consumido e removido"
    fi
  done
  # Só ficam no manifesto os links que continuam lá (ex.: de outro checkout);
  # sem nenhum, ele é apagado.
  save_manifest || echo "  [warn]    não foi possível atualizar $MANIFEST (permissão? disco?)"
  echo
  if [[ "$leftover" -gt 0 ]]; then
    echo "Desinstalação concluída ($removed link(s) removido(s)); $leftover item(ns) de backup não restaurado(s) (ver [kept] acima) — veja $CLAUDE_DIR/.gauntlet-backup-*"
  else
    echo "Desinstalação concluída ($removed link(s) removido(s))."
  fi
}

# ------------------------------------------------------------------ main

if [[ ! -d "$CLAUDE_DIR" ]]; then
  echo "Erro: Claude Code não encontrado em $CLAUDE_DIR"; exit 1
fi

if [[ "$MODE" == "uninstall" ]]; then
  # A desinstalação só precisa saber ONDE a fonte fica, não que ela esteja intacta.
  uninstall; exit 0
fi

if [[ ! -d "$AGENTS_SRC" ]]; then
  echo "Erro: diretório claude-agents/ não encontrado em $REPO_DIR"; exit 1
fi
if [[ ! -f "$SKILL_SRC/SKILL.md" ]]; then
  echo "Erro: skill gauntlet não encontrada em $SKILL_SRC/SKILL.md"; exit 1
fi
shopt -s nullglob
AGENT_SOURCES=("$AGENTS_SRC"/gauntlet-*.md)
shopt -u nullglob
if [[ ${#AGENT_SOURCES[@]} -eq 0 ]]; then
  echo "Erro: nenhum agente gauntlet-*.md em $AGENTS_SRC — a fonte está incompleta; nada foi alterado."; exit 1
fi

echo "========================================"
echo " Gauntlet v2 — $([[ "$MODE" == check ]] && echo verificação || echo instalação)"
echo "========================================"
echo

load_manifest
preflight_destinations
if [[ "$MODE" == "install" ]]; then
  mkdir -p "$AGENTS_DST" "$CLAUDE_DIR/skills"
fi

echo "Subagentes ($AGENTS_DST):"
for source in "${AGENT_SOURCES[@]}"; do
  name="$(basename "$source")"
  install_link "$source" "$AGENTS_DST/$name" "$name" "agents/$name"
done
remove_stale_agent_links

echo
echo "Skill /gauntlet ($CLAUDE_DIR/skills):"
install_link "$SKILL_SRC" "$SKILL_DST" "gauntlet" "skills/gauntlet"
if [[ "$MODE" == "install" ]]; then
  # Proveniência dos links criados/confirmados nesta execução. Sem ela nada se
  # perde: links pendentes desta instalação só deixam de ser provados (backup).
  save_manifest || echo "  [warn]    não foi possível gravar $MANIFEST (permissão? disco?): links pendentes desta instalação irão para backup em vez de serem removidos"
fi
if [[ "$SKILL_LINK_OK" == true ]]; then
  verify_harness          # só executa o harness por um link que comprovadamente aponta para este repo
elif [[ "$MODE" == "check" ]]; then
  echo "  [skip]    harness não verificado: o link da skill não aponta para este repo"
fi

print_config

echo
if [[ "$MODE" == "check" ]]; then
  if [[ "$PROBLEMS" -eq 0 ]]; then
    echo "Estado: instalado e consistente."; exit 0
  fi
  echo "Estado: $PROBLEMS item(ns) divergente(s). Rode ./install-gauntlet.sh para corrigir."; exit 1
fi

if [[ "$BACKED_UP" == true ]]; then
  echo "Arquivos anteriores preservados em: $BACKUP_DIR"
  echo "(./install-gauntlet.sh --uninstall os restaura)"
  echo
fi
# Na instalação, só verify_harness incrementa PROBLEMS: os links existem, mas a
# skill não funciona — isso não pode sair 0 nem se anunciar como concluído.
if [[ "$PROBLEMS" -gt 0 ]]; then
  echo "Instalação incompleta: os links foram criados, mas o harness está ausente ou não responde pelo link instalado (ver [BROKEN] acima). Confira o checkout e o node (>= 20) e reexecute."
  exit 1
fi
if [[ "$CHANGES" -eq 0 ]]; then
  echo "Nada a fazer: já estava instalado e atualizado."
else
  echo "Instalação concluída ($CHANGES alteração(ões)). Abra uma nova sessão do Claude Code para carregar os agentes."
fi
