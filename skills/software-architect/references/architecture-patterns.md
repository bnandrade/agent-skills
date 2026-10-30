# Architecture Patterns

Padrões arquiteturais com critérios claros de quando usar cada um.

---

## Table of Contents

1. [Monolith](#1-monolith)
2. [Modular Monolith](#2-modular-monolith)
3. [Microservices](#3-microservices)
4. [Serverless](#4-serverless)
5. [Event-Driven](#5-event-driven)
6. [CQRS](#6-cqrs)
7. [Hexagonal / Ports & Adapters](#7-hexagonal--ports--adapters)
8. [BFF (Backend for Frontend)](#8-bff)
9. [Multi-Tenant Architecture](#9-multi-tenant-architecture)
10. [Monorepo vs Multirepo](#10-monorepo-vs-multirepo)
11. [Comparação Rápida](#11-comparacao-rapida)
12. [Evolução Natural](#12-evolucao-natural)

---

## 1. Monolith

Uma aplicação, um deploy, um banco de dados.

### Quando Usar
- MVP e primeiras versões do produto
- Time de 1-5 devs
- Domínio de negócio ainda não está claro
- Precisa iterar rápido

### Quando Não Usar
- Times grandes (15+) que precisam deploy independente
- Componentes com requisitos de escala radicalmente diferentes
- Múltiplas linguagens/runtimes necessárias

### Estrutura Típica

```
app/
├── Http/Controllers/     # ou handlers
├── Models/               # domínio
├── Services/             # lógica de negócio
├── Repositories/         # acesso a dados
├── Jobs/                 # processamento async
├── Events/               # eventos internos
└── config/
```

### Trade-offs

| Ganha | Perde |
|---|---|
| Simplicidade operacional | Deploy de tudo junto |
| Transações ACID fáceis | Escala tudo junto |
| Debugging simples | Mudanças podem afetar tudo |
| Uma codebase para entender | Pode virar "big ball of mud" |

### Mitigação
- Separe por módulos/bounded contexts **dentro** do monolith
- Use queues para processamento pesado
- Cache agressivo para read-heavy

---

## 2. Modular Monolith

Um deploy, mas internamente organizado em módulos independentes com fronteiras claras.

### Quando Usar
- Produto validado que precisa de organização sem a complexidade de microservices
- Time de 3-15 devs
- Preparação para eventual extração de serviços
- Domínio de negócio ficando complexo

### Quando Não Usar
- MVP (overhead desnecessário de organização)
- Time < 3 que não precisa de boundaries formais

### Estrutura Típica

```
app/
├── Modules/
│   ├── User/
│   │   ├── Controllers/
│   │   ├── Models/
│   │   ├── Services/
│   │   ├── Events/
│   │   ├── Contracts/      # interfaces públicas do módulo
│   │   └── routes.php
│   ├── Billing/
│   │   ├── Controllers/
│   │   ├── Models/
│   │   ├── Services/
│   │   ├── Listeners/      # reage a eventos de outros módulos
│   │   └── Contracts/
│   └── Notification/
│       └── ...
├── Shared/                  # código compartilhado
└── config/
```

### Regras

1. **Módulos se comunicam por interfaces (Contracts)**, nunca acessam internals de outro
2. **Cada módulo pode ter suas migrations**, models e rotas
3. **Eventos** conectam módulos sem acoplamento direto
4. **Nenhum `use App\Modules\X\Models\Y` cruzado** — use a interface pública

### Trade-offs

| Ganha | Perde |
|---|---|
| Boundaries claras | Overhead de organização |
| Fácil de extrair serviço depois | Disciplina necessária para manter boundaries |
| Um deploy, uma infra | Ainda escala tudo junto |
| Transações ACID entre módulos | Precisa de convenção forte |

---

## 3. Microservices

Múltiplos serviços independentes, cada um com seu deploy e (opcionalmente) seu banco.

### Quando Usar
- Times grandes (15+) que precisam autonomia
- Componentes com requisitos de escala muito diferentes
- Precisa de deploy independente por time
- Domínio bem entendido e estável

### Quando NÃO Usar
- MVP ou produto early-stage
- Time < 10 devs
- Domínio ainda em descoberta
- Budget limitado para infra/DevOps

### Complexidades que Microservices Adicionam

- Service discovery
- Network latency entre chamadas
- Distributed tracing
- Eventual consistency (sem transações ACID cross-service)
- Deploy pipeline por serviço
- Monitoring de N serviços
- Log aggregation
- Versioning de APIs internas

### Trade-offs

| Ganha | Perde |
|---|---|
| Deploy independente | Complexidade operacional enorme |
| Escala granular | Network latency, falhas parciais |
| Autonomia por time | Distributed debugging é difícil |
| Tecnologia por serviço | Consistência de dados complexa |

### Regra de Ouro

> "If you can't build a well-structured monolith, what makes you think microservices are the answer?" — Simon Brown

---

## 4. Serverless

Funções individuais executadas sob demanda, sem servidor persistente.

### Quando Usar
- Workloads esporádicas (webhooks, cron jobs, event processing)
- APIs com tráfego muito variável (picos e vales)
- Prototipagem rápida com zero ops
- Integração entre serviços cloud (S3 trigger → Lambda → SQS)

### Quando Não Usar
- Latência consistente necessária (cold starts)
- Long-running processes (> 15 min)
- WebSocket / conexões persistentes
- Alto volume constante (mais caro que container fixo)

### Opções

| Platform | Runtime | Notes |
|---|---|---|
| **AWS Lambda** | Node, Python, Go, etc. | Padrão, ecossistema enorme |
| **Vercel Functions** | Node, Edge | Integrado com Next.js |
| **Cloudflare Workers** | JS/WASM | Edge, ultra-rápido, limitações de runtime |
| **Laravel Vapor** | PHP (Laravel) | Laravel nativo em Lambda |
| **Supabase Edge Functions** | Deno | Integrado com Supabase |

### Trade-offs

| Ganha | Perde |
|---|---|
| Zero ops, auto-scale | Cold starts, latência imprevisível |
| Pay-per-use | Vendor lock-in |
| Escala automática | Debugging difícil |
| Deploy instantâneo | Limitações de runtime (timeout, memória) |

---

## 5. Event-Driven

Componentes se comunicam por eventos assíncronos em vez de chamadas diretas.

### Quando Usar
- Ações que disparam múltiplas consequências (pedido criado → email + estoque + nota fiscal)
- Desacoplamento entre domínios
- Processamento assíncrono pesado
- Auditoria / event log necessário

### Quando Não Usar
- CRUD simples sem side effects
- Quando consistência imediata é necessária
- Time pequeno sem experiência com async

### Níveis de Complexidade

```
Nível 1: Eventos in-process (Laravel Events, Go channels)
         → Simples, síncrono ou async via queue local

Nível 2: Message queue (Redis, RabbitMQ, SQS)
         → Desacoplado, retry automático, persistente

Nível 3: Event streaming (Kafka, EventStoreDB)
         → Event sourcing, reprocessamento, alto volume
```

**Comece no Nível 1.** Suba quando a complexidade justificar.

### Exemplo (Laravel)

```php
// Nível 1: evento in-process
event(new OrderCreated($order));

// Listeners registrados
class SendOrderConfirmation { /* email */ }
class UpdateInventory { /* estoque */ }
class CreateInvoice { /* nota fiscal */ }
// Cada listener pode ser sync ou queued independentemente
```

---

## 6. CQRS

Command Query Responsibility Segregation — modelos separados para leitura e escrita.

### Quando Usar
- Read e write patterns são muito diferentes
- Read model precisa de denormalization para performance
- Múltiplas views do mesmo dado

### Quando NÃO Usar
- CRUD simples
- MVP
- Domínio simples
- Time sem experiência

### Implementação Pragmática

Não precisa ser radical — CQRS parcial é válido:

```
Escrita: Model/Eloquent normal → tabela normalizada
Leitura: Query Builder / View / Cache → otimizado para consultas

NÃO precisa de:
- Bancos separados
- Event sourcing
- Message bus
```

---

## 7. Hexagonal / Ports & Adapters

Isola a lógica de negócio de detalhes de infraestrutura (HTTP, banco, APIs externas).

### Quando Usar
- Domínio complexo com regras de negócio ricas
- Precisa de testabilidade alta
- Múltiplas interfaces (API + CLI + Queue consumer)
- Time experiente

### Quando NÃO Usar
- CRUD simples (overhead desproporcional)
- MVP (velocidade é mais importante que arquitetura)
- Time junior (curva de aprendizado)

### Estrutura

```
Domain/           # Regras de negócio puras (zero dependência externa)
  ├── Order.php
  ├── OrderService.php
  └── OrderRepository.php    # interface (port)

Application/      # Use cases / orquestração
  └── CreateOrderUseCase.php

Infrastructure/   # Implementações concretas (adapters)
  ├── EloquentOrderRepository.php
  ├── StripePaymentGateway.php
  └── Http/OrderController.php
```

---

## 8. BFF

Backend for Frontend — uma API intermediária otimizada para cada tipo de cliente.

### Quando Usar
- Mobile e Web precisam de dados diferentes do mesmo backend
- GraphQL parece heavy mas você quer flexibilidade por cliente
- Agregar múltiplos microservices para o frontend

### Quando NÃO Usar
- Um só tipo de cliente
- API simples que atende todos
- MVP

### Estrutura

```
                    ┌─ BFF Web ──────┐
Web App ───────────→│ Agrega/formata │──→ API Core
                    └────────────────┘

                    ┌─ BFF Mobile ───┐
Mobile App ────────→│ Dados mínimos  │──→ API Core
                    └────────────────┘
```

---

## 9. Multi-Tenant Architecture

Múltiplos clientes (tenants) compartilhando a mesma aplicação.

### Estratégias

| Estratégia | Isolamento | Complexidade | Custo | Best For |
|---|---|---|---|---|
| **Banco compartilhado + coluna tenant_id** | Baixo | Baixa | Baixo | MVP SaaS, poucos tenants |
| **Schema por tenant** | Médio | Média | Médio | SaaS médio, compliance moderada |
| **Banco por tenant** | Alto | Alta | Alto | Enterprise, compliance rigorosa |

### Banco Compartilhado (Mais Comum)

```php
// Laravel: Global scope para tenant isolation
class TenantScope implements Scope {
    public function apply(Builder $builder, Model $model) {
        $builder->where('tenant_id', auth()->user()->tenant_id);
    }
}

// Ou use packages como stancl/tenancy, spatie/laravel-multitenancy
```

### Quando Usar Cada

| Cenário | Estratégia |
|---|---|
| SaaS com < 100 tenants | Banco compartilhado + tenant_id |
| SaaS com compliance (LGPD, dados isolados) | Schema ou banco por tenant |
| Enterprise white-label | Banco por tenant |
| MVP | Banco compartilhado — sempre |

### Trade-offs

| Ganha (compartilhado) | Perde (compartilhado) |
|---|---|
| Simplicidade operacional | Risco de data leak (query sem filtro) |
| Uma migration para todos | Performance degrada com volume |
| Backup/restore simples | Tenant grande afeta os outros |

### Pacotes Laravel

- **stancl/tenancy** — multi-database, domains, auto-switching
- **spatie/laravel-multitenancy** — flexível, qualquer estratégia
- **Implementação manual** — global scope + middleware (mais simples para MVP)

---

## 10. Monorepo vs Multirepo

### Monorepo

```
platform/
├── apps/
│   ├── api/          # Laravel ou similar
│   ├── web/          # React/Vue/Next
│   └── mobile/       # React Native
├── packages/
│   ├── ui/           # Componentes compartilhados
│   ├── types/        # TypeScript types
│   └── utils/        # Utilitários
└── package.json      # Workspaces (pnpm, Turborepo)
```

| Ganha | Perde |
|---|---|
| Compartilhar código fácil | CI/CD mais complexo |
| Refactor cross-project | Repo grande |
| Visibilidade total | Tooling específico (Turborepo, Nx) |
| Um PR para mudanças transversais | Permissões granulares difíceis |

### Multirepo

Cada projeto em seu próprio repositório.

| Ganha | Perde |
|---|---|
| Autonomia total por repo | Compartilhar código via packages publicados |
| CI/CD simples por repo | Mudanças cross-repo são PRs separados |
| Permissões granulares | Versão de packages compartilhados |

### Recomendação

| Contexto | Recomendação |
|---|---|
| Solo dev / time pequeno | **Monorepo** — simplicidade |
| Time grande, serviços independentes | **Multirepo** — autonomia |
| Full-stack (API + Web + Mobile) | **Monorepo** — compartilhar types e config |

---

## 11. Comparação Rápida

| Pattern | Complexidade | Time Mínimo | Best For |
|---|---|---|---|
| Monolith | Baixa | 1 dev | MVP, produto early |
| Modular Monolith | Média | 3 devs | Produto validado, domínio crescendo |
| Microservices | Alta | 15+ devs | Escala, autonomia por time |
| Serverless | Média | 1 dev | Workloads esporádicas, zero ops |
| Event-Driven | Média-Alta | 3+ devs | Side effects complexos, desacoplamento |
| CQRS | Alta | 5+ devs | Read/write patterns muito diferentes |
| Hexagonal | Média | 3+ devs | Domínio complexo, testabilidade |
| BFF | Média | 5+ devs | Múltiplos tipos de cliente |

---

## 12. Evolução Natural

A maioria dos projetos de sucesso segue esta progressão:

```
Monolith simples
    ↓ (produto validado, time crescendo)
Modular Monolith
    ↓ (escala, times independentes)
Modular Monolith + serviços extraídos
    ↓ (escala massiva, necessidade real)
Microservices (parcial ou total)
```

**Não pule etapas.** Cada etapa ensina sobre o domínio e prepara para a próxima.
