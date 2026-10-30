# Fontes de OSINT & Dorks

Catalogo de fontes publicas (passivas) para recon. Nao tocam o alvo — consultam terceiros que ja indexaram informacao publica. Uso com **proposito legitimo** (sua exposicao ou alvo autorizado).

---

## Certificate Transparency (subdominios)
Todo certificado emitido e publico. Melhor fonte gratuita de subdominios.
- **crt.sh** — `https://crt.sh/?q=%25.alvo.com` (web) ou `&output=json` (API). Historico completo, inclui subdominios internos que vazaram em certificados.
- **Censys Search** — `names: alvo.com` filtra por certificado.
- **cert.sh / tls.bufferover.run** — alternativas.

## DNS & Passive DNS
- **SecurityTrails** — historico de DNS, subdominios, IPs anteriores (revela origem atras de CDN). API gratuita limitada.
- **DNSDumpster / dnsdumpster.com** — mapa DNS visual, sem tocar o alvo.
- **VirusTotal** (Relations) — subdominios e resolucoes observadas.
- **Registros:** MX (provedor de email), TXT (SPF/DKIM revela fornecedores SaaS), NS.

## ASN / BGP / Netblocks
Descobrir as faixas de IP proprias da organizacao (nao as do CDN):
- **bgp.he.net** (Hurricane Electric) — busca por nome de org -> ASN -> prefixos.
- **whois.cymru.com** — IP -> ASN rapido.
- **amass intel -org "Nome"** — automatiza ASN por org.

## Search Engine Dorks (Google / Bing)
```
site:alvo.com -www                          # subdominios/paginas indexadas
site:alvo.com ext:pdf|xls|doc|txt|env|sql   # arquivos expostos
site:alvo.com inurl:admin|login|dashboard   # paineis
site:alvo.com intitle:"index of"            # listagem de diretorio
site:pastebin.com alvo.com                  # vazamentos em paste sites
site:trello.com|s3.amazonaws.com alvo       # dados em servicos publicos
```

## GitHub / GitLab Dorks (segredos e codigo)
Buscar no code search da plataforma:
```
"alvo.com" password
"alvo.com" api_key OR apikey OR secret
org:NomeDaOrg filename:.env
"alvo.com" AWS_SECRET OR aws_access_key_id
"alvo.internal"                             # hostnames internos vazados
```
Ferramentas: **trufflehog** (`github --org=`), **gitleaks**, **github-search**. Checar tambem **commits antigos** e **repos de funcionarios** (perfis).

## Servicos indexados (banners sem escanear)
- **Shodan** — `hostname:alvo.com`, `org:"Nome"`, `ssl:alvo.com`, `http.title:"..."`. Mostra portas/servicos/versoes ja coletados.
- **Censys** — services e certificados; bom para cloud.
- **Fofa / ZoomEye / Netlas** — alternativas, uteis fora dos EUA.
- **Uso tipico:** achar servico exposto (RDP, DB, painel) sem enviar um pacote voce mesmo.

## Wayback / Arquivos (endpoints historicos)
- **web.archive.org** — versoes antigas revelam endpoints/parametros removidos mas ainda ativos.
- **gau / waybackurls** — automatizam a coleta.
- **URLScan.io** — buscas por dominio, screenshots, requests observados.

## Cloud & Buckets
- **cloud_enum**, **s3scanner** — buckets S3/GCS/Azure por nome/permutacao do alvo.
- Dorks: `site:s3.amazonaws.com alvo`, `site:blob.core.windows.net alvo`.
- Buckets abertos = vazamento de dados classico.

## Pessoas / Email / Org (com etica)
So dentro de engajamento autorizado (ex.: assessment de engenharia social com escopo):
- **hunter.io / phonebook.cz** — padroes e enderecos de email corporativo.
- **LinkedIn / theHarvester** — nomes, cargos, emails (`theHarvester -d alvo.com -b all`).
- **Nota:** OSINT de pessoas fora de escopo autorizado nao se faz. Nada de stalking.

## Dados de vazamento (breach data)
- **Have I Been Pwned** — verificar se dominio/email aparece em vazamento (uso defensivo legitimo).
- **Nota legal/etica:** consultar exposicao propria e legitimo; usar credencial vazada para acessar conta alheia e crime. Recon so identifica a exposicao — nao a explora.

---

## Correlacao — o que fazer com as fontes

O valor nao esta em coletar, e em **cruzar**:
1. crt.sh + subfinder -> lista ampla de subdominios.
2. dnsx -> quais resolvem; SecurityTrails -> IP de origem atras do CDN.
3. Shodan no IP de origem -> servico/porta expostos que o CDN escondia.
4. Wayback -> endpoint `/api/v1/` antigo naquele host.
5. GitHub dork -> chave que autentica naquele `/api`.
6. Resultado: uma cadeia de hipotese pronta para `app-pentest`/`bug-bounty`.
