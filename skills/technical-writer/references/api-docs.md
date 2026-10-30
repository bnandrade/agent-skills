# API Documentation

Como documentar APIs de forma completa e util. OpenAPI como source of truth, exemplos em multiplas linguagens, documentacao de erros, rate limiting, paginacao, webhooks e ferramentas interativas.

---

## Table of Contents

1. [OpenAPI as Source of Truth](#1-openapi-as-source-of-truth)
2. [Endpoint Documentation Structure](#2-endpoint-documentation-structure)
3. [Authentication Documentation](#3-authentication-documentation)
4. [Code Examples per Endpoint](#4-code-examples-per-endpoint)
5. [Error Documentation](#5-error-documentation)
6. [Rate Limiting Documentation](#6-rate-limiting-documentation)
7. [Pagination Documentation](#7-pagination-documentation)
8. [Webhook Documentation](#8-webhook-documentation)
9. [SDKs and Client Libraries](#9-sdks-and-client-libraries)
10. [Interactive Documentation Tools](#10-interactive-documentation-tools)
11. [Changelog for API Changes](#11-changelog-for-api-changes)

---

## 1. OpenAPI as Source of Truth

The OpenAPI spec (YAML/JSON) is the single canonical source for your API. Generate documentation, client SDKs, and validation from it.

### 1.1 Code-First vs Spec-First

| Approach | How It Works | Best When |
|---|---|---|
| **Code-first** | Write handlers, annotate code, generate OpenAPI spec | Rapid prototyping, small teams, API is internal |
| **Spec-first** | Write OpenAPI spec, generate code stubs | Public APIs, multi-team, contract must be agreed on first |

### 1.2 Spec-First Example

```yaml
# openapi.yaml
openapi: "3.1.0"
info:
  title: User Management API
  version: "2.1.0"
  description: |
    API for managing user accounts, authentication, and profiles.
    All endpoints require authentication unless otherwise noted.

servers:
  - url: https://api.example.com/v2
    description: Production
  - url: https://staging-api.example.com/v2
    description: Staging

paths:
  /users:
    get:
      summary: List users
      operationId: listUsers
      tags: [Users]
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            default: 1
            minimum: 1
        - name: per_page
          in: query
          schema:
            type: integer
            default: 20
            minimum: 1
            maximum: 100
        - name: role
          in: query
          schema:
            type: string
            enum: [user, admin, moderator]
      responses:
        "200":
          description: Paginated list of users
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserListResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
```

### 1.3 Code-First Example (Go with swag)

```go
// @Summary Create a new user
// @Description Creates a user account and sends a welcome email
// @Tags Users
// @Accept json
// @Produce json
// @Param request body CreateUserRequest true "User data"
// @Success 201 {object} UserResponse
// @Failure 400 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse "Email already taken"
// @Router /users [post]
func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
    // handler implementation
}
```

```bash
# Generate OpenAPI spec from annotations
swag init -g cmd/api/main.go -o docs/
# Output: docs/swagger.json, docs/swagger.yaml
```

### 1.4 Code-First Example (Laravel with Scribe)

```php
/**
 * Create a new user
 *
 * Creates a user account and sends a welcome email.
 *
 * @group Users
 *
 * @bodyParam name string required The user's full name. Example: Maria Silva
 * @bodyParam email string required Must be unique. Example: maria@example.com
 * @bodyParam role string Must be one of: user, admin. Example: user
 *
 * @response 201 scenario="success" {"id":"usr_abc123","name":"Maria Silva","email":"maria@example.com"}
 * @response 422 scenario="validation error" {"message":"The email has already been taken.","errors":{"email":["The email has already been taken."]}}
 */
public function store(StoreUserRequest $request): JsonResponse
{
    // handler implementation
}
```

```bash
php artisan scribe:generate
# Output: public/docs/index.html
```

---

## 2. Endpoint Documentation Structure

Every endpoint needs these elements, in this order:

### 2.1 The Structure

```markdown
## [Action] [Resource]

[One sentence: what this endpoint does.]

**Endpoint:** `METHOD /path`

**Authentication:** [Required/Optional] — [type]

**Request Parameters:**

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | Yes | User ID (ULID format) |
| `include` | query | string | No | Comma-separated relations to include |

**Request Body:**

| Field | Type | Required | Description | Constraints |
|---|---|---|---|---|
| `name` | string | Yes | Full name | 2-100 chars |
| `email` | string | Yes | Email address | Valid email, unique |

**Example Request:**
(curl + at least one SDK language)

**Success Response:**
(status code + full response body)

**Error Responses:**
(table of all possible errors)
```

### 2.2 Complete Example

```markdown
## Update User Profile

Updates the authenticated user's profile information.
Only the provided fields are updated (PATCH semantics).

**Endpoint:** `PATCH /api/v2/users/{id}`

**Authentication:** Required — Bearer token

**Path Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `id` | string | User ID (ULID). Use `me` for the authenticated user. |

**Request Body:**

| Field | Type | Required | Description | Constraints |
|---|---|---|---|---|
| `name` | string | No | Full name | 2-100 characters |
| `email` | string | No | Email address | Valid format, unique |
| `avatar_url` | string | No | Profile picture URL | Must be HTTPS |
| `timezone` | string | No | IANA timezone | e.g., `America/Sao_Paulo` |

**Example Request:**

\`\`\`bash
curl -X PATCH https://api.example.com/v2/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Maria Silva Santos",
    "timezone": "America/Sao_Paulo"
  }'
\`\`\`

**Success Response (200 OK):**

\`\`\`json
{
  "data": {
    "id": "01HQ3K5M7N8P9QRSTVWXYZ",
    "name": "Maria Silva Santos",
    "email": "maria@example.com",
    "avatar_url": null,
    "timezone": "America/Sao_Paulo",
    "updated_at": "2024-03-15T14:30:00Z"
  }
}
\`\`\`

**Error Responses:**

| Status | Code | When |
|---|---|---|
| 400 | `validation_error` | Invalid field format or constraints |
| 401 | `unauthorized` | Missing or invalid token |
| 403 | `forbidden` | Trying to update another user (non-admin) |
| 409 | `email_taken` | Email already registered to another user |
| 404 | `not_found` | User ID doesn't exist |
```

---

## 3. Authentication Documentation

Authentication docs should get the developer from "no credentials" to "making authenticated requests" in < 5 minutes.

### 3.1 Structure

```markdown
## Authentication

All API requests require a Bearer token in the Authorization header.

### Getting a Token

\`\`\`bash
curl -X POST https://api.example.com/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your@email.com",
    "password": "your-password"
  }'
\`\`\`

Response:
\`\`\`json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "dGhpcyBpcyBhIHJlZnJl..."
}
\`\`\`

### Using the Token

Include in every request:
\`\`\`bash
curl https://api.example.com/v2/users/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
\`\`\`

### Token Refresh

Access tokens expire after 15 minutes. Use the refresh token to get a new one:

\`\`\`bash
curl -X POST https://api.example.com/v2/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "dGhpcyBpcyBhIHJlZnJl..."}'
\`\`\`

### API Keys (for server-to-server)

For backend integrations, use API keys instead of user tokens:

\`\`\`bash
curl https://api.example.com/v2/users \
  -H "X-API-Key: sk_live_abc123..."
\`\`\`

Generate API keys in the [dashboard](https://dashboard.example.com/settings/api-keys).
```

### 3.2 Common Mistakes

```
WRONG: "Authenticate using OAuth 2.0"
  → Which grant type? Where do I get client credentials?
  → Developer spends 2 hours reading RFC 6749

CORRECT: Step-by-step with exact curl commands
  → Step 1: POST to /auth/login with email + password
  → Step 2: Copy the access_token from the response
  → Step 3: Add "Authorization: Bearer {token}" to requests
  → Here's a full working example
```

---

## 4. Code Examples per Endpoint

### 4.1 Minimum: curl + Most Popular Language

Always provide curl (universal) plus the primary language of your API consumers.

```
WRONG: Only curl examples
  → Frontend developers have to mentally translate to fetch/axios
  → Go developers have to mentally translate to net/http

CORRECT: curl + JavaScript + the primary backend language
```

### 4.2 Multi-Language Template

```markdown
### Create Order

**curl:**
\`\`\`bash
curl -X POST https://api.example.com/v2/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"product_id": "prod_123", "quantity": 2},
      {"product_id": "prod_456", "quantity": 1}
    ],
    "shipping_address_id": "addr_789"
  }'
\`\`\`

**JavaScript:**
\`\`\`javascript
const order = await fetch("https://api.example.com/v2/orders", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    items: [
      { product_id: "prod_123", quantity: 2 },
      { product_id: "prod_456", quantity: 1 },
    ],
    shipping_address_id: "addr_789",
  }),
}).then(res => res.json());
\`\`\`

**PHP:**
\`\`\`php
$response = Http::withToken($token)->post(
    'https://api.example.com/v2/orders',
    [
        'items' => [
            ['product_id' => 'prod_123', 'quantity' => 2],
            ['product_id' => 'prod_456', 'quantity' => 1],
        ],
        'shipping_address_id' => 'addr_789',
    ]
);
$order = $response->json();
\`\`\`

**Go:**
\`\`\`go
order := CreateOrderRequest{
    Items: []OrderItem{
        {ProductID: "prod_123", Quantity: 2},
        {ProductID: "prod_456", Quantity: 1},
    },
    ShippingAddressID: "addr_789",
}

body, _ := json.Marshal(order)
req, _ := http.NewRequestWithContext(ctx, "POST",
    "https://api.example.com/v2/orders",
    bytes.NewReader(body))
req.Header.Set("Authorization", "Bearer "+token)
req.Header.Set("Content-Type", "application/json")

resp, err := client.Do(req)
\`\`\`
```

---

## 5. Error Documentation

Every possible error the API can return must be documented. No surprises in production.

### 5.1 Error Format

```markdown
## Error Format

All errors follow this structure:

\`\`\`json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Human-readable description",
    "details": {}
  }
}
\`\`\`

| Field | Type | Description |
|---|---|---|
| `code` | string | Machine-readable error code (use for programmatic handling) |
| `message` | string | Human-readable message (safe to show to users) |
| `details` | object | Additional context (varies by error type) |
```

### 5.2 Error Catalog

```markdown
## Error Reference

### Authentication Errors

| HTTP Status | Error Code | Description | How to Fix |
|---|---|---|---|
| 401 | `token_missing` | No Authorization header | Add `Authorization: Bearer {token}` header |
| 401 | `token_expired` | Token has expired | Refresh the token using `/auth/refresh` |
| 401 | `token_invalid` | Token is malformed or revoked | Get a new token via `/auth/login` |
| 403 | `insufficient_permissions` | Token lacks required role | Request the needed role from an admin |

### Validation Errors

| HTTP Status | Error Code | Description | Details |
|---|---|---|---|
| 400 | `validation_error` | Input validation failed | `errors` array with field-level details |
| 400 | `invalid_json` | Request body is not valid JSON | Check JSON syntax |

**Validation error example:**
\`\`\`json
{
  "error": {
    "code": "validation_error",
    "message": "Validation failed",
    "details": {
      "errors": [
        {"field": "email", "rule": "email", "message": "Invalid email format"},
        {"field": "name", "rule": "min", "message": "Name must be at least 2 characters", "params": {"min": 2}}
      ]
    }
  }
}
\`\`\`

### Resource Errors

| HTTP Status | Error Code | Description |
|---|---|---|
| 404 | `not_found` | Resource doesn't exist |
| 409 | `conflict` | Resource already exists (e.g., duplicate email) |
| 410 | `gone` | Resource was deleted |
| 422 | `unprocessable` | Request is valid but can't be processed (business rule violation) |

### Server Errors

| HTTP Status | Error Code | Description | What to Do |
|---|---|---|---|
| 500 | `internal_error` | Unexpected server error | Retry with exponential backoff. If persistent, contact support. |
| 503 | `service_unavailable` | Service temporarily down | Retry after `Retry-After` header value |
```

### 5.3 Common Mistake

```
WRONG: Only documenting the happy path
  "Returns a 200 with the user object"
  → Developer hits a 409, doesn't know what it means
  → Developer hits a 422, doesn't know how to handle it

CORRECT: Document EVERY status code the endpoint can return
  200: Success (with example)
  400: Validation error (with example)
  401: Missing/invalid token
  403: Insufficient permissions
  404: User not found
  409: Email already taken
  429: Rate limit exceeded
  500: Internal error
```

---

## 6. Rate Limiting Documentation

### 6.1 Template

```markdown
## Rate Limiting

The API enforces rate limits to ensure fair usage and stability.

### Limits

| Plan | Limit | Window |
|---|---|---|
| Free | 100 requests | Per minute |
| Pro | 1,000 requests | Per minute |
| Enterprise | Custom | Custom |

### Rate Limit Headers

Every response includes rate limit information:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Maximum requests per window |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds to wait (only on 429 responses) |

**Example headers:**
\`\`\`
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1710500400
\`\`\`

### When Rate Limited (429)

\`\`\`json
{
  "error": {
    "code": "rate_limited",
    "message": "Rate limit exceeded. Retry after 23 seconds.",
    "details": {
      "retry_after": 23,
      "limit": 100,
      "window": "1m"
    }
  }
}
\`\`\`

### Best Practices

- Implement exponential backoff for retries
- Cache responses when possible to reduce API calls
- Use webhooks instead of polling for real-time updates
- Contact us for higher limits if you have a legitimate need
```

---

## 7. Pagination Documentation

### 7.1 Template

```markdown
## Pagination

List endpoints return paginated results using cursor-based pagination.

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `per_page` | integer | 20 | Items per page (max: 100) |
| `cursor` | string | - | Cursor from previous response's `next_cursor` |

### Response Format

\`\`\`json
{
  "data": [
    {"id": "usr_001", "name": "Alice"},
    {"id": "usr_002", "name": "Bob"}
  ],
  "pagination": {
    "per_page": 20,
    "next_cursor": "eyJpZCI6InVzcl8wMjAifQ==",
    "has_more": true
  }
}
\`\`\`

### Iterating Through All Pages

\`\`\`javascript
async function getAllUsers() {
  const users = [];
  let cursor = undefined;

  do {
    const url = new URL("https://api.example.com/v2/users");
    url.searchParams.set("per_page", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const { data, pagination } = await response.json();

    users.push(...data);
    cursor = pagination.has_more ? pagination.next_cursor : undefined;
  } while (cursor);

  return users;
}
\`\`\`
```

---

## 8. Webhook Documentation

### 8.1 Template

```markdown
## Webhooks

Receive real-time notifications when events occur in your account.

### Setting Up Webhooks

1. Go to [Dashboard > Settings > Webhooks](https://dashboard.example.com/webhooks)
2. Click "Add Endpoint"
3. Enter your URL (must be HTTPS)
4. Select which events to subscribe to
5. Copy the signing secret

### Event Types

| Event | Description | Trigger |
|---|---|---|
| `user.created` | New user registered | POST /users |
| `user.updated` | User profile changed | PATCH /users/{id} |
| `order.completed` | Order payment successful | Payment confirmation |
| `order.refunded` | Order refund processed | POST /orders/{id}/refund |

### Webhook Payload

\`\`\`json
{
  "id": "evt_abc123",
  "type": "order.completed",
  "created_at": "2024-03-15T14:30:00Z",
  "data": {
    "order_id": "ord_xyz789",
    "total": 159.99,
    "currency": "BRL"
  }
}
\`\`\`

### Verifying Signatures

Every webhook includes a `X-Signature-256` header. Verify it to ensure the request came from us:

\`\`\`javascript
import crypto from "node:crypto";

function verifyWebhook(payload, signature, secret) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// In your handler
app.post("/webhooks", (req, res) => {
  const signature = req.headers["x-signature-256"];
  const isValid = verifyWebhook(req.rawBody, signature, WEBHOOK_SECRET);

  if (!isValid) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Process the webhook
  const event = req.body;
  // ...

  res.status(200).json({ received: true });
});
\`\`\`

### Retry Policy

If your endpoint returns a non-2xx status code, we retry with exponential backoff:

| Attempt | Delay |
|---|---|
| 1st retry | 1 minute |
| 2nd retry | 5 minutes |
| 3rd retry | 30 minutes |
| 4th retry | 2 hours |
| 5th retry | 24 hours |

After 5 failed retries, the webhook is marked as failed and you receive an email notification.

### Best Practices

- Return 200 quickly, process async (use a queue)
- Always verify the signature
- Handle duplicate events (use `id` field for idempotency)
- Log all received webhooks for debugging
```

---

## 9. SDKs and Client Libraries

### 9.1 When to Provide SDKs

```
Must have:
  - Official SDK for the language most of your consumers use
  - The SDK should be auto-generated from your OpenAPI spec

Nice to have:
  - SDKs for 2-3 additional popular languages
  - Community-contributed SDKs (link but don't maintain)

Don't bother:
  - SDKs for niche languages (point them to the REST API)
  - Hand-written SDKs (hard to maintain, drift from spec)
```

### 9.2 SDK Documentation Template

```markdown
## JavaScript/TypeScript SDK

### Installation

\`\`\`bash
npm install @example/api-client
\`\`\`

### Quick Start

\`\`\`typescript
import { ExampleClient } from "@example/api-client";

const client = new ExampleClient({ apiKey: "sk_live_..." });

// Create a user
const user = await client.users.create({
  name: "Maria Silva",
  email: "maria@example.com",
});

// List orders with pagination
const orders = await client.orders.list({ perPage: 50 });
for await (const order of orders) {
  console.log(order.id, order.total);
}
```

---

## 10. Interactive Documentation Tools

### 10.1 Tool Comparison

| Tool | Best For | Customization | OpenAPI Support | Cost |
|---|---|---|---|---|
| **Scalar** | Modern, clean API docs | High (themes, layouts) | 3.0 + 3.1 | Free (open source) |
| **Swagger UI** | Quick setup from OpenAPI | Medium | 3.0 + 3.1 | Free (open source) |
| **Stoplight** | Large API programs | High (full platform) | 3.0 + 3.1 | Free tier + paid |
| **Redoc** | Beautiful read-only docs | Medium (themes) | 3.0 + 3.1 | Free (open source) |

### 10.2 Quick Setup with Scalar

```html
<!-- Add to any HTML page -->
<!doctype html>
<html>
<head>
  <title>API Documentation</title>
  <meta charset="utf-8" />
</head>
<body>
  <script
    id="api-reference"
    data-url="/openapi.yaml"
    data-configuration='{"theme": "purple"}'
  ></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>
```

### 10.3 Quick Setup with Swagger UI

```yaml
# docker-compose.yml — add alongside your API
services:
  api-docs:
    image: swaggerapi/swagger-ui
    ports:
      - "8081:8080"
    environment:
      SWAGGER_JSON: /app/openapi.yaml
    volumes:
      - ./docs/openapi.yaml:/app/openapi.yaml:ro
```

---

## 11. Changelog for API Changes

### 11.1 API Changelog Template

```markdown
# API Changelog

## 2024-03-15

### Added
- `PATCH /v2/users/{id}` now accepts `timezone` field
- New webhook event: `order.refunded`

### Changed
- `GET /v2/orders` default `per_page` changed from 10 to 20

### Deprecated
- `GET /v1/users/search` — use `GET /v2/users?q=` instead. Sunset: 2024-06-15.

### Fixed
- `POST /v2/orders` now correctly validates `shipping_address_id` before processing

---

## 2024-03-01

### Breaking (v2 only)
- Removed `name` field from user responses (use `full_name` instead)
- Changed `created_at` format from Unix timestamp to ISO 8601
```

### 11.2 Communication Channels

```
For API changes, communicate via:
  1. API changelog (always — this is the canonical record)
  2. Deprecation headers on affected endpoints
  3. Email to registered developers (for breaking changes)
  4. Status page announcement (for breaking changes)
  5. SDK release notes (when SDK is updated to match)
```

---

## Quick Reference: API Documentation Checklist

```
For every API, document:
  [ ] Authentication (how to get a token, where to send it)
  [ ] Base URL (production + staging)
  [ ] Rate limits (per plan, with headers)
  [ ] Error format (standard structure, all possible codes)
  [ ] Pagination (how to iterate, response format)

For every endpoint, document:
  [ ] Method + URL
  [ ] Description (one sentence)
  [ ] Authentication requirements
  [ ] All parameters (path, query, header, body)
  [ ] Constraints (min/max, format, required)
  [ ] Example request (curl + primary language)
  [ ] Success response (status + body)
  [ ] All error responses (status + code + when)
```
