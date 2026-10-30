# Recon Playbook — Tecnicas e Comandos por Fase

Comandos operacionais das ferramentas padrao de mercado (2026). Assume alvo autorizado (Fase 0 ok). Passivo = nao toca o alvo; Ativo = envia trafego (so autorizado). Substituir `alvo.com` pelo escopo.

> Instalacao rapida da suite ProjectDiscovery: `go install` de subfinder, dnsx, naabu, httpx, katana, nuclei. `amass`, `gau`, `whatweb`, `ffuf`, `nmap`, `trufflehog` sao complementos.

---

## Fase 1 — Passivo / OSINT (nao toca o alvo)

### Certificate Transparency (subdominios via certificados)
```bash
# crt.sh — sem instalar nada
curl -s "https://crt.sh/?q=%25.alvo.com&output=json" | jq -r '.[].name_value' | sed 's/\*\.//g' | sort -u

# via ferramenta
subfinder -d alvo.com -all -silent        # agrega dezenas de fontes passivas
amass enum -passive -d alvo.com            # mais fundo, mais lento
```

### URLs e endpoints historicos (Wayback / arquivos)
```bash
gau alvo.com                # getallurls — Wayback + Common Crawl + URLScan + OTX
waybackurls alvo.com        # so Wayback
# filtrar por interesse
gau alvo.com | grep -iE '\.(json|env|bak|sql|log|config)(\?|$)' | sort -u
gau alvo.com | grep -iE '\?' | sort -u    # URLs com parametros (alvos de teste)
```

### Segredos em codigo publico
```bash
trufflehog github --org=ORG --only-verified   # segredos verificados em repos da org
gitleaks detect --source=REPO_CLONADO         # em repo clonado
# GitHub dorks manuais: ver osint-sources.md
```

### Servicos ja indexados (sem escanear voce mesmo)
```bash
# Shodan CLI (requer API key gratuita)
shodan search "hostname:alvo.com"
shodan host <IP>
# Censys: censys search 'services.tls.certificates.leaf_data.names: alvo.com'
```

### ASN / netblocks da organizacao
```bash
whois -h whois.cymru.com " -v <IP>"           # ASN de um IP
amass intel -org "Nome da Empresa"            # ASNs por nome de org
# depois, expandir os ranges do ASN para recon dos IPs proprios
```

---

## Fase 2 — Descoberta de ativos (agregacao)

```bash
# juntar todas as fontes de subdominio num arquivo unico deduplicado
{ subfinder -d alvo.com -all -silent;
  curl -s "https://crt.sh/?q=%25.alvo.com&output=json" | jq -r '.[].name_value' | sed 's/\*\.//g';
} | sort -u > subs.txt
wc -l subs.txt
```

### Subdomain takeover (quick win — checar sempre)
```bash
dnsx -l subs.txt -cname -resp -silent         # ver CNAMEs
# CNAME apontando para servico nao-reclamado (heroku, s3, github.io, azure) = candidato a takeover
subzy run --targets subs.txt                  # ferramenta dedicada
nuclei -l alive.txt -t http/takeovers/ -silent
```

---

## Fase 3 — Hosts vivos & enumeracao ativa (SO AUTORIZADO)

### Resolucao e hosts vivos
```bash
dnsx -l subs.txt -resp -silent -o resolved.txt      # quais resolvem + IPs
httpx -l subs.txt -silent -title -tech-detect -status-code -o alive.txt
# httpx ja entrega: status, titulo, tecnologia, servidor — mapa web em um comando
```

### Portas e servicos
```bash
naabu -l resolved.txt -top-ports 1000 -silent -o ports.txt   # varredura rapida
# nmap so nos alvos/portas relevantes, para versao e scripts
nmap -sV -sC -p <portas> <IP> -oN nmap.txt
nmap -Pn --top-ports 100 -T3 <IP>                            # -T3 educado; evitar -T5 em prod
```

### Fingerprint de tecnologia (cruzar com CVE)
```bash
httpx -l alive.txt -tech-detect -server -silent
whatweb https://alvo.com
# achou "nginx 1.18.0" / "WordPress 5.x" -> buscar CVE conhecida da versao
```

---

## Fase 4 — Mapeamento de superficie web

### Crawling + URLs historicas -> endpoints
```bash
katana -u https://alvo.com -d 3 -jc -silent -o crawl.txt     # crawl com JS
cat crawl.txt <(gau alvo.com) | sort -u > urls.txt
```

### Analise de JavaScript (o front revela o back)
```bash
# extrair endpoints e possiveis chaves dos JS
katana -u https://alvo.com -jc -silent | grep -iE '\.js$' | sort -u > js.txt
# baixar e vasculhar
while read u; do curl -s "$u"; done < js.txt | grep -oE '"/[a-zA-Z0-9_/-]+"' | sort -u   # rotas de API
while read u; do curl -s "$u"; done < js.txt | grep -iE '(api[_-]?key|token|secret|aws|firebase)' | sort -u
```

### Conteudo / diretorios (leve e autorizado)
```bash
ffuf -u https://alvo.com/FUZZ -w wordlist.txt -mc 200,301,302,401,403 -t 30 -o ffuf.json
# procurar: /api, /admin, /.git/, /backup, /staging, /.env, /swagger, /graphql
curl -s https://alvo.com/.git/HEAD          # .git exposto = codigo-fonte vazando
```

---

## Pipeline completo (passivo -> vivos -> superficie)

```bash
D=alvo.com
subfinder -d $D -all -silent | tee subs.txt \
  | dnsx -silent | tee resolved.txt \
  | httpx -silent -title -tech-detect -status-code | tee alive.txt
# a partir de alive.txt: naabu para portas, katana para crawl, e consolidar no surface-map
```

---

## Notas de conduta

- **Rate limit:** ferramentas ProjectDiscovery aceitam `-rl` (rate limit) e `-c` (concorrencia). Em alvo de bounty/prod, ser educado (`-rl 50`).
- **Escopo:** filtrar `subs.txt` para remover out-of-scope ANTES de rodar httpx/naabu.
- **Nuclei:** util no recon para deteccoes passivas/exposicoes (`-t http/exposures/`, `-t http/takeovers/`), mas templates intrusivos ja sao exploracao -> pertencem a `app-pentest`/`bug-bounty`.
- **Silencio:** `-silent` em tudo para saida limpa e pipeavel.
