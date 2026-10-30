# MVP vs Scale

Quando simplificar, quando investir em complexidade. Framework de maturidade para decisões arquiteturais.

---

## Table of Contents

1. [Estágios de Maturidade](#1-estagios-de-maturidade)
2. [O Que Muda por Estágio](#2-o-que-muda-por-estagio)
3. [MVP — Regras de Ouro](#3-mvp--regras-de-ouro)
4. [Produto Validado — O Que Investir](#4-produto-validado--o-que-investir)
5. [Escala — Quando Complexificar](#5-escala--quando-complexificar)
6. [Anti-Patterns por Estágio](#6-anti-patterns-por-estagio)
7. [Checklist por Estágio](#7-checklist-por-estagio)

---

## 1. Estágios de Maturidade

| Estágio | Sinal | Foco | Timeline Típico |
|---|---|---|---|
| **Ideia** | "Tenho uma ideia, quero testar" | Validar se alguém quer isso | 1-2 semanas |
| **MVP** | "Preciso de algo funcional para testar com users reais" | Feature core funcionando, feedback loop | 2-6 semanas |
| **Validado** | "Tenho usuários pagantes / métricas de tração" | Qualidade, confiabilidade, features secundárias | 2-6 meses |
| **Crescimento** | "Estou crescendo, preciso escalar time e infra" | Performance, processos, onboarding de devs | 6-18 meses |
| **Escala** | "Tenho 10k+ usuários ou requisitos enterprise" | Resiliência, observabilidade, SLAs | Ongoing |

---

## 2. O Que Muda por Estágio

### Infra

| Aspecto | Ideia/MVP | Validado | Crescimento | Escala |
|---|---|---|---|---|
| **Deploy** | PaaS (Railway, Render) | Forge/Docker | Docker + CI/CD | K8s / managed containers |
| **DB** | SQLite / managed free | PostgreSQL managed | PostgreSQL + read replicas | Cluster + sharding |
| **Cache** | Nenhum | Redis básico | Redis + strategy | Redis cluster + CDN |
| **Queue** | Síncrono | Laravel Queues | Workers dedicados | Workers auto-scaling |
| **Monitoring** | `dd()` / logs | Sentry | Sentry + Pulse/Grafana | OpenTelemetry + alertas |
| **Backup** | Nenhum | Diário automatizado | Diário + ponto no tempo | Contínuo + multi-region |

### Código

| Aspecto | Ideia/MVP | Validado | Crescimento | Escala |
|---|---|---|---|---|
| **Arquitetura** | Monolith | Monolith organizado | Modular monolith | Modular + serviços |
| **Testes** | Manuais | Testes de feature core | Suite completa, CI | Testes + load testing |
| **Code review** | Sozinho | PR casual | PR obrigatório | PR + linting + gates |
| **Documentação** | README | ADRs + README | ADRs + API docs | Tudo + runbooks |
| **Environments** | Local + prod | Local + prod | Local + staging + prod | Local + dev + staging + prod |

### Time

| Aspecto | Ideia/MVP | Validado | Crescimento | Escala |
|---|---|---|---|---|
| **Tamanho** | Solo ou dupla | 2-5 devs | 5-15 devs | 15+ devs |
| **Processo** | "O que precisa?" | Kanban simples | Scrum/Kanban | Processo formal |
| **Deploy** | Manual | Semi-auto | CI/CD | CI/CD + feature flags |

---

## 3. MVP — Regras de Ouro

### 3.1 O Objetivo do MVP

> Descobrir se alguém quer o que você está construindo, no menor tempo possível.

Não é: construir o produto perfeito.
Não é: provar que você sabe arquitetar.
É: **aprender rápido**.

### 3.2 Regras

**1. Use o que você sabe.**
Não é hora de aprender novo framework. Use sua stack principal.

**2. Um banco, um server, um deploy.**
SQLite ou PostgreSQL managed. Uma instância. PaaS.

**3. Sem microservices, sem event sourcing, sem Kubernetes.**
Se precisar de queue, use o mais simples possível (Laravel Queues com DB driver).

**4. Monorepo, monolith, mono-tudo.**
Um repo, uma aplicação, um deploy command.

**5. Features descartáveis.**
O código do MVP provavelmente será reescrito. Optimize para velocidade, não manutenibilidade.

**6. Mobile? PWA primeiro.**
Web responsivo resolve para validação. App nativo depois que validar.

**7. Auth simples.**
Laravel Breeze ou Supabase Auth. Não implemente auth custom.

**8. Sem otimização prematura.**
Performance "boa o suficiente" para 100 usuários é suficiente para MVP.

### 3.3 Stack MVP Recomendada (Dev Laravel)

```
Backend:  Laravel + SQLite (dev) / PostgreSQL managed (prod)
Frontend: Blade + Livewire (ou Inertia.js + Vue se preferir SPA)
Auth:     Laravel Breeze
Deploy:   Railway ou Render
Mobile:   Web responsivo (não faça app nativo no MVP)
Payment:  Stripe (se precisar) com Laravel Cashier
```

**Timeline: 2-4 semanas até o primeiro deploy.**

---

## 4. Produto Validado — O Que Investir

### 4.1 Sinais de que Você Saiu do MVP

- Usuários pagantes ou métricas consistentes de uso
- Feedback pedindo features que não foram planejadas
- Bugs impactando experiência do usuário
- Você está com medo de fazer deploy

### 4.2 O Que Investir Agora

**Confiabilidade:**
- Error monitoring (Sentry)
- Backup automatizado do banco
- CI/CD pipeline (tests automáticos antes do deploy)
- Environment de staging

**Qualidade de código:**
- Testes para features core
- Code review (mesmo se sozinho — review seus próprios PRs no dia seguinte)
- Linting automatizado

**Operacional:**
- PostgreSQL managed (saia do SQLite se ainda estiver)
- Redis para cache e sessions
- Queue workers para jobs pesados
- HTTPS, rate limiting, CORS

**Documentação:**
- ADRs para decisões técnicas
- README atualizado
- API documentation (se tiver API pública)

### 4.3 O Que NÃO Investir Ainda

- Microservices
- Kubernetes
- Multi-region deploy
- GraphQL
- Event sourcing
- Feature flags complexos
- Canary deployments

---

## 5. Escala — Quando Complexificar

### 5.1 Complexifique Apenas Quando Dói

Cada complexidade adicionada tem custo operacional. Só adicione quando o problema é **real e mensurável**, não teórico.

| Problema Real | Solução |
|---|---|
| Queries lentas (> 500ms) | Índices, cache, read replicas |
| Deploy demora 30min | CI/CD pipeline, build cache |
| Página carrega > 3s | CDN, lazy loading, cache HTTP |
| Queue backup crescendo | Workers dedicados, priorização |
| Múltiplos times bloqueando deploy | Modular monolith, deploy por módulo |
| 1000+ req/s no pico | Horizontal scaling, load balancer |
| Dados em múltiplas regiões | Multi-region DB, CDN edge |

### 5.2 Progressão de Escala

```
Stage 1: Vertical scaling
  → Máquina maior. Frequentemente resolve tudo.

Stage 2: Cache
  → Redis, CDN, HTTP caching. 80% dos reads desaparecem.

Stage 3: Read replicas
  → Separa reads de writes no banco. Fácil com PostgreSQL.

Stage 4: Queue workers
  → Tira processamento pesado do request cycle.

Stage 5: Horizontal scaling
  → Múltiplas instâncias + load balancer.

Stage 6: Service extraction
  → Extrai componentes com escala diferente (ex: processamento de imagem).

Stage 7: Microservices (se necessário)
  → Raramente necessário. A maioria dos produtos para no Stage 3-5.
```

---

## 6. Anti-Patterns por Estágio

### MVP Anti-Patterns

| Anti-Pattern | Por que é ruim |
|---|---|
| Kubernetes para 10 usuários | Semanas de setup, zero benefício |
| Microservices no dia 1 | Complexidade sem entender o domínio |
| "Vamos fazer direito desde o início" | MVP é para aprender, não para durar |
| Escolher tech porque "escala" | Você não precisa escalar ainda |
| Não deploiar | MVP no localhost não é MVP |

### Produto Validado Anti-Patterns

| Anti-Pattern | Por que é ruim |
|---|---|
| Sem testes com users pagantes | Um bug pode matar receita |
| Sem backup de banco | Desastre é questão de tempo |
| Sem monitoring | Você só descobre problemas pelo Twitter |
| Reescrever tudo "direito" | Migre incrementalmente, não reescreva |
| Ignorar tech debt completamente | Velocidade de feature vai degradar |

### Escala Anti-Patterns

| Anti-Pattern | Por que é ruim |
|---|---|
| Otimizar sem profiling | Otimizando a coisa errada |
| Microservices por política | Cada time quer "seu" serviço |
| Ignorar custo de infra | Cloud bills surpreendem |
| Rewrite em nova linguagem | Raramente vale o custo |

---

## 7. Checklist por Estágio

### Ideia → MVP

- [ ] Feature core definida (1-3 features, não mais)
- [ ] Stack escolhida (use o que sabe)
- [ ] Repo criado
- [ ] Deploy em PaaS funcionando
- [ ] Auth básica
- [ ] Primeiro usuário real testando
- [ ] Feedback loop estabelecido

### MVP → Validado

- [ ] Error monitoring instalado (Sentry)
- [ ] Backup de banco automatizado
- [ ] CI/CD pipeline (build + test + deploy)
- [ ] Staging environment
- [ ] Testes para happy path das features core
- [ ] PostgreSQL managed (se ainda SQLite)
- [ ] HTTPS em produção
- [ ] Rate limiting em endpoints públicos

### Validado → Crescimento

- [ ] Modular monolith (se codebase > 50k LOC)
- [ ] Redis para cache e sessions
- [ ] Queue workers para jobs > 5s
- [ ] Load testing feito
- [ ] Monitoring dashboard (Pulse, Grafana)
- [ ] ADRs para decisões arquiteturais
- [ ] Onboarding doc para novos devs
- [ ] Code review obrigatório

### Crescimento → Escala

- [ ] Horizontal scaling testado
- [ ] CDN para assets estáticos
- [ ] Read replicas configuradas
- [ ] Alertas automatizados
- [ ] Runbooks para incidentes
- [ ] Feature flags para rollout gradual
- [ ] APM (Application Performance Monitoring)
- [ ] SLAs definidos e monitorados
