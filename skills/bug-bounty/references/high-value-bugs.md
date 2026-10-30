# Bugs de Alto Valor — ROI, Impacto e Dedup

Complementa o `owasp-attack-catalog.md` do `app-pentest` (que ensina a **detectar e corrigir**) com o angulo do bounty: **quanto costuma pagar, como maximizar o impacto (e o bounty), e o que faz virar N/A ou duplicado**. A tecnica de exploracao esta no catalogo do app-pentest — aqui e sobre retorno.

Regra transversal: **o bounty acompanha o impacto demonstrado, nao a classe da vulnerabilidade.** Sempre suba a severidade demonstrando o pior caso realista dentro das regras.

---

## RCE (Remote Code Execution) — 🔴 topo da tabela
- **Por que paga:** controle do servidor. Quase sempre critico.
- **Maximizar:** provar execucao com comando **inofensivo** (`id`, `hostname`, um DNS callback para seu servidor). Mapear o alcance (o que da pra ler/acessar) sem exfiltrar dados reais.
- **Vira baixo/N/A:** RCE "teorico" sem PoC; ou em ambiente sandboxed sem impacto. Precisa de prova concreta e nao-destrutiva.

## Account Takeover (ATO) — 🔴 critico
- **Por que paga:** assumir a conta de outro usuario. Impacto direto e obvio.
- **Vetores comuns:** password reset furado (token previsivel/vazado/sem expiracao), OAuth mal configurado, JWT mal validado, 2FA bypass, response manipulation no login.
- **Maximizar:** demonstrar a cadeia completa ate logar como a vitima (com **duas contas suas** de teste, nunca de terceiros). Quanto menos interacao da vitima, maior o bounty.
- **Vira baixo:** exige phishing elaborado ou interacao improvavel da vitima.

## IDOR / BOLA — 🟠 o pao-com-manteiga do bounty
- **Por que paga:** acessar/alterar dados de outro usuario trocando um ID. Comum e de alto impacto em APIs.
- **Maximizar:** mostrar acesso a **dado sensivel** (PII, documentos, financeiro) de outro usuario; se for em massa/enumeravel, sobe a severidade. Duas contas de teste.
- **Vira baixo/N/A:** objeto nao-sensivel (ex.: ID de um item publico), ou "acesso" ao proprio dado. Sem sensibilidade, sem bounty.

## SSRF — 🟠 alto (com escalada)
- **Por que paga:** fazer o servidor requisitar alvos internos. O valor esta na **escalada**.
- **Maximizar:** escalar de SSRF "simples" para metadata cloud (`169.254.169.254` -> credenciais), servico interno, ou RCE. SSRF que le metadata da nuvem e frequentemente critico.
- **Vira baixo/N/A:** SSRF "cego" sem nenhum impacto demonstravel, ou so para URLs externas sem alcance interno.

## Auth Bypass / Broken Access Control — 🟠 alto
- **Por que paga:** acessar area restrita sem credencial ou como papel indevido (user -> admin).
- **Maximizar:** mostrar acesso a funcao/dado administrativo real. Escalada vertical (user vira admin) vale mais que horizontal.
- **Vira baixo:** rota "protegida" sem nada sensivel atras.

## SQL Injection — 🟠 alto
- **Por que paga:** acesso ao banco.
- **Maximizar:** extrair prova **minima** (versao do banco, um unico registro nao-sensivel, ou `current_user`). Nunca dumpar a base — um registro prova, um dump e crime e viola regras.
- **Vira N/A:** so mensagem de erro sem extracao comprovada.

## Business Logic — valor variavel, alto quando quantificavel
- **Por que paga:** abusar da regra de negocio (comprar por preco negativo, cupom infinito, pular pagamento, race condition financeira).
- **Maximizar:** **quantificar a perda** — "e possivel comprar qualquer item por R$0 via manipulacao do total no passo X". Dinheiro concreto = bounty concreto.
- **Vira N/A:** comportamento "esquisito" sem impacto financeiro/seguranca demonstravel.

## Subdomain Takeover — 🟡 medio+
- **Por que paga:** assumir um subdominio (CNAME orfao apontando para servico nao-reclamado).
- **Maximizar:** provar o controle (servir um arquivo seu no subdominio), sem hospedar conteudo abusivo. Explicar o impacto (phishing na marca, roubo de cookie de sessao do dominio pai).
- **Vira baixo/N/A:** CNAME orfao onde o servico nao permite reclamar (sem takeover real).

## XSS — 🟡 medio (depende do impacto)
- **Por que paga:** executar script no contexto da vitima.
- **Maximizar:** **stored** > reflected > DOM; demonstrar roubo de sessao ou acao privilegiada (ex.: XSS no painel que executa acao de admin). Contexto importa: XSS que atinge muitos/admin vale mais.
- **Vira N/A:** self-XSS (so a propria vitima), ou XSS sem nenhum impacto de sessao/acao.

## Secrets / Info Disclosure — variavel
- **Por que paga:** chave/credencial valida vazada (repo publico, JS, `.env`, resposta de API).
- **Maximizar:** provar que a chave **e valida e tem alcance** (ex.: chave de gateway que autentica) — sem abusar dela. Descrever o que um atacante faria.
- **Vira N/A:** chave de teste, revogada, ou de baixo privilegio; ou "informacao" sem sensibilidade.

---

## Cadeias — onde nasce o bounty grande

O maior retorno vem de **encadear** bugs pequenos ate um impacto critico. Sempre perguntar: *"aonde este bug pequeno me leva se eu combinar com outro?"*

Exemplos classicos:
- **Open redirect + OAuth** -> vazamento de token -> account takeover.
- **IDOR de leitura + IDOR de escrita** -> alterar dados de qualquer usuario.
- **SSRF + metadata cloud** -> credenciais AWS -> acesso a infra.
- **Info leak de ID/email + password reset fraco** -> ATO em massa.
- **XSS stored + CSRF** -> acao privilegiada automatica na vitima.

Um low + um low bem encadeados podem virar um critico — e o report deve contar essa historia de ponta a ponta.

---

## Antes de reportar — o filtro anti-N/A

Nao reporte como vulnerabilidade se for so isto (quase sempre viram N/A/informational e gastam seu signal):
- Missing security headers (CSP, HSTS) sem exploracao.
- Cookie sem flag `Secure`/`HttpOnly` em contexto sem sessao sensivel.
- Self-XSS; CSRF em acao sem impacto; rate limiting ausente sem consequencia.
- Disclosure de versao/banner; email enumeration sem impacto adicional.
- Qualquer coisa listada como out-of-scope ou nao-aceita no brief.

Se nao ha **impacto demonstravel**, e hardening — util num `app-pentest` proprio, mas nao e bounty.
