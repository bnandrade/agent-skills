#!/usr/bin/env bash
# ============================================================
# scope-check.sh — Valida alvos contra o escopo de um programa.
# A regra de ouro do bounty: nunca tocar out-of-scope.
#
#   ./scope-check.sh <arquivo-escopo> [alvo ...]          # verifica alvos
#   cat hosts.txt | ./scope-check.sh <arquivo-escopo>     # filtra: imprime so os IN-SCOPE
#
# Formato do arquivo-escopo (uma regra por linha; wildcards ok; # comenta):
#   + *.exemplo.com        # in-scope (o '+' e opcional; sem prefixo = in)
#   - pagamento.exemplo.com# out-of-scope (tem precedencia sobre in)
#   + api.outro.com
#
# Precedencia: OUT > IN. Nao listado = tratado como FORA do escopo (MISS).
# ============================================================
set -uo pipefail

SCOPE="${1:-}"
if [[ -z "$SCOPE" || ! -f "$SCOPE" ]]; then
  echo "Uso: ./scope-check.sh <arquivo-escopo> [alvo ...]"
  echo "     cat hosts.txt | ./scope-check.sh <arquivo-escopo>"
  echo "Regras no arquivo: '+padrao' (in) / '-padrao' (out) / '#' comenta / wildcard ok"
  exit 1
fi
shift

IN=(); OUT=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"                       # remove comentario
  line="${line#"${line%%[![:space:]]*}"}"  # trim esquerda
  line="${line%"${line##*[![:space:]]}"}"  # trim direita
  [[ -z "$line" ]] && continue
  case "$line" in
    +*) p="${line#+}"; p="${p#"${p%%[![:space:]]*}"}"; IN+=("$p");;
    -*) p="${line#-}"; p="${p#"${p%%[![:space:]]*}"}"; OUT+=("$p");;
    *)  IN+=("$line");;
  esac
done < "$SCOPE"

norm() { local t="$1"; t="${t#*://}"; t="${t%%/*}"; t="${t%%:*}"; printf '%s' "$t"; }

matches() {  # matches <host> <padroes...>
  local host="$1"; shift
  local p
  for p in "$@"; do
    [[ -z "$p" ]] && continue
    # shellcheck disable=SC2254
    case "$host" in $p) return 0;; esac
  done
  return 1
}

# 0=IN, 1=MISS, 2=OUT
verdict() {
  local host; host="$(norm "$1")"
  if matches "$host" "${OUT[@]:-}"; then return 2; fi
  if matches "$host" "${IN[@]:-}";  then return 0; fi
  return 1
}

if [[ $# -eq 0 ]]; then
  # modo filtro (pipe): imprime so os in-scope, limpos, prontos para o proximo comando
  while IFS= read -r t; do
    [[ -z "$t" ]] && continue
    verdict "$t"; [[ $? -eq 0 ]] && printf '%s\n' "$t"
  done
else
  # modo verificacao: veredito por alvo
  for t in "$@"; do
    verdict "$t"; rc=$?
    case $rc in
      0) printf '  \033[32mIN  \033[0m %s\n' "$t";;
      2) printf '  \033[31mOUT \033[0m %s  (out-of-scope — NAO tocar)\n' "$t";;
      *) printf '  \033[33mMISS\033[0m %s  (nao listado — trate como fora)\n' "$t";;
    esac
  done
  echo "---"
  echo "IN = pode testar   OUT = proibido   MISS = nao listado (nao teste)"
fi
