# Stack Catalog

Catálogo de tecnologias por camada, com trade-offs reais e recomendações por contexto.

---

## Table of Contents

1. [API / Backend](#1-api--backend)
2. [Web Frontend](#2-web-frontend)
3. [Mobile](#3-mobile)
4. [Database](#4-database)
5. [Cache & Queues](#5-cache--queues)
6. [Search](#6-search)
7. [Auth](#7-auth)
8. [File Storage](#8-file-storage)
9. [Payment & Billing](#9-payment--billing)
10. [Email & Notifications](#10-email--notifications)
11. [AI / LLM Integration](#11-ai--llm-integration)
12. [Infrastructure & Deploy](#12-infrastructure--deploy)
13. [Monitoring & Observability](#13-monitoring--observability)
14. [Pre-Built Stacks](#14-pre-built-stacks)

---

## 1. API / Backend

### PHP

| Framework | Best For | Strengths | Weaknesses |
|---|---|---|---|
| **Laravel** | Full-stack web, APIs, SaaS | Ecossistema completo (auth, queues, mail, billing), Eloquent ORM, comunidade enorme, excelente DX | Performance inferior a Go/Rust, memory per-request, hosting mais caro em escala |
| **Symfony** | Enterprise, projetos complexos | Componentes modulares, alta configurabilidade, padrões rigorosos | Curva de aprendizado, verboso, menor comunidade que Laravel |

### Python

| Framework | Best For | Strengths | Weaknesses |
|---|---|---|---|
| **Django** | Admin-heavy, CMS, data-intensive | Batteries-included, Django Admin, ORM maduro, ecossistema ML/AI | Monolítico, async limitado (melhorando), performance moderada |
| **FastAPI** | APIs modernas, async, ML serving | Async nativo, type hints, OpenAPI automático, performance boa | Ecossistema menor que Django, precisa montar mais peças |
| **Flask** | Microservices, APIs simples | Minimalista, flexível | Precisa montar tudo, não escala em complexidade |

### JavaScript / TypeScript

| Framework | Best For | Strengths | Weaknesses |
|---|---|---|---|
| **Next.js** | Full-stack web (React) | SSR/SSG/ISR, API routes, Vercel deploy, React ecosystem | Vendor lock-in (Vercel), complexidade crescente, não ideal para APIs puras |
| **NestJS** | APIs enterprise (Node) | Arquitetura opinativa (DI, modules), TypeScript nativo, similar a Angular | Overhead para APIs simples, learning curve |
| **Express/Fastify** | APIs simples, microservices | Minimalista, flexível, rápido | Precisa montar tudo, callback hell (Express) |
| **Hono** | Edge, APIs leves | Ultra-rápido, multi-runtime (Bun, Deno, Workers), tipado | Ecossistema jovem, menos batalha-testado |

### Go

| Framework | Best For | Strengths | Weaknesses |
|---|---|---|---|
| **stdlib (net/http)** | APIs, microservices, CLI | Sem dependência, performance excelente, concorrência nativa | Precisa montar mais peças, sem ORM nativo |
| **Gin/Echo/Fiber** | APIs REST com mais conveniência | Middleware ecosystem, routing, validation | Dependência extra sobre stdlib |

### Rust

| Framework | Best For | Strengths | Weaknesses |
|---|---|---|---|
| **Axum/Actix** | Performance crítica, systems programming | Performance máxima, memory safety, zero-cost abstractions | Curva de aprendizado severa, compilação lenta, ecossistema menor |

### Elixir

| Framework | Best For | Strengths | Weaknesses |
|---|---|---|---|
| **Phoenix** | Real-time (chat, live), alta concorrência | LiveView (real-time sem JS), BEAM VM (fault-tolerant), excelente para WebSocket | Ecossistema menor, hiring difícil, curva de aprendizado |

---

## 2. Web Frontend

| Technology | Best For | Strengths | Weaknesses |
|---|---|---|---|
| **React** | SPAs complexas, dashboards, apps interativos | Ecossistema imenso, hiring fácil, React Native para mobile | Precisa escolher muitas peças (routing, state, etc.) |
| **Vue** | SPAs, portais, admin panels | Curva suave, bom balanço opinativo/flexível, Nuxt para SSR | Ecossistema menor que React, menos jobs |
| **Svelte** | Apps performáticos, sites interativos | Compile-time, bundle pequeno, DX excelente | Ecossistema menor, comunidade menor, menos libraries |
| **HTMX** | Server-side apps com interatividade | Zero build step, funciona com qualquer backend, simples | Limitado para apps muito interativos, menos tooling |
| **Livewire** | Laravel full-stack | Zero JS, integração total com Laravel, produtividade máxima | Vendor lock-in (Laravel), limitado para UX complexa |
| **Inertia.js** | Laravel/Rails + React/Vue/Svelte | SPA sem API separada, routing server-side, excelente DX | Acoplado ao backend, SSR limitado |
| **Blade** | Laravel server-side | Zero config, templates simples, Livewire para interatividade | Não é SPA, menos interatividade client-side |

### Recomendação por contexto

| Contexto | Recomendação |
|---|---|
| Dev Laravel, MVP rápido | **Blade + Livewire** ou **Inertia.js + Vue/React** |
| SPA complexa, time React | **React + Vite** ou **Next.js** |
| Admin panel | **Vue + Vuetify** ou **Filament** (Laravel) |
| Landing page / marketing | **Astro** ou **HTML + HTMX** |
| Dashboard com muitos gráficos | **React + Recharts/Tremor** |

---

## 3. Mobile

| Technology | Best For | Strengths | Weaknesses |
|---|---|---|---|
| **React Native + Expo** | Cross-platform, time com React/JS | Uma codebase, OTA updates, Expo simplifica tudo, comunidade enorme | Performance não-nativa em cenários pesados, debugging complexo |
| **Flutter** | Cross-platform, UI customizada | Performance excelente, widget system consistente, uma codebase | Dart (linguagem menos popular), tamanho do app, ecossistema menor que RN |
| **Swift (iOS)** | iOS nativo, performance máxima | Melhor UX possível no iOS, acesso total a APIs nativas | Só iOS, precisa de Mac, requer codebase separada pra Android |
| **Kotlin (Android)** | Android nativo, performance máxima | Melhor UX no Android, Jetpack Compose moderno | Só Android, codebase separada |
| **PWA** | Web responsivo como "app" | Sem app store, uma codebase web, instala no home screen | Acesso limitado a APIs nativas, sem push (iOS limitado), sem app store visibility |
| **Capacitor** | Web app empacotado como nativo | Usa codebase web existente, acesso a plugins nativos | Performance web, UX não é nativa, plugins limitados |

### Recomendação por contexto

| Contexto | Recomendação |
|---|---|
| MVP, validação rápida | **PWA** (nem faça app nativo ainda) |
| App com UX padrão, time JS | **React Native + Expo** |
| App com UI muito customizada | **Flutter** |
| Só iOS, UX premium | **Swift** |
| Já tem web Laravel + React | **React Native + Expo** (reaproveita conhecimento React) |

---

## 4. Database

| Technology | Type | Best For | Limits |
|---|---|---|---|
| **PostgreSQL** | Relacional | 90% dos casos — ACID, JSON, full-text search, extensões | Complexidade operacional vs SQLite |
| **MySQL/MariaDB** | Relacional | Laravel default, WordPress, apps read-heavy | Menos features que PostgreSQL (JSON, arrays) |
| **SQLite** | Relacional embutido | MVPs, mobile, apps single-server, dev/test | Writes concorrentes limitados, single-writer |
| **MongoDB** | Document | Dados sem esquema fixo, prototipagem rápida | Sem JOINs reais, consistency trade-offs, caro em escala |
| **Redis** | Key-Value / Cache | Cache, sessions, queues, rate limiting, pub/sub | Memória cara, não é banco primário |
| **Qdrant** | Vector DB | Busca semântica, RAG, embeddings, similaridade | Não é banco relacional, use junto com um |
| **Supabase** | PostgreSQL managed + extras | Auth, real-time, storage, edge functions — tudo em um | Vendor lock-in, custo escala, menos controle |
| **Neon** | PostgreSQL serverless | Branching, auto-scale, free tier generoso | Mais caro em uso constante vs managed fixo |
| **Turso** | SQLite edge (libSQL) | SQLite distribuído, edge-first, embedded replicas | Ecossistema jovem, menos tooling que PostgreSQL |

### Recomendação por contexto

| Contexto | Recomendação |
|---|---|
| MVP, solo dev | **SQLite** (dev) + **PostgreSQL** (prod) ou **Supabase** |
| Laravel app | **MySQL** (default) ou **PostgreSQL** (se precisar de JSON/arrays) |
| App com busca semântica / IA | **PostgreSQL** (primário) + **Qdrant** (vetores) |
| Cache / sessions | **Redis** |
| Real-time, multi-client sync | **Supabase** ou **Firebase** |

---

## 5. Cache & Queues

### Cache

| Technology | Best For | Notes |
|---|---|---|
| **Redis** | Cache distribuído, sessions, rate limiting | Padrão da indústria, Laravel suporta nativamente |
| **Memcached** | Cache simples, read-heavy | Mais simples que Redis, sem persistência |
| **Application-level** | Cache in-memory por request | PHP opcache, Go sync.Map — sem infra extra |

### Queues

| Technology | Best For | Notes |
|---|---|---|
| **Laravel Queues** | Jobs async em Laravel | Usa Redis/DB/SQS como driver, zero config extra |
| **Redis (BullMQ)** | Jobs em Node.js | Retry, scheduling, concurrency control |
| **RabbitMQ** | Messaging complexo, routing patterns | Robusto, exchanges/bindings, mais complexo |
| **Amazon SQS** | Queues managed, alto volume | Zero ops, pay-per-message, integração AWS |
| **Kafka** | Event streaming de alto volume | Persistência de eventos, reprocessamento — overhead alto |

### Recomendação por contexto

| Contexto | Recomendação |
|---|---|
| Laravel app | **Laravel Queues + Redis** |
| Node.js app | **BullMQ + Redis** |
| Alto volume, event sourcing | **Kafka** (apenas se volume justifica) |
| AWS, gerenciado | **SQS** |
| MVP | **Queues síncronos** (nem implemente queue ainda) |

---

## 6. Search

| Technology | Best For | Notes |
|---|---|---|
| **PostgreSQL full-text** | Busca textual simples | Já está no banco, zero infra extra |
| **Meilisearch** | Busca rápida, typo-tolerant | Fácil setup, Laravel Scout suporta, open-source |
| **Algolia** | Busca managed, UX de busca rica | Instantâneo, managed, caro em volume |
| **Elasticsearch** | Busca complexa, analytics, logs | Poderoso, complexo de operar, memory-intensive |
| **Typesense** | Alternativa open-source ao Algolia | Fácil, rápido, self-hosted |

---

## 7. Auth

| Technology | Best For | Notes |
|---|---|---|
| **Laravel Breeze/Fortify** | Auth simples em Laravel | Login, register, password reset — minutes to setup |
| **Laravel Jetstream** | Auth completa em Laravel | Teams, 2FA, API tokens, profile management |
| **Laravel Sanctum** | API auth (SPA + mobile) | Token-based, cookie-based para SPA, simples |
| **Auth0** | Auth managed, enterprise SSO | Social login, MFA, compliance — caro em escala |
| **Clerk** | Auth moderna para React/Next | Bom DX, componentes prontos, hosted |
| **Supabase Auth** | Auth gratuita com Supabase | Social login, magic links, RLS policies |
| **Keycloak** | Self-hosted, enterprise SSO | OIDC/SAML, completo, complexo de operar |
| **Custom JWT** | Controle total | Flexível, mas fácil de errar — evite se possível |

---

## 8. File Storage

| Technology | Best For | Notes |
|---|---|---|
| **S3 (AWS)** | Padrão da indústria | Barato, durável, Laravel Filesystem suporta |
| **R2 (Cloudflare)** | S3-compatible, sem egress fee | Mais barato que S3 para leitura pesada |
| **MinIO** | S3-compatible self-hosted | Dev local, self-hosted, API S3 |
| **Supabase Storage** | Storage integrado | Se já usa Supabase |
| **Local disk** | MVP, arquivos temporários | Simples, mas não escala, sem CDN |

---

## 9. Payment & Billing

| Technology | Best For | Notes |
|---|---|---|
| **Stripe** | Padrão global, SaaS, marketplaces | API excelente, Laravel Cashier integra, webhook-driven |
| **LemonSqueezy** | SaaS indie, merchant of record | Cuida de impostos globais, mais simples que Stripe para indie |
| **Paddle** | SaaS, merchant of record | Similar ao LemonSqueezy, forte na Europa |
| **Mercado Pago** | Brasil, LATAM | PIX, boleto, cartão — essencial para mercado BR |
| **Asaas** | Brasil, recorrência, boleto | API boa, split de pagamento, cobrança recorrente |

### Recomendação por contexto

| Contexto | Recomendação |
|---|---|
| SaaS global | **Stripe** + Laravel Cashier |
| SaaS indie, quer simplicidade fiscal | **LemonSqueezy** |
| App para mercado brasileiro | **Stripe** (cartão) + **Mercado Pago** (PIX/boleto) |
| Marketplace com split | **Stripe Connect** ou **Asaas** |
| MVP | Comece com **Stripe** — migre depois se necessário |

---

## 10. Email & Notifications

| Technology | Best For | Notes |
|---|---|---|
| **Laravel Mail** | Email transacional em Laravel | Suporta SMTP, SES, Postmark, Resend como drivers |
| **Resend** | Email transacional moderno | API simples, DX excelente, React Email para templates |
| **Postmark** | Deliverability máxima | Foco em transacional, entrega rápida, caro em volume |
| **Amazon SES** | Alto volume, baixo custo | $0.10/1000 emails, precisa configurar reputação |
| **SendGrid** | Email marketing + transacional | Templates, analytics, escala |
| **Mailgun** | Transacional + validação | API boa, validação de emails |

### Push Notifications

| Technology | Best For | Notes |
|---|---|---|
| **Firebase Cloud Messaging** | Push mobile (Android + iOS) | Grátis, integra com Expo/RN |
| **Expo Notifications** | Push em apps Expo | Wrapper sobre FCM/APNs, simples |
| **OneSignal** | Push multi-plataforma | Free tier, segmentação, analytics |
| **Laravel Notifications** | Multi-canal em Laravel | Mail, SMS, Slack, DB, push — channels unificados |

---

## 11. AI / LLM Integration

| Technology | Best For | Notes |
|---|---|---|
| **Claude API (Anthropic)** | Geração de texto, análise, agentes | Melhor para código e raciocínio complexo, tool use |
| **OpenAI API** | Chat, completions, embeddings | Ecossistema maior, GPT-5, DALL-E |
| **Ollama** | LLM local, self-hosted | Zero custo, privacidade, latência variável |
| **Qdrant** | Vector DB para RAG | Busca semântica por embeddings |
| **pgvector** | Vectors no PostgreSQL | Sem infra extra, bom para volume moderado |
| **LangChain / Vercel AI SDK** | Orquestração de LLM | Streaming, tool calling, multi-provider |

### Recomendação por contexto

| Contexto | Recomendação |
|---|---|
| Chat/assistente com IA | **Claude API** + **Qdrant** (RAG) |
| Embeddings + busca semântica | **pgvector** (simples) ou **Qdrant** (escala) |
| IA em Laravel | **Laravel + HTTP client** para API calls + jobs para processamento async |
| Self-hosted, privacidade | **Ollama** + modelo open-source |
| MVP com IA | Comece com API call direta, não use framework de orquestração |

---

## 12. Infrastructure & Deploy

| Technology | Best For | Custo | Complexidade |
|---|---|---|---|
| **Vercel** | Next.js, frontends | Free tier, $20/mês pro | Muito baixa |
| **Railway** | Apps genéricos, DBs | Free trial, ~$5/mês+ | Baixa |
| **Render** | Apps genéricos, static sites | Free tier, $7/mês+ | Baixa |
| **Laravel Forge** | Laravel apps | $12/mês | Baixa-Média |
| **Laravel Vapor** | Laravel serverless (AWS) | $39/mês + AWS | Média |
| **Fly.io** | Containers, edge deploy | Free tier, $1.94/mês+ | Baixa-Média |
| **DigitalOcean App Platform** | Apps managed | $5/mês+ | Baixa |
| **AWS (EC2/ECS/EKS)** | Enterprise, controle total | Variável | Alta |
| **Docker Compose** | Self-hosted, VPS | Custo do VPS | Média |
| **Kubernetes** | Escala massiva, multi-service | Alto | Muito alta |
| **Coolify** | Self-hosted PaaS (open-source) | Custo do VPS | Média |

### Recomendação por contexto

| Contexto | Recomendação |
|---|---|
| MVP, zero budget | **Railway** ou **Render** free tier |
| Laravel app | **Laravel Forge** + DigitalOcean droplet |
| Next.js / frontend | **Vercel** |
| Precisa de controle, VPS | **Docker Compose** ou **Coolify** |
| Enterprise, multi-region | **AWS** ou **GCP** |
| Micro budget, self-managed | **VPS $5/mês** + Docker Compose |

---

## 13. Monitoring & Observability

| Technology | Camada | Notes |
|---|---|---|
| **Sentry** | Error tracking | Free tier generoso, Laravel/React/RN SDK |
| **Laravel Telescope** | Debug (dev) | Queries, requests, jobs — local only |
| **Laravel Pulse** | Dashboard (prod) | Performance, slow queries, exceptions |
| **Grafana + Prometheus** | Metrics, dashboards | Open-source, poderoso, complexo de setup |
| **Better Stack (Logtail)** | Logs | Agregação de logs, alertas |
| **UptimeRobot** | Uptime monitoring | Grátis até 50 monitors, alertas via SMS/email |
| **OpenTelemetry** | Traces, metrics, logs | Standard aberto, vendor-neutral |

---

## 14. Pre-Built Stacks

Combinações testadas e comprovadas para cenários comuns:

### Stack Laravel Completa (MVP → Produto)

```
API:       Laravel 13
Web:       Inertia.js + React (ou Vue)
Mobile:    React Native + Expo
DB:        PostgreSQL (managed)
Cache:     Redis
Queue:     Laravel Queues + Redis
Auth:      Laravel Sanctum
Storage:   S3
Search:    Meilisearch
Deploy:    Laravel Forge + DigitalOcean
Monitor:   Sentry + Laravel Pulse
```

### Stack Laravel Mínima (MVP 2 semanas)

```
API + Web: Laravel + Blade + Livewire
Mobile:    PWA (web responsivo)
DB:        SQLite (dev) → PostgreSQL (prod)
Auth:      Laravel Breeze
Deploy:    Railway ou Render
```

### Stack Node.js Full

```
API:       NestJS (ou Fastify)
Web:       Next.js + React
Mobile:    React Native + Expo
DB:        PostgreSQL (Supabase)
Auth:      Supabase Auth (ou Clerk)
Deploy:    Vercel (web) + Railway (API)
```

### Stack Go + React

```
API:       Go (net/http stdlib)
Web:       React + Vite
Mobile:    React Native + Expo
DB:        PostgreSQL
Queue:     Redis
Deploy:    Docker Compose → Kubernetes
```
