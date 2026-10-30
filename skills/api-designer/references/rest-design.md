# REST Design

Resource modeling, URL structure, HTTP methods, and API paradigm decisions.

---

## Table of Contents

1. [Resource Modeling](#1-resource-modeling)
2. [URL Structure Conventions](#2-url-structure-conventions)
3. [HTTP Methods Semantics](#3-http-methods-semantics)
4. [Sub-Resources vs Query Parameters](#4-sub-resources-vs-query-parameters)
5. [Bulk Operations](#5-bulk-operations)
6. [Action Endpoints](#6-action-endpoints)
7. [Singleton Resources](#7-singleton-resources)
8. [Soft Delete vs Hard Delete](#8-soft-delete-vs-hard-delete)
9. [Resource Expansion and Embedding](#9-resource-expansion-and-embedding)
10. [Multi-Tenant SaaS APIs](#10-multi-tenant-saas-apis)
11. [GraphQL vs REST](#11-graphql-vs-rest)
12. [gRPC vs REST](#12-grpc-vs-rest)

---

## 1. Resource Modeling

Resources are nouns that represent domain concepts. They are NOT database tables — they are the public contract your consumers interact with.

### Identify Resources from Domain

```
Domain concept     ->  Resource       ->  Base URL
Customer           ->  customers      ->  /api/customers
Purchase Order     ->  orders         ->  /api/orders
Product Category   ->  categories     ->  /api/categories
Shopping Cart      ->  carts          ->  /api/carts
Shipping Address   ->  addresses      ->  /api/addresses
```

### WRONG: Verbs as Resources

```
WRONG:
GET  /api/getUsers
POST /api/createOrder
POST /api/sendEmail
GET  /api/fetchReports
POST /api/doPayment

CORRECT:
GET  /api/users
POST /api/orders
POST /api/emails           (or POST /api/notifications)
GET  /api/reports
POST /api/payments
```

### WRONG: Database Tables as Resources

```
WRONG (exposes internal schema):
GET /api/user_accounts           # DB table name
GET /api/order_line_items        # implementation detail
GET /api/usr_addr_mapping        # abbreviation

CORRECT (domain-oriented):
GET /api/users
GET /api/order-items
GET /api/addresses
```

### Composite Resources (Aggregation)

When clients always need related data together, create a composite resource:

```
Instead of clients calling:
  GET /api/users/123
  GET /api/users/123/profile
  GET /api/users/123/preferences

Create a composite:
  GET /api/users/123/dashboard
  
Response:
{
  "data": {
    "user": { "id": "usr_123", "name": "Ana" },
    "profile": { "bio": "...", "avatar_url": "..." },
    "preferences": { "theme": "dark", "locale": "pt-BR" }
  }
}
```

---

## 2. URL Structure Conventions

### Plural Nouns Always

```
WRONG:
/api/user/123
/api/category/5
/api/order/789/item/1

CORRECT:
/api/users/123
/api/categories/5
/api/orders/789/items/1
```

### kebab-case for Multi-Word Resources

```
WRONG:
/api/orderItems
/api/order_items
/api/OrderItems
/api/productCategories

CORRECT:
/api/order-items
/api/product-categories
/api/shipping-addresses
/api/payment-methods
```

### Nesting: Max 2 Levels Deep

```
GOOD (1 level):
GET /api/users/123/orders

GOOD (2 levels):
GET /api/users/123/orders/456

BAD (3+ levels — hard to maintain, URL explosion):
GET /api/users/123/orders/456/items/789
GET /api/users/123/orders/456/items/789/variants/2

CORRECT (flatten and use top-level resource):
GET /api/order-items/789
GET /api/order-items?order_id=456
GET /api/product-variants/2
```

### Always Prefix with /api

```
WRONG:
/users
/v1/users

CORRECT:
/api/users
/api/v2/users     (when versioning is needed)
```

### Consistent Trailing Slashes (pick one, enforce it)

```
Pick ONE convention for the entire API:

Option A (no trailing slash — recommended):
GET /api/users
GET /api/users/123

Option B (trailing slash):
GET /api/users/
GET /api/users/123/

WRONG (inconsistent):
GET /api/users/     <- trailing
GET /api/orders     <- no trailing
```

### URL Structure for Hierarchical Resources

```
Company > Department > Employee

Option A: Full hierarchy (clear ownership)
GET /api/companies/acme/departments/eng/employees

Option B: Flat with filters (simpler, more flexible)
GET /api/employees?company=acme&department=eng

Rule of thumb:
- Use hierarchy when child cannot exist without parent
- Use flat when child has independent identity
```

---

## 3. HTTP Methods Semantics

### Method Reference

```
Method   | CRUD     | Idempotent | Safe | Request Body | Success Code
---------|----------|------------|------|--------------|-------------
GET      | Read     | Yes        | Yes  | No           | 200
POST     | Create   | No*        | No   | Yes          | 201
PUT      | Replace  | Yes        | No   | Yes          | 200
PATCH    | Update   | No**       | No   | Yes          | 200
DELETE   | Delete   | Yes        | No   | No           | 204

* POST can be made idempotent with idempotency keys
** PATCH is idempotent if using merge-patch, not if using JSON Patch
```

### GET — Retrieve (Safe, Idempotent)

```
GET /api/users              -> 200 with collection
GET /api/users/123          -> 200 with single resource
GET /api/users/999          -> 404

WRONG:
GET /api/users/123/delete   # side effect in GET
GET /api/users?action=purge # mutation via GET
```

Never modify state on GET. Caches, crawlers, and prefetch will call it freely.

### POST — Create (Not Idempotent)

```
POST /api/users
Content-Type: application/json

{ "name": "Ana", "email": "ana@example.com" }

Response: 201 Created
Location: /api/users/usr_abc123

{
  "data": {
    "id": "usr_abc123",
    "name": "Ana",
    "email": "ana@example.com",
    "created_at": "2026-04-11T10:30:00Z"
  }
}

WRONG:
200 OK              # Should be 201 for creation
No Location header  # Client can't find the new resource
```

### PUT — Full Replace (Idempotent)

```
PUT /api/users/123
Content-Type: application/json

{
  "name": "Ana Silva",
  "email": "ana.silva@example.com",
  "role": "admin"
}

Rule: PUT replaces the ENTIRE resource.
Omitted fields are set to null/default.

WRONG:
PUT /api/users/123
{ "name": "Ana Silva" }
# This should clear email and role, not keep old values
# If you want partial update, use PATCH
```

### PATCH — Partial Update (Use Merge Patch)

```
PATCH /api/users/123
Content-Type: application/merge-patch+json

{ "name": "Ana Silva" }

Only "name" changes. All other fields remain untouched.

Response: 200 OK
{
  "data": {
    "id": "usr_123",
    "name": "Ana Silva",
    "email": "ana@example.com",
    "role": "user"
  }
}
```

### DELETE — Remove (Idempotent)

```
DELETE /api/users/123  ->  204 No Content

Calling DELETE again on the same resource:
  Option A: 204 No Content (recommended — truly idempotent)
  Option B: 404 Not Found (also acceptable)

WRONG:
DELETE /api/users/123  ->  200 with body  # Use 204, no body needed
```

---

## 4. Sub-Resources vs Query Parameters

### Use Sub-Resources When

```
The child belongs to the parent and has no independent identity:

GET /api/users/123/addresses        # user's addresses
GET /api/orders/456/items           # order's line items
GET /api/posts/789/comments         # post's comments
POST /api/users/123/addresses       # create address for user 123
```

### Use Query Parameters When

```
Filtering a top-level collection:

GET /api/orders?user_id=123         # user's orders (orders exist independently)
GET /api/products?category=shoes    # filtered products
GET /api/invoices?status=overdue    # filtered invoices
```

### Decision Matrix

```
Question                                          | Sub-resource | Query param
--------------------------------------------------|--------------|------------
Child cannot exist without parent?                | Yes          | -
Child has its own lifecycle?                       | -            | Yes
You need to filter by multiple parents?            | -            | Yes
URL reads naturally as "parent's children"?        | Yes          | -
Child is shared across multiple parents?           | -            | Yes
```

### WRONG: Inconsistent Strategy

```
WRONG (mixing without reason):
GET /api/users/123/orders           # sub-resource
GET /api/invoices?user_id=123       # query param for same pattern

CORRECT (consistent strategy):
GET /api/users/123/orders           # direct ownership
GET /api/users/123/invoices         # direct ownership
OR:
GET /api/orders?user_id=123
GET /api/invoices?user_id=123
```

---

## 5. Bulk Operations

### Batch Create

```
POST /api/users/batch
Content-Type: application/json

{
  "items": [
    { "name": "Ana", "email": "ana@example.com" },
    { "name": "Carlos", "email": "carlos@example.com" },
    { "name": "invalid-email" }
  ]
}

Response: 207 Multi-Status (partial success)
{
  "data": [
    { "status": 201, "data": { "id": "usr_1", "name": "Ana", "email": "ana@example.com" } },
    { "status": 201, "data": { "id": "usr_2", "name": "Carlos", "email": "carlos@example.com" } },
    { "status": 422, "error": { "code": "validation_error", "message": "Invalid email format" } }
  ],
  "meta": {
    "total": 3,
    "succeeded": 2,
    "failed": 1
  }
}
```

### Batch Update

```
PATCH /api/users/batch
Content-Type: application/json

{
  "items": [
    { "id": "usr_1", "role": "admin" },
    { "id": "usr_2", "role": "editor" }
  ]
}

Response: 200 OK
{
  "data": [
    { "status": 200, "data": { "id": "usr_1", "role": "admin" } },
    { "status": 200, "data": { "id": "usr_2", "role": "editor" } }
  ]
}
```

### Batch Delete

```
DELETE /api/users/batch
Content-Type: application/json

{
  "ids": ["usr_1", "usr_2", "usr_3"]
}

Response: 200 OK
{
  "data": [
    { "id": "usr_1", "status": 204 },
    { "id": "usr_2", "status": 204 },
    { "id": "usr_3", "status": 404, "error": { "code": "not_found" } }
  ]
}

Alternative (all-or-nothing):
Response: 204 No Content (if all succeeded)
Response: 404 Not Found (if any not found, none deleted)
```

### Batch Size Limits

```
Always enforce a maximum batch size:

POST /api/users/batch
{ "items": [... 1001 items ...] }

Response: 400 Bad Request
{
  "error": {
    "code": "batch_too_large",
    "message": "Maximum batch size is 1000 items. Received 1001."
  }
}
```

---

## 6. Action Endpoints

For operations that don't map to CRUD, use POST with an action verb:

```
Non-CRUD operations:
POST /api/orders/{id}/cancel
POST /api/orders/{id}/refund
POST /api/users/{id}/deactivate
POST /api/users/{id}/reset-password
POST /api/reports/{id}/export
POST /api/emails/{id}/resend
POST /api/deployments/{id}/rollback

WRONG:
PATCH /api/orders/123 { "status": "cancelled" }  # Hides business logic
GET /api/orders/123/cancel                        # Mutation via GET
DELETE /api/orders/123                             # Cancel is not delete
PUT /api/orders/123/status                         # Too generic
```

### Action with Request Body

```
POST /api/orders/789/refund
Content-Type: application/json

{
  "reason": "customer_request",
  "amount": 2500,
  "notify_customer": true
}

Response: 200 OK
{
  "data": {
    "refund_id": "ref_abc",
    "order_id": "ord_789",
    "amount": 2500,
    "status": "processing",
    "created_at": "2026-04-11T10:30:00Z"
  }
}
```

### Action that Creates a New Resource

```
POST /api/orders/789/invoices    # Generates invoice for order
Response: 201 Created
Location: /api/invoices/inv_456

POST /api/reports/generate       # Triggers report generation
Response: 202 Accepted           # Async — report is being generated
Location: /api/reports/rpt_789
```

---

## 7. Singleton Resources

Resources where only one instance exists per context:

```
Current user's profile:
GET    /api/me
PATCH  /api/me
DELETE /api/me

Current user's settings:
GET    /api/me/settings
PUT    /api/me/settings

Application settings:
GET    /api/settings
PUT    /api/settings

Organization billing:
GET    /api/billing
PUT    /api/billing

WRONG:
GET /api/users/me              # "me" is not an ID
GET /api/users/current         # mixing IDs with keywords
GET /api/settings/1            # singleton doesn't need an ID
```

### Singleton Response

```
GET /api/me

Response: 200 OK
{
  "data": {
    "id": "usr_abc",
    "name": "Ana Silva",
    "email": "ana@example.com",
    "role": "admin",
    "organization": {
      "id": "org_xyz",
      "name": "Acme Corp"
    }
  }
}

No pagination, no collection wrapper — just the single resource.
```

---

## 8. Soft Delete vs Hard Delete

### Soft Delete (Recommended for Most Cases)

```
DELETE /api/users/123  ->  204 No Content

Server-side: sets deleted_at timestamp, does NOT remove the row.

The resource disappears from listings:
GET /api/users  -> does not include user 123

But can be recovered:
POST /api/users/123/restore  ->  200 OK

Admin can see deleted resources:
GET /api/users?include_deleted=true
GET /api/users/123?include_deleted=true
```

### Hard Delete (Irreversible)

```
Use for:
- GDPR data erasure requests
- Test data cleanup
- Truly ephemeral resources (sessions, temp files)

POST /api/users/123/purge    # Permanent deletion
Response: 204 No Content     # Gone forever
```

### Response After Soft Delete

```
WRONG:
GET /api/users/123  ->  200 OK with deleted user data
# Client thinks user is active

CORRECT:
GET /api/users/123  ->  404 Not Found
# Or:
GET /api/users/123  ->  410 Gone (if you want to communicate "was here, now deleted")

{
  "error": {
    "code": "resource_deleted",
    "message": "This user has been deleted.",
    "deleted_at": "2026-04-11T10:30:00Z"
  }
}
```

---

## 9. Resource Expansion and Embedding

Allow clients to request related resources in a single call:

### Query Parameter Approach

```
GET /api/orders/456?include=customer,items

Response:
{
  "data": {
    "id": "ord_456",
    "status": "shipped",
    "total": 15000,
    "customer": {
      "id": "usr_123",
      "name": "Ana Silva",
      "email": "ana@example.com"
    },
    "items": [
      { "id": "itm_1", "product_name": "Keyboard", "quantity": 1, "price": 8000 },
      { "id": "itm_2", "product_name": "Mouse", "quantity": 2, "price": 3500 }
    ]
  }
}

Without ?include:
{
  "data": {
    "id": "ord_456",
    "status": "shipped",
    "total": 15000,
    "customer_id": "usr_123"
  }
}
```

### Limit Expansion Depth

```
WRONG (unbounded expansion, N+1 hell):
GET /api/orders/456?include=customer.addresses.country,items.product.reviews

CORRECT (max 1 level, whitelist allowed includes):
GET /api/orders/456?include=customer,items

If client needs deeper data:
GET /api/orders/456?include=items
GET /api/products/prod_1?include=reviews
```

### Document Available Expansions

```
Each endpoint should document which includes are supported:

# GET /api/orders/{id}
#
# Supported includes: customer, items, shipping_address, invoice
# Maximum includes per request: 4
```

---

## 10. Multi-Tenant SaaS APIs

### Strategy 1: Tenant in URL Path

```
GET /api/tenants/{tenant_id}/users
GET /api/tenants/acme/orders

Pros: explicit, cacheable per tenant, easy routing
Cons: longer URLs, tenant leaks into every URL
```

### Strategy 2: Tenant in Header

```
GET /api/users
X-Tenant-ID: acme

Pros: clean URLs, tenant set once per session
Cons: harder to cache, easy to forget the header
```

### Strategy 3: Tenant from Auth Token (Recommended)

```
GET /api/users
Authorization: Bearer <token-contains-tenant-claim>

Server extracts tenant from JWT:
{
  "sub": "usr_123",
  "tenant": "acme",
  "role": "admin"
}

Pros: implicit, secure, no URL or header clutter
Cons: can't easily switch tenants without re-auth
```

### Strategy 4: Subdomain

```
GET https://acme.api.example.com/users
GET https://beta-corp.api.example.com/users

Pros: natural isolation, easy CDN/cache rules
Cons: DNS/TLS wildcard required, more infra complexity
```

### Decision Matrix

```
Scenario                            | Recommended Strategy
------------------------------------|-----------------------------
Single-product SaaS                 | Auth token (strategy 3)
Admin managing multiple tenants     | URL path (strategy 1)
White-label platform                | Subdomain (strategy 4)
Internal microservices              | Header (strategy 2)
```

---

## 11. GraphQL vs REST

### When REST Wins

```
- Public API with many third-party consumers (REST is universally understood)
- Simple CRUD operations with predictable access patterns
- Strong caching needs (HTTP caching works out of the box)
- File upload/download heavy workflows
- Webhook-driven integrations
- Team is experienced with REST, not GraphQL
```

### When GraphQL Wins

```
- Frontend-driven development with varied data needs per screen
- Mobile apps where payload size matters (request only needed fields)
- Aggregating data from multiple backend services into one query
- Rapid prototyping where API contracts change frequently
- Deeply nested relational data that would need many REST calls
```

### Hybrid Approach (Common in Practice)

```
REST for:
  - Public API (partners, third-party integrators)
  - Webhooks
  - File operations
  - Authentication endpoints

GraphQL for:
  - Internal frontend/mobile consumption
  - Dashboard data aggregation
  - Admin panels with complex queries

Both share the same domain models and business logic layer.
```

### WRONG: Using GraphQL to Avoid REST Design

```
WRONG reason to adopt GraphQL:
  "Our REST API is messy and inconsistent, GraphQL will fix it."

Reality: GraphQL requires even more discipline in schema design.
Fix your REST API design first. The same design skills apply to both.
```

---

## 12. gRPC vs REST

### When gRPC Wins

```
- Service-to-service communication (internal microservices)
- High-performance, low-latency requirements
- Streaming (bidirectional, server push)
- Strong typing needed across languages (protobuf schema)
- Bandwidth-constrained environments (binary protocol)
```

### When REST Wins

```
- Public-facing APIs (browser-friendly, universal tooling)
- Third-party integrations (everyone speaks HTTP/JSON)
- Simple request/response without streaming
- Team unfamiliar with protobuf/gRPC toolchain
- Debugging ease (curl, Postman, browser dev tools)
```

### Common Pattern: REST Gateway + gRPC Internal

```
Internet -> REST API Gateway -> gRPC services

Client (browser/mobile) speaks REST/JSON:
  POST /api/orders { "product_id": "prod_1", "quantity": 2 }

Gateway translates to gRPC:
  orderService.CreateOrder(CreateOrderRequest{
    product_id: "prod_1",
    quantity: 2
  })

gRPC response -> JSON serialization -> REST response

Tools: grpc-gateway, Connect (buf.build), Envoy proxy
```

### Protobuf Schema Example

```protobuf
syntax = "proto3";

service OrderService {
  rpc CreateOrder(CreateOrderRequest) returns (Order);
  rpc GetOrder(GetOrderRequest) returns (Order);
  rpc ListOrders(ListOrdersRequest) returns (ListOrdersResponse);
  rpc StreamOrderUpdates(StreamRequest) returns (stream OrderUpdate);
}

message CreateOrderRequest {
  string product_id = 1;
  int32 quantity = 2;
  string idempotency_key = 3;
}

message Order {
  string id = 1;
  string product_id = 2;
  int32 quantity = 3;
  int64 total_cents = 4;
  string status = 5;
  google.protobuf.Timestamp created_at = 6;
}
```

### Decision Guide Summary

```
Dimension            | REST         | GraphQL      | gRPC
---------------------|--------------|--------------|------------------
Audience             | Public/3rd   | Internal FE  | Internal services
Protocol             | HTTP/JSON    | HTTP/JSON    | HTTP/2 + Protobuf
Performance          | Good         | Good         | Excellent
Streaming            | SSE/WS       | Subscriptions| Native bidirectional
Caching              | HTTP native  | Complex      | No standard
Tooling              | Universal    | Growing      | Language-specific
Learning curve       | Low          | Medium       | High
Browser support      | Native       | Native       | Via gateway
Schema               | OpenAPI      | SDL          | Protobuf
```
