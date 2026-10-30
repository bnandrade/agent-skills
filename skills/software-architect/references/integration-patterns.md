# Integration Patterns

Padrões de integração entre componentes: protocolos, APIs, comunicação real-time e mensageria.

---

## Table of Contents

1. [REST API](#1-rest-api)
2. [GraphQL](#2-graphql)
3. [gRPC](#3-grpc)
4. [WebSocket & Real-Time](#4-websocket--real-time)
5. [Server-Sent Events (SSE)](#5-server-sent-events)
6. [Message Queues](#6-message-queues)
7. [API Gateway](#7-api-gateway)
8. [BFF Pattern](#8-bff-pattern)
9. [Webhooks](#9-webhooks)
10. [Comparação de Protocolos](#10-comparacao-de-protocolos)
11. [API Versioning](#11-api-versioning)
12. [Rate Limiting & Throttling](#12-rate-limiting--throttling)

---

## 1. REST API

O padrão para 90% das APIs. Stateless, baseado em HTTP, recursos como URLs.

### Quando Usar
- APIs públicas
- CRUD sobre recursos
- Integração entre frontend e backend
- Quando interoperabilidade é mais importante que eficiência

### Quando Não Usar
- Dados altamente aninhados / grafo (considere GraphQL)
- Comunicação interna alta-frequência (considere gRPC)
- Real-time bidimensional (considere WebSocket)

### Convenções

```
GET    /api/users              → Listar
POST   /api/users              → Criar
GET    /api/users/{id}         → Obter um
PUT    /api/users/{id}         → Atualizar completo
PATCH  /api/users/{id}         → Atualizar parcial
DELETE /api/users/{id}         → Remover

GET    /api/users/{id}/orders  → Sub-recursos
```

### Response Patterns

```json
// Sucesso (item)
{ "data": { "id": 1, "name": "John" } }

// Sucesso (lista com paginação)
{
  "data": [{ "id": 1, "name": "John" }],
  "meta": { "total": 100, "page": 1, "per_page": 20 }
}

// Erro
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is required",
    "details": { "field": "email" }
  }
}
```

### API Resource Layer (Laravel)

```php
// Nunca retorne Models diretamente — use Resources
class UserResource extends JsonResource {
    public function toArray($request) {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            // NÃO: password, remember_token, etc.
        ];
    }
}
```

---

## 2. GraphQL

Uma query language para APIs. O cliente pede exatamente o que precisa.

### Quando Usar
- Múltiplos tipos de cliente pedindo dados diferentes (mobile vs web)
- Dados altamente relacionados / grafo
- Over-fetching / under-fetching é um problema real
- Time frontend precisa de autonomia para mudar queries

### Quando NÃO Usar
- API simples com poucos endpoints
- MVP (complexidade desnecessária)
- Time não tem experiência com GraphQL
- File uploads pesados (GraphQL não é ideal)
- Caching simples é importante (REST é mais cacheável)

### Trade-offs vs REST

| Aspecto | REST | GraphQL |
|---|---|---|
| Caching | Simples (HTTP cache) | Complexo (precisa de client cache) |
| Overfetching | Comum | Resolvido por design |
| Curva de aprendizado | Baixa | Média-alta |
| Tooling | Maduro | Maduro (Apollo, Relay) |
| File upload | Simples | Precisa de workaround |
| N+1 queries | No backend | Precisa de DataLoader |
| Monitoramento | Simples (por endpoint) | Complexo (tudo é POST /graphql) |

### Recomendação

Para a maioria dos projetos: **REST**. GraphQL só se overfetching é um problema **medido e real**, não teórico.

---

## 3. gRPC

Protocol Buffers + HTTP/2. Comunicação binária, tipada, bidirecional.

### Quando Usar
- Comunicação interna entre serviços (microservices)
- Alta frequência de chamadas, latência importa
- Streaming (server → client, client → server, bidirecional)
- Contratos tipados entre times/linguagens

### Quando NÃO Usar
- APIs públicas para browsers (precisa de proxy/gateway)
- Time sem experiência com protobuf
- Poucos serviços internos (REST é mais simples)

### Trade-offs vs REST

| Aspecto | REST | gRPC |
|---|---|---|
| Formato | JSON (texto) | Protobuf (binário) |
| Performance | Boa | Excelente |
| Browser support | Nativo | Precisa de gRPC-Web proxy |
| Streaming | SSE / WebSocket | Nativo (4 modos) |
| Tooling | curl, Postman | grpcurl, Evans |
| Code generation | Opcional (OpenAPI) | Obrigatório (protoc) |
| Debugging | Legível (JSON) | Binário (precisa de tooling) |

---

## 4. WebSocket & Real-Time

Conexão bidirecional persistente. Ambos os lados podem enviar a qualquer momento.

### Quando Usar
- Chat e messaging
- Collaborative editing (Google Docs-like)
- Live dashboards com updates frequentes (< 1s)
- Gaming
- Trading / market data

### Quando NÃO Usar
- Notificações simples (SSE é mais simples)
- Updates a cada 5-30 segundos (polling ou SSE resolve)
- APIs stateless (WebSocket é stateful)

### Opções de Implementação

| Technology | Best For | Notes |
|---|---|---|
| ~~Laravel WebSockets~~ | ~~Laravel apps~~ | **Deprecated** — use Laravel Reverb |
| **Pusher** | Managed, qualquer stack | Fácil, limite de mensagens no free tier |
| **Ably** | Managed, alta escala | Mais caro, mais robusto |
| **Socket.IO** | Node.js | Padrão, fallbacks automáticos |
| **Soketi** | Self-hosted, Pusher-compatible | Open-source, roda em qualquer VPS |
| **Supabase Realtime** | Com Supabase | PostgreSQL changes em real-time |
| **Laravel Reverb** | Laravel 11+ | First-party, built-in, auto-scaling |

### Recomendação

| Contexto | Recomendação |
|---|---|
| Laravel app | **Laravel Reverb** (first-party) |
| MVP, sem infra | **Pusher** free tier |
| Self-hosted | **Soketi** |
| Node.js | **Socket.IO** |

---

## 5. Server-Sent Events

Conexão unidirecional: servidor → cliente. Mais simples que WebSocket.

### Quando Usar
- Live feeds (timeline, activity feed)
- Progress bars / status updates
- Notificações server-push
- Streaming de respostas de IA (LLM)

### Quando NÃO Usar
- Comunicação bidirecional (WebSocket)
- Cliente precisa enviar dados frequentemente

### Implementação

```
Cliente: EventSource API (nativa nos browsers)
Servidor: Response com Content-Type: text/event-stream
```

### Trade-offs vs WebSocket

| Aspecto | SSE | WebSocket |
|---|---|---|
| Direção | Server → Client | Bidirecional |
| Protocolo | HTTP/1.1+ | WS (upgrade HTTP) |
| Reconexão | Automática | Manual |
| Complexidade | Baixa | Média |
| Proxy/firewall | Funciona | Pode bloquear |
| Limite de conexões | ~6 por domínio (HTTP/1.1) | Sem limite prático |

---

## 6. Message Queues

Comunicação assíncrona entre componentes via fila.

### Quando Usar
- Processamento que não precisa de resposta imediata (email, relatório, resize de imagem)
- Absorver picos de carga
- Retry automático em caso de falha
- Desacoplar producer de consumer

### Padrões

```
Point-to-Point (Queue):
  Producer → Queue → Consumer
  Cada mensagem processada por UM consumer.

Pub/Sub (Topic):
  Publisher → Topic → Subscriber A
                   → Subscriber B
  Cada mensagem processada por TODOS os subscribers.

Request/Reply:
  Client → Request Queue → Service
  Client ← Reply Queue ← Service
  Simula sync sobre async.
```

### Decisão

| Necessidade | Solução |
|---|---|
| Jobs async simples | **Laravel Queues** (com Redis ou DB driver) |
| Routing complexo, exchanges | **RabbitMQ** |
| Event log, reprocessamento | **Kafka** |
| Managed, zero ops | **Amazon SQS** ou **Google Pub/Sub** |
| MVP | **Não use queue** — faça síncrono e adicione depois |

---

## 7. API Gateway

Ponto de entrada único que roteia para múltiplos backends.

### Quando Usar
- Múltiplos microservices atrás de uma URL
- Precisa de rate limiting, auth, logging centralizados
- Múltiplos protocolos (REST + gRPC + WebSocket)

### Quando NÃO Usar
- Um monolith (o framework já faz routing)
- 2-3 serviços (load balancer simples resolve)

### Opções

| Technology | Notes |
|---|---|
| **Nginx** | Reverse proxy, load balancer, SSL termination |
| **Traefik** | Auto-discovery com Docker/K8s, config dinâmica |
| **Kong** | API Gateway completo, plugins, rate limiting |
| **AWS API Gateway** | Managed, integra com Lambda |
| **Cloudflare** | CDN + proxy + WAF + rate limiting |

---

## 8. BFF Pattern

Backend for Frontend — API intermediária otimizada por tipo de cliente.

### Implementação Prática

```
API Core (Laravel):
  - Lógica de negócio
  - Validações
  - Acesso a dados
  - Usado internamente

BFF Web (Next.js API Routes / Laravel endpoint):
  - Agrega chamadas da API core
  - Formata dados para web (mais dados, nested)
  - SSR data fetching

BFF Mobile (endpoint dedicado):
  - Dados mínimos (bandwidth limitado)
  - Paginação agressiva
  - Imagens comprimidas
```

### Quando Não Complicar

Para a maioria dos projetos, **uma API com resources diferentes** resolve sem BFF:

```php
// Resource completo para web
class UserResource extends JsonResource { /* todos os campos */ }

// Resource mínimo para mobile
class UserSummaryResource extends JsonResource { /* id, name, avatar */ }

// Mesmo endpoint, resource diferente
Route::get('/users/{id}', function ($id, Request $request) {
    $user = User::find($id);
    return $request->header('X-Client') === 'mobile'
        ? new UserSummaryResource($user)
        : new UserResource($user);
});
```

---

## 9. Webhooks

Push notifications de servidor para servidor. Evento acontece → HTTP POST para URL registrada.

### Quando Usar
- Integração com terceiros (Stripe, GitHub, Twilio)
- Notificar parceiros sobre eventos
- Substituir polling ("me avise quando algo acontecer")

### Implementação Robusta

```
1. Receber webhook
2. Validar assinatura (HMAC)
3. Retornar 200 IMEDIATAMENTE
4. Processar async (queue)
5. Implementar idempotência (deduplicar por event_id)
```

```php
// Laravel
Route::post('/webhooks/stripe', function (Request $request) {
    // 1. Validar assinatura
    $payload = $request->getContent();
    $sig = $request->header('Stripe-Signature');
    $event = Webhook::constructEvent($payload, $sig, config('services.stripe.webhook_secret'));

    // 2. Dispatch async
    ProcessStripeWebhook::dispatch($event);

    // 3. Retornar rápido
    return response('OK', 200);
});
```

---

## 10. Comparação de Protocolos

| Protocolo | Formato | Direção | Latência | Complexidade | Best For |
|---|---|---|---|---|---|
| **REST** | JSON | Req/Res | Média | Baixa | APIs gerais, CRUD |
| **GraphQL** | JSON | Req/Res | Média | Média | Dados complexos, multi-client |
| **gRPC** | Protobuf | Bidirecional | Baixa | Média | Serviço-a-serviço |
| **WebSocket** | Qualquer | Bidirecional | Muito baixa | Média | Chat, real-time bidirecional |
| **SSE** | Text | Server→Client | Baixa | Baixa | Notificações, streaming |
| **Webhook** | JSON | Push | N/A | Baixa | Eventos entre sistemas |
| **Queue** | Qualquer | Async | Variável | Média | Processamento assíncrono |

### Decisão Simplificada

```
Precisa de API para frontend?
  → REST (90% dos casos)
  → GraphQL (se overfetching é problema medido)

Precisa de real-time?
  → SSE (unidirecional, simples)
  → WebSocket (bidirecional)
  → Laravel Reverb (se Laravel)

Precisa de comunicação entre serviços?
  → REST (se poucos, baixa frequência)
  → gRPC (se muitos, alta frequência)
  → Queue (se async é OK)

Precisa de integração com terceiros?
  → Webhooks (receber eventos)
  → REST client (enviar requests)
```

---

## 11. API Versioning

### Estratégias

| Estratégia | Exemplo | Pros | Cons |
|---|---|---|---|
| **URL path** | `/api/v1/users` | Simples, explícito | URL muda, cache separado |
| **Header** | `Accept: application/vnd.api+json;version=2` | URL limpa | Menos descobrível |
| **Query param** | `/api/users?version=2` | Simples | Polui query string |

### Recomendação

- **MVP:** Sem versioning. `api/users` e pronto.
- **Produto:** URL path (`/api/v1/`) quando a primeira breaking change aparecer.
- **Evite:** Versionar preventivamente. Só versione quando quebrar algo.

---

## 12. Rate Limiting & Throttling

### Implementação por Contexto

| Contexto | Implementação |
|---|---|
| Laravel | `throttle` middleware: `Route::middleware('throttle:60,1')` |
| API pública | Rate limiting por API key |
| Proteção contra abuse | IP-based + exponential backoff |
| Premium tiers | Rate limits diferentes por plano |

### Headers Standard

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1620000000
Retry-After: 30
```
