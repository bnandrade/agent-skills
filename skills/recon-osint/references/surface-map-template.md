# Template — Mapa de Superficie de Ataque

O entregavel da Fase 5. E o que alimenta `app-pentest` (app propria) ou `bug-bounty` (alvo externo). Output em PT-BR; dominios/comandos no original.

---

```markdown
# Mapa de Superficie — <Alvo / Organizacao>

- **Data:** <YYYY-MM-DD>
- **Seed:** <dominio(s) raiz / org / ASN>
- **Escopo autorizado:** <in-scope; ex.: *.alvo.com>
- **Fora de escopo:** <out-of-scope; NAO tocar>
- **Autorizacao:** <infra propria / contrato / bug bounty (programa) / lab>
- **Trilha executada:** <so passivo | passivo + ativo>

## Resumo

<2-4 frases: tamanho da superficie (N subdominios, M vivos), tecnologias predominantes, e as exposicoes mais quentes a olhar primeiro.>

| Metrica | Qtd |
|---|---|
| Subdominios descobertos | 0 |
| Hosts vivos (HTTP) | 0 |
| Portas/servicos notaveis | 0 |
| Quick wins identificados | 0 |

## Quick Wins (prioridade imediata)

O que vale testar/reportar primeiro, com o porque:

| # | Achado | Ativo | Por que importa | Handoff |
|---|---|---|---|---|
| 1 | Subdomain takeover candidato | blog.alvo.com | CNAME -> servico nao-reclamado | confirmar + reportar |
| 2 | `.git` exposto | app.alvo.com/.git | codigo-fonte vazando | app-pentest |
| 3 | Staging sem auth | staging.alvo.com | ambiente de teste publico | bug-bounty |
| 4 | Chave em JS/repo | — | credencial valida? | validar (nao abusar) |

## Ativos Vivos

| Host | IP / ASN | Status | Titulo | Tecnologia / Versao | CVE candidata | Notas |
|---|---|---|---|---|---|---|
| app.alvo.com | 1.2.3.4 / ASxxx | 200 | Login | nginx 1.18, Laravel | — | painel de login |
| api.alvo.com | 1.2.3.5 | 401 | — | — | — | API autenticada |

## Portas & Servicos (se ativo autorizado)

| Host/IP | Porta | Servico | Versao | Notas |
|---|---|---|---|---|
| 1.2.3.4 | 443 | https | nginx 1.18 | — |
| 1.2.3.6 | 3306 | mysql | 8.0 | DB exposto? verificar |

## Endpoints & Parametros Interessantes

Superficie web para a fase de exploracao:
- `POST /api/v1/login` — param `email`, `password` (auth)
- `GET /api/v1/users/{id}` — candidato a IDOR/BOLA (-> app-pentest/bug-bounty)
- `/admin`, `/swagger`, `/graphql` — paineis/superficie de API
- Endpoints extraidos de JS: <lista>
- URLs historicas (Wayback) ainda vivas: <lista>

## Exposicoes / Segredos (tratar com urgencia)

- [ ] Segredo vazado em repo publico -> <onde> -> **rotacionar (proprio) / reportar (autorizado)**
- [ ] Bucket aberto -> <url>
- [ ] `.env` / `.git` / backup exposto -> <url>

## Out-of-Scope (registrado, NAO interagir)

- <hosts fora do escopo encontrados no recon — anotados para nao tocar>

## Handoff

- **Para `app-pentest`** (se app propria): <hosts/endpoints a auditar em profundidade>
- **Para `bug-bounty`** (alvo externo): <quick wins priorizados para exploracao dentro do escopo>
- **Para `infra-specialist`** (se propria infra): <exposicoes a fechar — servico exposto, staging publico>
```

---

## Notas de uso

- **Priorizar sempre** — o mapa nao e um dump. Os Quick Wins no topo sao o que gera valor.
- **Marcar out-of-scope explicitamente** para nao tocar por engano depois.
- **Exposicoes criticas** (chave, takeover, `.git`) sobem para o topo e sao sinalizadas na hora, sem esperar o mapa fechar.
- **Onde salvar:** perguntar ao Bruno. Sugestao: `docs/security/recon-<alvo>-<data>.md` ou so exibir no chat.
