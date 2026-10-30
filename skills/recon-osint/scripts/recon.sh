#!/usr/bin/env bash
# ============================================================
# recon.sh — Pipeline de recon com fallback gracioso.
# Uso autorizado apenas (infra propria / contrato / escopo de bounty / lab).
#
#   ./recon.sh alvo.com [pasta_saida] [--active]
#
# SEM --active: apenas PASSIVO (nao toca o alvo) — crt.sh, subfinder, gau.
# COM  --active: adiciona ATIVO (envia trafego) — dnsx, httpx, naabu.
#
# Degrada com elegancia se uma ferramenta nao estiver instalada.
# Nao roda exploracao — so descoberta/enumeracao nao-destrutiva.
# ============================================================
set -uo pipefail

DOMAIN="${1:-}"
OUTDIR="${2:-recon-out}"
ACTIVE=false
for arg in "$@"; do [[ "$arg" == "--active" ]] && ACTIVE=true; done
[[ "${2:-}" == "--active" ]] && OUTDIR="recon-out"   # se pularam a pasta

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m[ok]\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m[!]\033[0m %s\n' "$1"; }
info() { printf '  \033[36m[i]\033[0m %s\n' "$1"; }
has()  { command -v "$1" >/dev/null 2>&1; }

if [[ -z "$DOMAIN" ]]; then
  echo "Uso: ./recon.sh alvo.com [pasta_saida] [--active]"
  exit 1
fi
mkdir -p "$OUTDIR"
bold "== Recon de: $DOMAIN  (saida: $OUTDIR) =="
if $ACTIVE; then
  warn "MODO ATIVO — envia trafego ao alvo. Confirme autorizacao/escopo antes de prosseguir."
else
  info "Modo passivo (nao toca o alvo). Use --active para enumeracao ativa (so autorizado)."
fi

# ---------------------------------------------------------------
bold $'\n1) Passivo — Certificate Transparency (crt.sh)'
if has curl; then
  if has jq; then
    curl -s "https://crt.sh/?q=%25.$DOMAIN&output=json" 2>/dev/null \
      | jq -r '.[].name_value' 2>/dev/null | sed 's/\*\.//g' | sort -u > "$OUTDIR/crt.txt" || true
  else
    curl -s "https://crt.sh/?q=%25.$DOMAIN&output=json" 2>/dev/null \
      | grep -oE '"name_value":"[^"]+"' | cut -d'"' -f4 | tr '\\n' '\n' | sed 's/\*\.//g' | sort -u > "$OUTDIR/crt.txt" || true
    warn "jq nao instalado — usei parsing por grep (menos preciso)"
  fi
  ok "crt.sh: $(wc -l < "$OUTDIR/crt.txt" 2>/dev/null || echo 0) linhas"
else warn "curl nao instalado — pulei crt.sh"; fi

# ---------------------------------------------------------------
bold $'\n2) Passivo — subdominios (subfinder)'
if has subfinder; then
  subfinder -d "$DOMAIN" -all -silent > "$OUTDIR/subfinder.txt" 2>/dev/null || true
  ok "subfinder: $(wc -l < "$OUTDIR/subfinder.txt" 2>/dev/null || echo 0) subdominios"
else warn "subfinder nao instalado (go install .../subfinder)"; fi

# ---------------------------------------------------------------
bold $'\n3) Passivo — URLs historicas (gau)'
if has gau; then
  gau "$DOMAIN" 2>/dev/null | sort -u > "$OUTDIR/urls.txt" || true
  ok "gau: $(wc -l < "$OUTDIR/urls.txt" 2>/dev/null || echo 0) URLs"
  grep -iE '\?' "$OUTDIR/urls.txt" 2>/dev/null | sort -u > "$OUTDIR/urls-params.txt" || true
  info "URLs com parametros: $(wc -l < "$OUTDIR/urls-params.txt" 2>/dev/null || echo 0) (alvos de teste)"
else warn "gau nao instalado (go install .../gau)"; fi

# consolidar subdominios
cat "$OUTDIR"/crt.txt "$OUTDIR"/subfinder.txt 2>/dev/null | grep -iE "\.?$DOMAIN$" | sort -u > "$OUTDIR/subs.txt" || true
bold $'\n>> Subdominios consolidados:'
ok "$(wc -l < "$OUTDIR/subs.txt" 2>/dev/null || echo 0) unicos -> $OUTDIR/subs.txt"

# ---------------------------------------------------------------
if ! $ACTIVE; then
  bold $'\n== Passivo concluido. Para hosts vivos/portas, rode com --active (alvo autorizado). =='
  exit 0
fi

# ---------------------------------------------------------------
bold $'\n4) Ativo — resolucao (dnsx)'
if has dnsx; then
  dnsx -l "$OUTDIR/subs.txt" -silent -resp > "$OUTDIR/resolved.txt" 2>/dev/null || true
  ok "resolvidos: $(wc -l < "$OUTDIR/resolved.txt" 2>/dev/null || echo 0)"
else warn "dnsx nao instalado"; fi

# ---------------------------------------------------------------
bold $'\n5) Ativo — hosts vivos + fingerprint (httpx)'
if has httpx; then
  httpx -l "$OUTDIR/subs.txt" -silent -title -tech-detect -status-code -o "$OUTDIR/alive.txt" >/dev/null 2>&1 || true
  ok "vivos: $(wc -l < "$OUTDIR/alive.txt" 2>/dev/null || echo 0) -> $OUTDIR/alive.txt"
else warn "httpx nao instalado"; fi

# ---------------------------------------------------------------
bold $'\n6) Ativo — portas (naabu, top 1000)'
if has naabu; then
  naabu -l "$OUTDIR/subs.txt" -top-ports 1000 -silent -o "$OUTDIR/ports.txt" >/dev/null 2>&1 || true
  ok "portas -> $OUTDIR/ports.txt"
else warn "naabu nao instalado — para versao de servico, use nmap manualmente nos hosts de alive.txt"; fi

# ---------------------------------------------------------------
bold $'\n7) Ativo — takeover candidatos (nuclei)'
if has nuclei && [[ -s "$OUTDIR/alive.txt" ]]; then
  cut -d' ' -f1 "$OUTDIR/alive.txt" | nuclei -t http/takeovers/ -silent -o "$OUTDIR/takeover.txt" >/dev/null 2>&1 || true
  [[ -s "$OUTDIR/takeover.txt" ]] && warn "TAKEOVER candidatos em $OUTDIR/takeover.txt" || ok "nenhum takeover obvio"
else info "nuclei ausente ou sem hosts vivos — pulei checagem de takeover"; fi

bold $'\n== Recon ativo concluido. Consolide no surface-map-template e faca handoff. =='
