---
name: recon-osint
description: Reconhecimento e enumeracao (recon/OSINT) — a fase 1 de todo pentest ou bug bounty: descobrir e mapear a superficie de ataque de um alvo autorizado antes de testar qualquer coisa. Cobre recon passivo (OSINT de fontes publicas: certificados/crt.sh, DNS, ASN/BGP, Wayback, Google/GitHub dorks, Shodan/Censys, segredos vazados) e recon ativo (enumeracao de subdominios, hosts vivos, portas, servicos, fingerprint de tecnologia, crawling de endpoints e parametros). Produz um mapa de superficie que alimenta as skills app-pentest e bug-bounty. Triggers em "faz recon do alvo", "enumera os subdominios", "mapeia a superficie de ataque", "descobre os ativos", "reconhecimento", "osint", "quais portas/servicos estao expostos", "fingerprint da stack", "o que meu dominio expoe". NAO use para: explorar/testar vulnerabilidade (use app-pentest na app propria, ou bug-bounty em alvo externo com escopo); hardening/config de servidor (use infra-specialist); recon de alvo sem autorizacao nem escopo (ver Fase 0).
metadata:
  author: Bruno Andrade
  version: 1.0.0
---

# Recon & OSINT

Reconhecimento e enumeracao: a **fase 1 de todo pentest e bug bounty**. Antes de atacar qualquer coisa, voce mapeia o terreno — descobre todos os ativos do alvo, quais estao vivos, o que rodam, e onde estao os pontos interessantes. **O resultado e um mapa de superficie de ataque** que alimenta as demais skills da familia (`app-pentest`, `bug-bounty`).

Maxima do oficio: **o pentest se ganha no recon**. Quem enxerga mais superficie encontra mais caminhos. Um subdominio esquecido, um endpoint de API antigo, uma chave num commit publico — e por ai que se entra, nao pela porta da frente que todos ja testaram.

Esta skill separa com rigor **recon passivo** (nao toca o alvo — so consulta fontes publicas) de **recon ativo** (envia trafego ao alvo — exige autorizacao). Essa distincao nao e detalhe: e a linha legal.

## Autorizacao — leia antes de qualquer coisa

Recon **ativo** (enviar qualquer pacote ao alvo: resolver, escanear porta, crawl, brute de subdominio via DNS do alvo) so ocorre dentro de um destes contextos:

1. **Infra propria** — dominio/host/app do Bruno. (Caso padrao para "o que eu exponho?".)
2. **Autorizacao escrita** — contrato de pentest / rules of engagement.
3. **Escopo de bug bounty** — o programa lista aquele alvo como *in-scope*. Respeitar o escopo a risca: fora do escopo nao se toca (nao paga e pode banir).
4. **Laboratorio** — ambiente proprio, CTF, THM/HTB.

Recon **passivo** (crt.sh, DNS publico, Shodan/Censys, Wayback, dorks, repos publicos) consulta terceiros, nao o alvo — risco legal baixo. Ainda assim, so com **proposito legitimo** (avaliar sua exposicao, ou um alvo autorizado). Nao use para stalking de pessoas nem para preparar ataque a terceiro sem escopo.

Regras inegociaveis:
- **Sem autorizacao e sem escopo, o recon ativo nao acontece.** Se o alvo nao e seu e nao ha escopo, fique so no passivo com proposito legitimo — ou pare.
- **Enumeracao e nao-destrutiva por natureza; mantenha assim.** Nada de brute agressivo que derrube servico. Rate limit e respeito ao escopo.
- **Respeite o escopo de bounty ao pe da letra** — wildcard `*.exemplo.com` inclui subdominios mas talvez exclua `pagamento.exemplo.com`. Ler as regras antes de resolver o primeiro host.

Se a Fase 0 nao confirmar autorizacao para ativo, a skill roda so a trilha passiva.

## Principios Fundamentais

1. **Recon e 80% do trabalho.** A exploracao e a ponta do iceberg. Ampliar a superficie descoberta multiplica os caminhos de ataque.
2. **Passivo antes de ativo.** Extraia o maximo de fontes publicas antes de enviar um pacote ao alvo. Mais silencioso, mais legal, e ja entrega metade do mapa.
3. **Ampliar antes de aprofundar.** Primeiro o mapa largo (todos os ativos), depois foco no que interessa. Nao afunile cedo demais — o ativo esquecido e o que ninguem testou.
4. **Escopo e lei.** So enumerar o que esta autorizado. Em bounty, tocar out-of-scope nao paga e queima o pesquisador.
5. **Documente tudo.** Recon gera o **mapa** que alimenta as fases seguintes. Achado nao anotado e achado perdido. O entregavel e o mapa de superficie, nao uma lista solta de comandos.
6. **Recon e continuo.** Alvos mudam: novos subdominios sobem, servicos aparecem. Re-recon periodico encontra o que estava fechado ontem.
7. **Correlacione, nao so colete.** Um subdominio + uma tecnologia com CVE + um endpoint no Wayback = uma hipotese de ataque. O valor esta na correlacao das fontes.

## Quando usar esta skill

Usa quando:
- Inicio de qualquer engajamento — antes de `app-pentest` ou `bug-bounty`, para levantar a superficie.
- Bruno pergunta "o que meu dominio/empresa expoe na internet?" (recon da propria pegada).
- Enumerar subdominios/hosts/portas/tecnologias de um alvo autorizado.
- Montar/atualizar o mapa de superficie de ataque de um programa de bounty.
- Descobrir ativos esquecidos (shadow IT, ambientes de staging expostos, buckets abertos).

NAO usar quando:
- O objetivo e **explorar** uma vulnerabilidade -> `app-pentest` (app propria) ou `bug-bounty` (alvo externo com escopo).
- O objetivo e **proteger/configurar** o servidor (firewall, SSL, DNS) -> `infra-specialist`.
- Nao ha **autorizacao nem escopo** para ativo -> so trilha passiva com proposito legitimo, ou parar.

## Protocolo de Recon (6 fases)

Segue em ordem. Passivo (Fases 1-2) sempre; ativo (Fases 3-5) so com autorizacao. O script `scripts/recon.sh` orquestra as ferramentas com fallback gracioso.

### Fase 0 — Escopo e autorizacao
- Definir o **seed**: dominio(s) raiz, organizacao, faixas de IP/ASN, ou a app-alvo.
- Determinar in-scope vs out-of-scope (ler as regras do programa de bounty, ou o contrato).
- Decidir a trilha: **so passivo** (sem autorizacao para ativo) ou **passivo + ativo**.

### Fase 1 — Recon passivo / OSINT (nao toca o alvo)
Colher tudo de fontes publicas. Detalhe operacional em `references/osint-sources.md` e `references/recon-playbook.md`:
- **Certificate Transparency** (crt.sh, Censys) — subdominios revelados por certificados.
- **DNS passivo** e registros historicos (SecurityTrails, DNSDumpster).
- **ASN / BGP / netblocks** — descobrir as faixas de IP da organizacao.
- **Wayback Machine / arquivos** — URLs, endpoints e parametros historicos (gau, waybackurls).
- **Google & GitHub dorks** — arquivos expostos, paineis, e **segredos em repos publicos** (chaves, `.env`, tokens).
- **Shodan / Censys / Fofa** — servicos e banners ja indexados, sem escanear voce mesmo.
- **Pegada da organizacao** — emails, tecnologias, provedores, buckets de cloud.

### Fase 2 — Descoberta de ativos
Consolidar a lista de ativos a partir do passivo + fontes:
- **Subdominios** — agregacao passiva (subfinder, amass -passive) + a lista dos certificados.
- **Resolucao** (dnsx) — quais subdominios resolvem, para quais IPs, CNAMEs (procurar **subdomain takeover**: CNAME apontando para servico nao-reclamado).
- **Deduplicar e organizar** por IP/ASN/tecnologia.

### Fase 3 — Hosts vivos & enumeracao ativa (so autorizado)
Agora envia-se trafego ao alvo:
- **Hosts vivos** (httpx) — quais respondem HTTP(S), com qual status, titulo, tecnologia, tamanho.
- **Portas e servicos** (naabu para varredura rapida; nmap para versao/servico nos alvos relevantes). Rate limit consciente.
- **Fingerprint** — servidor, framework, CMS, WAF, versoes (httpx, whatweb, wappalyzer). Cruzar versoes com CVEs conhecidas.

### Fase 4 — Mapeamento de superficie web
Para cada host web vivo, mapear a superficie testavel:
- **Crawling** (katana) + **URLs historicas** (gau/waybackurls) -> lista de endpoints.
- **Parametros** e formularios — entradas que a `app-pentest`/`bug-bounty` vai testar.
- **Arquivos JavaScript** — extrair endpoints de API, chaves, rotas escondidas (o front entrega o mapa do back).
- **Conteudo/diretorios** (ffuf, leve e autorizado) — paineis, backups, `.git`, `/api`, ambientes de staging.

### Fase 5 — Consolidar o mapa de superficie
Produzir o entregavel em `references/surface-map-template.md`:
- Ativos vivos, portas/servicos, tecnologias (com versoes e CVEs candidatas).
- Endpoints e parametros interessantes.
- **Quick wins** priorizados para testar (subdomain takeover, painel de login exposto, staging sem auth, `.git` exposto, chave vazada).
- **Handoff explicito** para `app-pentest` (se for app propria) ou `bug-bounty` (alvo externo).

## Catalogo de tecnicas & ferramentas (mapa — detalhe nos references)

Ferramentas padrao de mercado (2026). O `recon-playbook.md` traz os comandos.

| Objetivo | Passivo | Ativo |
|---|---|---|
| Subdominios | crt.sh, subfinder, amass -passive, SecurityTrails | amass (brute), dnsx (resolve), gobuster dns |
| Hosts vivos | Shodan, Censys | httpx |
| Portas/servicos | Shodan/Censys (banners indexados) | naabu, nmap |
| Tecnologia/versao | Wappalyzer (passivo), BuiltWith | httpx -tech-detect, whatweb |
| URLs/endpoints | gau, waybackurls, Wayback | katana (crawl) |
| Segredos | GitHub dorks, trufflehog/gitleaks em repo publico | — |
| Cloud/buckets | dorks, cloud_enum | — |
| Superficie geral | Google dorks, Fofa | ffuf (conteudo) |

> **ProjectDiscovery suite** (subfinder, dnsx, naabu, httpx, katana, nuclei) e a espinha dorsal recomendada — compoe bem em pipeline. O `recon.sh` degrada com elegancia se alguma nao estiver instalada.

## Regras de Output

1. **O entregavel e o mapa de superficie, nao um dump de comandos.** Sempre consolidar no formato do template, organizado e priorizado.
2. **Separar passivo de ativo no relato** — deixar claro o que foi so consulta publica e o que tocou o alvo.
3. **Priorizar quick wins.** Nao entregar 500 subdominios crus — destacar os 5-10 ativos que valem testar primeiro e por que.
4. **Correlacionar fontes** — "este subdominio (crt.sh) resolve para IP no ASN X, roda nginx 1.18 (CVE-Y candidata), tem `/api` no Wayback".
5. **Todo achado interessante vira hipotese de ataque** com handoff para a skill certa (`app-pentest`/`bug-bounty`).
6. **Sinalizar takeover e exposicoes** (subdomain takeover, `.git`, staging aberto, chave vazada) como alta prioridade imediata.
7. **Output em PT-BR.** Comandos/dominios no original.

## Regras Criticas

- **NUNCA faca recon ativo sem autorizacao ou escopo confirmado (Fase 0).** Sem isso, so passivo com proposito legitimo.
- **NUNCA toque alvo out-of-scope** em bounty — mesmo que apareca no recon. Anotar como out-of-scope e nao interagir.
- **NUNCA use enumeracao agressiva** que degrade o servico. Recon e silencioso e nao-destrutivo.
- **NUNCA use OSINT de pessoas para stalking** ou fora de um engajamento autorizado (ex.: assessment de engenharia social com escopo).
- **SEMPRE consolide no mapa de superficie** e faca handoff para a skill de exploracao.
- **SEMPRE destaque exposicoes criticas** (chave vazada, takeover, staging aberto) imediatamente, sem esperar o fim.
- **SEMPRE trate segredo vazado como incidente** — se for infra propria, rotacionar; se for alvo autorizado, reportar com urgencia.

## Calibracao — casos de referencia

### Recon da propria pegada do Bruno — paradigma defensivo
"O que meus dominios expoem?" (BHEN, gira-app, clientes). So passivo + ativo na propria infra. Objetivo: achar shadow IT, staging exposto, `.env`/`.git` publico, chave em repo, subdomain takeover. Handoff para `infra-specialist` (fechar exposicao) e `app-pentest` (testar o que sobrou).

### Recon de alvo de bug bounty — paradigma ofensivo autorizado
Programa com escopo `*.exemplo.com`. Fluxo: ler escopo -> passivo (crt.sh + subfinder + gau) -> resolver (dnsx) -> vivos (httpx) -> fingerprint + katana/JS -> consolidar quick wins. Respeitar out-of-scope. Handoff para `bug-bounty` priorizando os ativos menos obvios (staging, api antiga, subdominio recem-descoberto). O diferencial em bounty e a **amplitude** e a **continuidade** do recon.

### Subdomain takeover — o quick win classico
CNAME de `blog.alvo.com` aponta para um servico (Heroku/S3/GitHub Pages) nao mais reclamado. Sinalizar como alta prioridade: potencial takeover completo do subdominio. Confirmar com cuidado e reportar.
