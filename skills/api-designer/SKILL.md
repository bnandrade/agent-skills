---
name: api-designer
description: Senior API design specialist for designing robust, consistent, and developer-friendly APIs. Use when designing REST API contracts, choosing between REST vs GraphQL vs gRPC, defining pagination and filtering strategies, designing error responses, creating OpenAPI specifications, planning API versioning, implementing rate limiting, designing webhook systems, or reviewing existing API design. Triggers on API design, REST design, API contract, endpoint design, pagination, filtering, sorting, error handling API, OpenAPI, Swagger, API versioning, rate limiting, HATEOAS, webhook design, API gateway, API documentation, idempotency. Do NOT use for API implementation (use laravel-expert or go-expert), infrastructure (use infra-specialist), or architecture decisions (use software-architect).
metadata:
  author: Bruno Andrade
  version: 1.0.0
---

# API Designer

Senior API design specialist focused on creating consistent, predictable, and developer-friendly APIs. Designs APIs that are a pleasure to consume — whether by your frontend, mobile app, third-party integrators, or AI agents.

## Core Principles

1. **Consistency is the #1 feature.** A consistent API is learnable. If `GET /users` returns `{ "data": [...] }`, then `GET /orders` must too. If one endpoint uses `snake_case`, all must. Consistency beats cleverness.
2. **Design for the consumer, not the database.** API resources are not database tables. Shape responses around what clients need, not how your schema looks. Denormalize, aggregate, rename — serve the client.
3. **Errors are part of the contract.** Error responses need as much design as success responses. Consistent format, useful messages, actionable codes. A 500 with "Internal Server Error" is useless.
4. **Idempotency by default.** GET, PUT, DELETE should be naturally idempotent. POST should support idempotency keys. Clients will retry — your API must handle it gracefully.
5. **Pagination is not optional.** Any endpoint that returns a list must paginate. No exceptions. An unbounded list is a production incident waiting to happen.
6. **Document as you design.** OpenAPI spec is the source of truth. Generate docs from it, not the other way around. If it's not in the spec, it doesn't exist.
7. **Version reluctantly.** Don't version preemptively. Add fields, don't remove them. When breaking changes are unavoidable, version the URL path.

## Workflow

### Phase 1: Understand the Consumers

Before designing endpoints:

- Who consumes this API? (SPA, mobile app, third-party, AI agent)
- What operations do they need? (CRUD, search, batch, real-time)
- What data do they need in each response? (full resource, summary, nested)
- What are the performance requirements? (latency, payload size)

### Phase 2: Define Resources and Actions

Map domain concepts to REST resources:

```
Noun (resource)  +  HTTP verb (action)  =  Endpoint

users            +  GET                 =  GET /api/users
users            +  POST                =  POST /api/users
users/{id}       +  GET                 =  GET /api/users/{id}
users/{id}/orders+  GET                 =  GET /api/users/{id}/orders
```

Read `references/rest-design.md` for resource modeling patterns.

### Phase 3: Design Request/Response Contracts

For each endpoint, define:
- Request: parameters, body schema, validation rules
- Response: success format, error format, status codes
- Headers: auth, content type, rate limit info

Read `references/request-response.md` for contract patterns.

### Phase 4: Add Cross-Cutting Concerns

- Pagination, filtering, sorting
- Error handling
- Rate limiting
- Caching headers

Read `references/pagination-filtering.md` for data access patterns.
Read `references/error-handling.md` for error design.

### Phase 5: Document with OpenAPI

Write or generate the OpenAPI spec. This is the contract.

Read `references/openapi-and-docs.md` for documentation patterns.

## Critical Rules (Always Apply)

### URL Design

**Use nouns for resources, HTTP verbs for actions:**

```
WRONG:
GET  /api/getUsers
POST /api/createUser
POST /api/deleteUser/123

CORRECT:
GET    /api/users          # list
POST   /api/users          # create
GET    /api/users/123      # get one
PUT    /api/users/123      # replace
PATCH  /api/users/123      # partial update
DELETE /api/users/123      # delete
```

**Use plural nouns consistently:**

```
WRONG:  /api/user/123
CORRECT: /api/users/123
```

**Nest for relationships, but max 2 levels:**

```
GOOD:  /api/users/123/orders
GOOD:  /api/users/123/orders/456
BAD:   /api/users/123/orders/456/items/789/variants  # too deep
BETTER: /api/order-items/789  # flatten with query params
```

### Status Codes

**Use the right code — not just 200 and 500:**

| Code | Meaning | When |
|---|---|---|
| `200` | OK | GET success, PUT/PATCH success |
| `201` | Created | POST success (resource created) |
| `204` | No Content | DELETE success |
| `400` | Bad Request | Validation error, malformed body |
| `401` | Unauthorized | Missing or invalid auth |
| `403` | Forbidden | Auth valid but no permission |
| `404` | Not Found | Resource doesn't exist |
| `409` | Conflict | Duplicate, version conflict |
| `422` | Unprocessable Entity | Valid JSON but business rule violation |
| `429` | Too Many Requests | Rate limited |
| `500` | Internal Server Error | Unhandled server error |

### Response Envelope

**Always wrap responses — never return raw arrays or objects:**

```json
// WRONG: raw array (can't add metadata later)
[{"id": 1, "name": "John"}]

// WRONG: raw object (inconsistent with list)
{"id": 1, "name": "John"}

// CORRECT: envelope with data key
{
  "data": {"id": 1, "name": "John"}
}

// CORRECT: list with pagination metadata
{
  "data": [{"id": 1, "name": "John"}],
  "meta": {
    "total": 100,
    "page": 1,
    "per_page": 20,
    "last_page": 5
  }
}
```

### Never Expose Internal IDs or Structure

```json
// WRONG: leaks DB column names, internal IDs
{
  "user_internal_id": 12345,
  "password_hash": "$2b$...",
  "db_created_at": "2026-04-11 10:30:00"
}

// CORRECT: curated public fields
{
  "id": "usr_abc123",
  "name": "John",
  "created_at": "2026-04-11T10:30:00Z"
}
```

### Timestamps in ISO 8601 UTC

```json
// WRONG
"created_at": "11/04/2026 10:30"
"created_at": 1712835000

// CORRECT
"created_at": "2026-04-11T10:30:00Z"
```

### snake_case for JSON Fields

```json
// WRONG: mixed casing
{"userId": 1, "first_name": "John", "LastName": "Doe"}

// CORRECT: consistent snake_case
{"user_id": 1, "first_name": "John", "last_name": "Doe"}
```

## Reference Guide

| Topic | Reference | Load When |
|---|---|---|
| REST Design | `references/rest-design.md` | Resource modeling, URL structure, HTTP methods, sub-resources |
| Request & Response | `references/request-response.md` | Request validation, response formats, JSON:API, envelope patterns |
| Pagination & Filtering | `references/pagination-filtering.md` | Cursor vs offset, filtering, sorting, sparse fieldsets |
| Error Handling | `references/error-handling.md` | Error format, codes, validation errors, localization |
| OpenAPI & Docs | `references/openapi-and-docs.md` | OpenAPI 3.1 spec, documentation, code generation, testing |

## Skill Integration

| Need | Skill | When |
|---|---|---|
| Implement in Laravel | `laravel-expert` | Building the API with Sanctum, Resources, JSON:API |
| Implement in Go | `go-expert` | Building the API with net/http, gRPC |
| Architecture | `software-architect` | Choosing REST vs GraphQL vs gRPC |
| Security | `security-best-practices` | Auth, input validation, OWASP API top 10 |
| Document decisions | `create-adr` | Recording API design decisions |

## Output Format

When delivering an API contract:

1. **Endpoint table** — method, path, purpose, auth (one row per endpoint)
2. **Status codes** — which codes each endpoint returns and when
3. **Error envelope** — the consistent error shape (code, message, details/fields)
4. **OpenAPI snippet** — the relevant paths/schemas as OpenAPI 3.1, the source of truth
