---
name: bug-bounty
description: Workflow de caca em programas de bug bounty (alvos externos COM escopo autorizado) — do escopo ao report que paga. Cobre escolher programa por ROI, ler e respeitar escopo/regras/safe-harbor, priorizar alvos, cacar os bugs que mais pagam (IDOR/BOLA, account takeover, SSRF, RCE, auth bypass, business logic), avaliar impacto e severidade (CVSS), triagem/deduplicacao, e escrever o relatorio que o triador aceita rapido (HackerOne/Bugcrowd/Intigriti/YesWeHack). Consome o mapa de superficie da recon-osint e reusa a metodologia de exploracao do app-pentest. Triggers em "bug bounty", "cacar bug em programa", "escrever report de bounty", "isso vale bounty?", "qual programa escolher", "esse escopo permite?", "reportar vulnerabilidade", "maximizar o bounty", "triagem de bounty", "HackerOne", "Bugcrowd". NAO use para: recon/enumeracao (use recon-osint); auditar/blindar app propria (use app-pentest); atacar LLM/agente (use llm-ai-security); testar alvo SEM programa/escopo autorizado (nao e bug bounty — parar).
metadata:
  author: Bruno Andrade
  version: 1.0.0
---

# Bug Bounty

O **oficio e o negocio** de caçar vulnerabilidades em programas de bug bounty. Esta skill nao ensina a explorar uma vulnerabilidade do zero — isso vem emprestado do [`app-pentest`](../app-pentest/references/owasp-attack-catalog.md) (metodologia) e da [`recon-osint`](../recon-osint/SKILL.md) (superficie). O que ela cobre e o que e **unico do bounty**: escolher o programa certo, respeitar o escopo a risca, priorizar alvos por retorno, provar impacto, e **escrever o relatorio que efetivamente paga**.

Verdade central do metier: **voce nao e pago por achar o bug — e pago por comunica-lo de forma que o triador entenda, reproduza e valorize.** Um bug excelente com report ruim vira N/A. Um bug medio com report impecavel e impacto bem demonstrado paga. O report e o produto.

## Autorizacao — o programa e o escopo sao a lei

Bug bounty e autorizado **por definicao** — mas so dentro do escopo e das regras do programa. E ai que mora a linha legal e a diferenca entre pesquisador e criminoso:

- **So existe bounty se existe programa.** Sem um programa publico/privado que autorize, testar um alvo de terceiro nao e bug bounty — e ataque. Se nao ha programa, **parar**.
- **In-scope apenas.** Todo ativo que voce toca precisa estar listado como in-scope. Out-of-scope nao se toca, mesmo que o recon revele e mesmo que pareca vulneravel.
- **Regras do programa sao inegociaveis.** Cada programa proibe coisas: DoS, automated scanning, engenharia social, testar contas reais de terceiros, exfiltrar dados alem do minimo para PoC. Ler ANTES de testar.
- **Safe harbor.** Programas serios oferecem safe harbor (protecao legal para pesquisa de boa-fe dentro das regras). Fora das regras, nao ha protecao.
- **PoC minima e nao-destrutiva.** Provar o impacto com o menor toque possivel. Nunca apagar/alterar dados reais, nunca acessar mais do que o necessario para demonstrar.

Se nao ha programa e escopo confirmados, esta skill nao avanca para hunting.

## Principios Fundamentais

1. **O report e o produto.** O bounty paga a comunicacao, nao a descoberta. Invista no report tanto quanto na caça.
2. **Impacto paga, nao a vulnerabilidade.** Um "self-XSS" vale quase nada; o mesmo XSS que sequestra a sessao de um admin vale muito. Sempre demonstrar o **pior caso realista dentro das regras**.
3. **Escopo e lei — e te mantem legal e nao-banido.** A tentacao de tocar um out-of-scope "so pra confirmar" ja queimou muita conta. Nao vale.
4. **First-to-report leva tudo.** Dedup e brutal: o segundo a reportar o mesmo bug ganha zero. Dai a importancia de recon amplo, velocidade, e alvos menos obvios.
5. **Qualidade > quantidade.** Signal/reputacao nas plataformas importa. Spray de reports fracos (N/A, informational) derruba sua conta e seu acesso a programas privados. Reportar so o que e real e reproduzivel.
6. **Onde ha menos olhos, ha mais bugs.** Todo mundo testa o dominio principal. O dinheiro esta no subdominio esquecido, na API nova, na feature recem-lancada, no ativo que so o seu recon mapeou.
7. **Relacionamento com o programa e ativo de longo prazo.** Reports claros, severidade honesta (sem inflar), sem brigar com o triador -> convites privados, que pagam mais e tem menos concorrencia.

## Quando usar esta skill

Usa quando:
- Bruno quer caçar em um programa de bounty (do zero: escolher programa -> ao report).
- Ha um achado e a pergunta e "isso vale bounty? como reporto pra maximizar?".
- Precisa avaliar se um alvo/acao esta dentro do escopo e das regras.
- Precisa escrever/revisar um report para submeter numa plataforma.
- Triagem: decidir se um achado e novo, in-scope e reportavel (vs duplicado/N/A).

NAO usar quando:
- O objetivo e **descobrir a superficie** (subdominios, portas, tecnologias) -> `recon-osint`.
- O objetivo e **auditar/blindar uma app propria** -> `app-pentest`.
- O objetivo e **atacar um LLM/agente** -> `llm-ai-security`.
- **Nao ha programa/escopo** que autorize o alvo -> parar (nao e bounty).
- A duvida e puramente "como explorar tecnicamente um XSS/IDOR" -> consultar o `owasp-attack-catalog.md` do `app-pentest`; esta skill cuida do workflow de bounty ao redor disso.

## Protocolo de Bounty (9 fases)

### Fase 0 — Confirmar programa e escopo
Existe um programa (publico ou privado) que autoriza o alvo? Se nao, parar. Se sim, seguir.

### Fase 1 — Selecionar o programa (ROI)
Escolher onde investir tempo. Criterios em `references/program-selection.md`: amplitude do escopo, faixa de payout, responsividade/tempo de triagem, maturidade (quanto mais testado, menos fruta baixa), VDP (so reconhecimento) vs pago. Melhor um programa com escopo amplo e recem-lancado que um maduro e superlotado.

### Fase 2 — Dominar escopo e regras
Ler o brief inteiro: in-scope, out-of-scope, o que e proibido (DoS, scanning, social), o que da mais bonus, como querem o report, safe harbor. Rodar `scripts/scope-check.sh` para filtrar a lista do recon e nunca tocar out-of-scope por engano.

### Fase 3 — Recon (handoff da recon-osint)
Levantar a superficie com a skill `recon-osint` (mapa de superficie de ataque). Filtrar por in-scope. Priorizar os ativos que o recon revelou e que provavelmente tem menos olhos.

### Fase 4 — Priorizar alvos por ROI
Nem tudo vale testar. Focar onde ha (a) mais superficie nova, (b) mais impacto potencial, (c) menos concorrencia. Feature nova > core estavel; API > site institucional; funcionalidade autenticada com multiplos papeis > pagina publica.

### Fase 5 — Hunting (reusa app-pentest + high-value-bugs)
Caçar os bugs que pagam. A **tecnica** de exploracao vem do `owasp-attack-catalog.md` (app-pentest); a **priorizacao por retorno e impacto** esta em `references/high-value-bugs.md`: IDOR/BOLA, account takeover (chains), SSRF (-> metadata/RCE), auth bypass, RCE, business logic, subdomain takeover, secrets vazados. Perseguir cadeias — o bounty grande vem de encadear.

### Fase 6 — Provar impacto e severidade
- **PoC solida, minima e reproduzivel** (dentro das regras). Screenshots/video curtos ajudam.
- **Severidade CVSS** honesta. Calcular o vetor; nao inflar (inflar queima reputacao e vira downgrade).
- **Impacto de negocio:** o que o atacante realmente ganha? E o que eleva o bounty — demonstrar o pior caso plausivel, nao o teorico.

### Fase 7 — Triagem / dedup (e reportavel?)
Antes de submeter, checar: e in-scope? e novo (nao um duplicado obvio nem um informational conhecido)? tem impacto real (nao "best practice")? Se e so hardening sem exploracao, provavelmente vira N/A — nao reportar como vulnerabilidade.

### Fase 8 — Escrever e submeter o report
Usar `references/report-template.md`. O report que paga: titulo claro com impacto, severidade, passos reproduziveis numerados, PoC, secao de impacto que justifica a severidade, e remediacao. Escrever para o triador: claro, factual, sem exagero, sem encher linguica.

### Fase 9 — Disclosure e follow-up
- Responder o triador com agilidade e cordialidade; fornecer info extra se pedirem.
- Lidar com duplicado/N/A sem brigar (pedir esclarecimento educado, aprender, seguir).
- **Responsible disclosure:** nao divulgar publicamente antes do fix e do aval do programa. Disclosure coordenado preserva reputacao e safe harbor.

## Vetores por retorno (mapa — detalhe nos references)

O quanto costuma pagar e onde vira N/A. Detalhe operacional em `high-value-bugs.md`; a tecnica de exploracao, no `owasp-attack-catalog.md` do app-pentest.

| Vetor | Tipico | Como maximizar o bounty | Vira N/A/baixo quando |
|---|---|---|---|
| **RCE** | 🔴 Critico | Provar execucao (comando inofensivo), mapear alcance | so teorico, sem PoC |
| **Account Takeover** | 🔴 Critico | Cadeia completa ate assumir a conta de outro | requer interacao improvavel |
| **IDOR / BOLA** | 🟠 Alto | Mostrar acesso a dado sensivel de outro usuario | objeto nao-sensivel / mesmo usuario |
| **SSRF** | 🟠 Alto | Escalar para metadata cloud / interno / RCE | SSRF "cego" sem impacto demonstravel |
| **Auth bypass** | 🟠 Alto | Acesso sem credencial a area restrita | rota sem dado sensivel atras |
| **SQLi** | 🟠 Alto | Extrair prova minima (versao/1 registro) | so erro, sem extracao |
| **Business logic** | varia | Quantificar perda (dinheiro, cota, fraude) | "esquisito" sem impacto |
| **Subdomain takeover** | 🟡 Medio+ | Provar controle do subdominio | CNAME orfao sem claim possivel |
| **XSS** | 🟡 Medio | Stored + roubo de sessao/acao de admin | self-XSS, ou sem impacto |
| **Secrets vazados** | varia | Provar validade e alcance (sem abusar) | chave de teste/revogada |

## Regras de Output

1. **O report segue o template** (`report-template.md`) e e escrito para o triador — claro, reproduzivel, factual.
2. **Severidade honesta.** Calcular CVSS e justificar. Nunca inflar; recomendar o downgrade se for o caso.
3. **Impacto sempre quantificado** — "acesso ao PII de qualquer usuario via IDOR em /api/x" > "IDOR encontrado".
4. **PoC minima e nao-destrutiva**, com passos numerados que qualquer um reproduz.
5. **Sinalizar dedup/escopo** — antes de sugerir submeter, confirmar in-scope e checar risco de duplicado/N/A.
6. **Tom profissional no follow-up** — nunca hostil com o triador, mesmo em duplicado/N/A injusto.
7. **Output em PT-BR** (o report final pode ser redigido em ingles se o programa exigir — perguntar).

## Regras Criticas

- **NUNCA teste sem programa e escopo confirmados.** Sem programa, nao e bounty — parar.
- **NUNCA toque out-of-scope**, mesmo que o recon revele e pareca vulneravel.
- **NUNCA viole as regras do programa** (DoS, scanning proibido, dados reais de terceiros, social fora de escopo).
- **NUNCA exfiltre alem do minimo** necessario para a PoC. Um registro prova; um dump e crime.
- **NUNCA infle severidade** — queima reputacao e derruba o proprio report.
- **NUNCA divulgue publicamente** antes do fix e do aval (responsible/coordinated disclosure).
- **SEMPRE reuse recon-osint (superficie) e app-pentest/owasp-catalog (tecnica)** — esta skill nao reimplementa nenhum dos dois.
- **SEMPRE priorize alvos com menos olhos** (novo/esquecido) — e onde o first-to-report acontece.

## Calibracao — casos de referencia

### IDOR em API como primeiro bounty — paradigma de bom ROI
Recon revela `api-v2.alvo.com` (subdominio novo, in-scope, pouca gente testou). Endpoint `GET /api/v2/users/{id}/documents` retorna documentos de qualquer usuario trocando o ID. Impacto: vazamento de PII em massa. Report: passos numerados com 2 contas de teste, CVSS alto honesto, impacto quantificado. **O ativo novo do recon + IDOR + report claro = bounty pago rapido.**

### O que NAO reportar — evitar o N/A
"Falta header CSP", "cookie sem flag Secure em pagina publica sem sessao", "auto-XSS que so afeta a propria vitima". Sao hardening/informational sem exploracao -> viram N/A e gastam signal. Segurar e so reportar o que tem impacto demonstravel.

### Cadeia que multiplica o bounty
Open redirect (baixo sozinho) + OAuth mal configurado -> roubo de token -> account takeover (critico). O valor esta em **encadear** um low com outro para chegar em impacto critico. Sempre perguntar "aonde este bug pequeno me leva se eu encadear?".
