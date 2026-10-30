# Request & Response Design

Request body patterns, response envelopes, content negotiation, and data format conventions.

---

## Table of Contents

1. [Request Body Design](#1-request-body-design)
2. [Response Envelope Pattern](#2-response-envelope-pattern)
3. [JSON:API Format](#3-jsonapi-format)
4. [Single Resource vs Collection Response](#4-single-resource-vs-collection-response)
5. [Partial Responses (Sparse Fieldsets)](#5-partial-responses-sparse-fieldsets)
6. [Resource Inclusion](#6-resource-inclusion)
7. [Null Handling](#7-null-handling)
8. [Date and Time Format](#8-date-and-time-format)
9. [Money and Currency](#9-money-and-currency)
10. [File Upload Patterns](#10-file-upload-patterns)
11. [Async Operations](#11-async-operations)
12. [Idempotency Keys](#12-idempotency-keys)
13. [ETags and Conditional Requests](#13-etags-and-conditional-requests)

---

## 1. Request Body Design

### Required vs Optional Fields

```json
POST /api/users
Content-Type: application/json

{
  "name": "Ana Silva",           // required — reject if missing
  "email": "ana@example.com",    // required — reject if missing
  "role": "editor",              // optional — defaults to "user"
  "avatar_url": null,            // optional — explicitly no avatar
  "metadata": {}                 // optional — empty object is valid
}
```

### Validation Rules — Document Inline

```
For each field, define:
  name        string, required, 1-255 chars
  email       string, required, valid email format, unique
  role        string, optional, enum: ["user", "editor", "admin"], default: "user"
  avatar_url  string|null, optional, valid URL
  metadata    object, optional, max 10 keys, max 1KB
```

### WRONG: Accepting Anything

```json
WRONG (no validation, no type enforcement):
POST /api/users
{ "name": 123, "email": true, "role": "superadmin", "extra_field": "ignored" }
Response: 201 Created  // silently accepted garbage

CORRECT (strict validation):
POST /api/users
{ "name": 123, "email": true, "role": "superadmin" }
Response: 422 Unprocessable Entity
{
  "error": {
    "code": "validation_error",
    "message": "Validation failed.",
    "details": [
      { "field": "name", "code": "invalid_type", "message": "Must be a string." },
      { "field": "email", "code": "invalid_type", "message": "Must be a string." },
      { "field": "role", "code": "invalid_value", "message": "Must be one of: user, editor, admin." }
    ]
  }
}
```

### Reject Unknown Fields

```json
WRONG (silently ignores unknown fields):
POST /api/users
{ "name": "Ana", "email": "ana@ex.com", "is_admin": true, "password_hash": "..." }
Response: 201 Created  // "is_admin" and "password_hash" silently ignored — dangerous

CORRECT (reject unknown fields):
Response: 400 Bad Request
{
  "error": {
    "code": "unknown_fields",
    "message": "Unknown fields: is_admin, password_hash"
  }
}

Alternative (acceptable): Ignore unknown fields but LOG them for monitoring.
Never silently accept fields that look like privilege escalation.
```

### Create vs Update Request Bodies

```json
// CREATE — requires all mandatory fields
POST /api/users
{
  "name": "Ana",
  "email": "ana@example.com"
}

// UPDATE (PATCH) — all fields optional, only send what changed
PATCH /api/users/123
{
  "name": "Ana Silva"
}

// REPLACE (PUT) — full resource, all fields present
PUT /api/users/123
{
  "name": "Ana Silva",
  "email": "ana@example.com",
  "role": "admin"
}

WRONG:
PATCH /api/users/123
{}  // empty patch — should return 400, nothing to update
```

---

## 2. Response Envelope Pattern

### Standard Envelope

```json
// Single resource
{
  "data": {
    "id": "usr_123",
    "name": "Ana Silva",
    "email": "ana@example.com",
    "created_at": "2026-04-11T10:30:00Z"
  }
}

// Collection
{
  "data": [
    { "id": "usr_123", "name": "Ana Silva" },
    { "id": "usr_456", "name": "Carlos Lima" }
  ],
  "meta": {
    "total": 87,
    "page": 1,
    "per_page": 20,
    "last_page": 5
  },
  "links": {
    "self": "/api/users?page=1",
    "next": "/api/users?page=2",
    "last": "/api/users?page=5"
  }
}

// Error
{
  "error": {
    "code": "not_found",
    "message": "User not found."
  }
}
```

### WRONG: Raw Arrays and Inconsistent Shapes

```json
WRONG (raw array — can't add metadata later without breaking change):
[{"id": 1}, {"id": 2}]

WRONG (raw object — inconsistent with collections):
{"id": 1, "name": "Ana"}

WRONG (mixing data and metadata at same level):
{
  "users": [{"id": 1}],
  "total": 100,
  "page": 1
}

WRONG (success and error share same keys):
{"status": "error", "data": null, "message": "Not found"}

CORRECT (always "data" for success, always "error" for failure):
// Success: { "data": ... }
// Success + meta: { "data": ..., "meta": ..., "links": ... }
// Error: { "error": { "code": ..., "message": ... } }
```

### Envelope for Empty Collections

```json
WRONG:
GET /api/users?role=ceo
Response: 404 Not Found  // "no results" is not "not found"

CORRECT:
GET /api/users?role=ceo
Response: 200 OK
{
  "data": [],
  "meta": { "total": 0, "page": 1, "per_page": 20, "last_page": 0 }
}
```

---

## 3. JSON:API Format

JSON:API (jsonapi.org) is a specification for building APIs. Use it when you need a strict, community-standard format.

### When to Adopt JSON:API

```
USE JSON:API when:
  - Building a public API that many third parties will consume
  - You want automatic SDK generation (JSON:API has libraries for every language)
  - You need standardized resource linking and inclusion
  - Team has no strong API design opinions (JSON:API decides for you)

SKIP JSON:API when:
  - Internal API consumed by your own frontend
  - You want simpler responses (JSON:API is verbose)
  - Team already has a well-established API convention
  - Performance-critical APIs (JSON:API overhead)
```

### JSON:API Response Shape

```json
GET /api/articles/1?include=author

{
  "data": {
    "type": "articles",
    "id": "1",
    "attributes": {
      "title": "REST Design Guide",
      "body": "...",
      "created_at": "2026-04-11T10:30:00Z"
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "42" }
      }
    }
  },
  "included": [
    {
      "type": "users",
      "id": "42",
      "attributes": {
        "name": "Ana Silva",
        "email": "ana@example.com"
      }
    }
  ]
}
```

Recommendation: For most APIs, the simple `{ "data", "meta", "links" }` envelope is enough. Use JSON:API only when you need the full spec.

---

## 4. Single Resource vs Collection Response

### Single Resource

```json
GET /api/users/123  ->  200 OK

{
  "data": {
    "id": "usr_123",
    "name": "Ana Silva",
    "email": "ana@example.com",
    "role": "admin",
    "created_at": "2026-04-11T10:30:00Z",
    "updated_at": "2026-04-11T14:00:00Z"
  }
}

// Full detail — includes all fields
```

### Collection Resource

```json
GET /api/users  ->  200 OK

{
  "data": [
    {
      "id": "usr_123",
      "name": "Ana Silva",
      "email": "ana@example.com",
      "role": "admin"
    },
    {
      "id": "usr_456",
      "name": "Carlos Lima",
      "email": "carlos@example.com",
      "role": "user"
    }
  ],
  "meta": {
    "total": 87,
    "page": 1,
    "per_page": 20,
    "last_page": 5
  }
}

// Summary — fewer fields than single resource (performance)
```

### WRONG: Different Structures for Same Resource

```json
WRONG:
GET /api/users      ->  { "users": [...] }
GET /api/users/123  ->  { "user": {...} }

CORRECT:
GET /api/users      ->  { "data": [...] }
GET /api/users/123  ->  { "data": {...} }

"data" is always the key. Array for collections, object for singles.
```

---

## 5. Partial Responses (Sparse Fieldsets)

### Basic Field Selection

```
GET /api/users?fields=id,name,email

Response:
{
  "data": [
    { "id": "usr_123", "name": "Ana Silva", "email": "ana@example.com" },
    { "id": "usr_456", "name": "Carlos Lima", "email": "carlos@example.com" }
  ]
}

Without ?fields — all fields returned:
{
  "data": [
    {
      "id": "usr_123",
      "name": "Ana Silva",
      "email": "ana@example.com",
      "role": "admin",
      "phone": "+55...",
      "avatar_url": "...",
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

### Per-Resource Type Field Selection

```
GET /api/orders?include=customer&fields[orders]=id,total,status&fields[customers]=id,name

Response:
{
  "data": [
    {
      "id": "ord_1",
      "total": 15000,
      "status": "shipped",
      "customer": {
        "id": "usr_123",
        "name": "Ana Silva"
      }
    }
  ]
}
```

### Always Include ID

```
WRONG:
GET /api/users?fields=name,email
{ "data": [{ "name": "Ana", "email": "..." }] }  // no ID — useless

CORRECT:
Always include "id" even if not explicitly requested.
GET /api/users?fields=name,email
{ "data": [{ "id": "usr_123", "name": "Ana", "email": "..." }] }
```

---

## 6. Resource Inclusion

### Include Related Resources

```
GET /api/orders/456?include=customer,items

{
  "data": {
    "id": "ord_456",
    "status": "shipped",
    "total": 15000,
    "customer": {
      "id": "usr_123",
      "name": "Ana Silva"
    },
    "items": [
      { "id": "itm_1", "product_name": "Keyboard", "quantity": 1, "price": 8000 },
      { "id": "itm_2", "product_name": "Mouse", "quantity": 2, "price": 3500 }
    ]
  }
}
```

### Without Include — Only IDs

```
GET /api/orders/456

{
  "data": {
    "id": "ord_456",
    "status": "shipped",
    "total": 15000,
    "customer_id": "usr_123"
  }
}

No includes = no embedded data = smallest payload.
```

### WRONG: Always Embedding Everything

```json
WRONG (no control, always heavy payload):
GET /api/orders/456
{
  "data": {
    "id": "ord_456",
    "customer": { "id": "usr_123", "name": "Ana", "email": "...", "addresses": [...] },
    "items": [{ "id": "itm_1", "product": { "id": "prd_1", "reviews": [...] } }],
    "shipping_address": { ... },
    "invoice": { ... }
  }
}

CORRECT: Default to minimal, expand on demand via ?include=
```

---

## 7. Null Handling

### Strategy 1: Omit Null Fields (Recommended for Responses)

```json
{
  "data": {
    "id": "usr_123",
    "name": "Ana Silva",
    "email": "ana@example.com"
    // "phone" omitted because it's null — reduces payload
  }
}
```

### Strategy 2: Explicit Null (When Absence Has Meaning)

```json
{
  "data": {
    "id": "usr_123",
    "name": "Ana Silva",
    "email": "ana@example.com",
    "phone": null,
    "deleted_at": null
  }
}

Use explicit null when:
  - Client needs to distinguish "field not set" from "field not returned"
  - PATCH requests: null means "clear this field"
  - Field was previously set and was explicitly removed
```

### WRONG: Mixed Strategy Without Documentation

```json
WRONG (inconsistent, client can't tell if field is null or just omitted):
// Response A:
{ "name": "Ana", "phone": null }
// Response B:
{ "name": "Carlos" }  // phone null? or field not supported?

CORRECT: Pick one strategy, document it, apply it consistently:
  - Omit nulls in list endpoints (performance)
  - Include nulls in detail endpoints (completeness)
```

### Null in PATCH Requests

```json
PATCH /api/users/123
{
  "phone": null        // explicitly remove phone number
}

PATCH /api/users/123
{
  "name": "Ana Silva"  // phone not mentioned — leave it unchanged
}

Important distinction:
  { "phone": null }    -> set phone to null (clear it)
  { }                  -> don't touch phone (keep current value)
  // phone omitted     -> don't touch phone (keep current value)
```

---

## 8. Date and Time Format

### Always ISO 8601 UTC

```json
WRONG:
"created_at": "04/11/2026"                     // ambiguous DD/MM or MM/DD
"created_at": "April 11, 2026"                  // locale-dependent
"created_at": "2026-04-11 10:30:00"             // no timezone
"created_at": 1712835000                         // epoch — not human readable
"created_at": "2026-04-11T10:30:00-03:00"       // local timezone

CORRECT:
"created_at": "2026-04-11T10:30:00Z"            // always UTC, always Z suffix

For durations: ISO 8601 duration format
"duration": "PT2H30M"                            // 2 hours 30 minutes
"trial_period": "P14D"                           // 14 days
```

### Date-Only Fields

```json
"birth_date": "2026-04-11"          // date only — no time component
"due_date": "2026-12-31"            // no "T", no "Z"

WRONG:
"birth_date": "2026-04-11T00:00:00Z"   // date with fake midnight time
```

### Accept Flexible Input, Return Strict Output

```
Accept in requests:
  "2026-04-11T10:30:00Z"
  "2026-04-11T10:30:00+00:00"
  "2026-04-11T13:30:00+03:00"        // converts to UTC

Always return:
  "2026-04-11T10:30:00Z"             // UTC, Z suffix
```

---

## 9. Money and Currency

### Always Integer Cents (Never Floats)

```json
WRONG (floating point — IEEE 754 precision loss):
{ "price": 19.99 }              // 19.99 might become 19.990000000000002
{ "total": 0.1 + 0.2 }          // = 0.30000000000000004

CORRECT (integer in smallest currency unit):
{ "price": 1999 }               // 1999 cents = $19.99
{ "total": 30 }                  // 30 cents = $0.30
```

### Include Currency Code

```json
WRONG (no currency — 1999 what?):
{
  "price": 1999
}

CORRECT:
{
  "price": 1999,
  "currency": "USD"
}

// Or as an object for multi-currency:
{
  "amount": {
    "value": 1999,
    "currency": "BRL"
  }
}
```

### Currencies Without Decimals

```json
// Japanese Yen (0 decimal places): 1 JPY = 1 unit
{ "price": 2000, "currency": "JPY" }  // 2000 yen, not 20.00

// Bahraini Dinar (3 decimal places): 1 BHD = 1000 fils
{ "price": 1500, "currency": "BHD" }  // 1.500 BHD

Rule: Always use the currency's smallest unit. Check ISO 4217 for decimal places.
```

---

## 10. File Upload Patterns

### Strategy 1: Multipart Form Data (Simple, Small Files)

```
POST /api/users/123/avatar
Content-Type: multipart/form-data; boundary=---abc

-----abc
Content-Disposition: form-data; name="file"; filename="avatar.jpg"
Content-Type: image/jpeg

<binary data>
-----abc--

Response: 200 OK
{
  "data": {
    "url": "https://cdn.example.com/avatars/usr_123.jpg",
    "size": 45678,
    "content_type": "image/jpeg"
  }
}

Good for: files under 10MB, simple uploads, avatar/logo
```

### Strategy 2: Presigned URL (Recommended for Large Files)

```
Step 1: Client requests an upload URL
POST /api/uploads
{
  "filename": "report.pdf",
  "content_type": "application/pdf",
  "size": 5242880
}

Response: 200 OK
{
  "data": {
    "upload_id": "upl_abc",
    "upload_url": "https://s3.amazonaws.com/bucket/...",
    "expires_at": "2026-04-11T10:45:00Z",
    "method": "PUT",
    "headers": {
      "Content-Type": "application/pdf"
    }
  }
}

Step 2: Client uploads directly to storage
PUT https://s3.amazonaws.com/bucket/...
Content-Type: application/pdf
<binary data>

Step 3: Client confirms upload
POST /api/uploads/upl_abc/complete
Response: 200 OK
{
  "data": {
    "file_id": "file_xyz",
    "url": "https://cdn.example.com/files/file_xyz.pdf",
    "size": 5242880
  }
}

Good for: large files, S3/GCS/Azure Blob, no load on API server
```

### Strategy 3: Base64 (Only for Tiny Files)

```json
POST /api/users/123/avatar
{
  "file": {
    "data": "iVBORw0KGgoAAAANSUhEUg...",
    "filename": "avatar.png",
    "content_type": "image/png"
  }
}

Good for: files under 100KB (thumbnails, signatures)
Bad for: anything larger (33% size overhead from base64 encoding)
```

### WRONG: File Upload Anti-Patterns

```
WRONG: Accepting unlimited file sizes
WRONG: No content type validation
WRONG: Storing files on the API server filesystem
WRONG: Using PUT /api/users/123 with file + JSON mixed in body

CORRECT:
- Enforce max file size (e.g., 10MB for direct, 5GB for presigned)
- Validate content type server-side (don't trust Content-Type header alone)
- Use object storage (S3, GCS) for all file storage
- Separate file upload from resource update
```

---

## 11. Async Operations

### Pattern: 202 Accepted + Polling

```
POST /api/reports/generate
{
  "type": "monthly_revenue",
  "period": "2026-03"
}

Response: 202 Accepted
Location: /api/jobs/job_789
Retry-After: 5

{
  "data": {
    "job_id": "job_789",
    "status": "pending",
    "created_at": "2026-04-11T10:30:00Z",
    "estimated_completion": "2026-04-11T10:31:00Z",
    "poll_url": "/api/jobs/job_789"
  }
}

Client polls:
GET /api/jobs/job_789  ->  { "data": { "status": "processing", "progress": 45 } }
GET /api/jobs/job_789  ->  { "data": { "status": "processing", "progress": 82 } }
GET /api/jobs/job_789  ->  { "data": { "status": "completed", "result_url": "/api/reports/rpt_abc" } }
GET /api/jobs/job_789  ->  { "data": { "status": "failed", "error": { "code": "timeout", "message": "..." } } }
```

### Pattern: Webhooks (Server-Push)

```
POST /api/reports/generate
{
  "type": "monthly_revenue",
  "period": "2026-03",
  "webhook_url": "https://client.example.com/hooks/reports"
}

Response: 202 Accepted
{ "data": { "job_id": "job_789", "status": "pending" } }

When done, server POSTs to webhook:
POST https://client.example.com/hooks/reports
{
  "event": "report.completed",
  "job_id": "job_789",
  "result_url": "/api/reports/rpt_abc",
  "completed_at": "2026-04-11T10:31:00Z"
}

Or on failure:
{
  "event": "report.failed",
  "job_id": "job_789",
  "error": { "code": "timeout", "message": "Report generation timed out." }
}
```

### Job Status States

```
pending     -> queued, not started
processing  -> actively being processed
completed   -> done, result available
failed      -> done, error occurred
cancelled   -> user or system cancelled

State machine:
pending -> processing -> completed
pending -> processing -> failed
pending -> cancelled
processing -> cancelled
```

---

## 12. Idempotency Keys

### Why: POST Is Not Idempotent

```
Problem: Client sends POST, gets a network timeout.
Did the request succeed? Client doesn't know.
Client retries -> might create duplicate resource.

Solution: Idempotency key in header.
Same key = same result, no duplicate.
```

### Implementation

```
POST /api/payments
Idempotency-Key: pay_req_abc123
Content-Type: application/json

{
  "amount": 5000,
  "currency": "BRL",
  "customer_id": "usr_123"
}

First call:
  Response: 201 Created
  { "data": { "id": "pay_xyz", "amount": 5000, "status": "processing" } }

Retry (same Idempotency-Key):
  Response: 201 Created (same response as first call, no duplicate payment)
  { "data": { "id": "pay_xyz", "amount": 5000, "status": "processing" } }
```

### WRONG: Idempotency Anti-Patterns

```
WRONG: Client-generated sequential IDs
  Idempotency-Key: 1  // guessable, collisions between clients

WRONG: No expiration
  Server stores idempotency keys forever -> unbounded storage

WRONG: Idempotency key in request body
  { "idempotency_key": "abc" }  // header is the standard

CORRECT:
  - Client-generated UUID v4 or ULID
  - Server stores for 24-48 hours, then expires
  - Header: Idempotency-Key: <uuid>
  - Return 409 Conflict if same key but different body
```

### Server-Side Behavior

```
pseudocode:

function handleRequest(key, body):
  existing = cache.get(key)
  
  if existing and existing.body == hash(body):
    return existing.response            // replay same response
  
  if existing and existing.body != hash(body):
    return 409 Conflict                 // same key, different body = error
  
  if existing and existing.status == "processing":
    return 409 Conflict                 // still processing, don't duplicate
  
  result = processRequest(body)
  cache.set(key, { body: hash(body), response: result }, ttl: 48h)
  return result
```

---

## 13. ETags and Conditional Requests

### ETag for Caching (If-None-Match)

```
First request:
GET /api/users/123
Response: 200 OK
ETag: "a1b2c3d4"
{
  "data": { "id": "usr_123", "name": "Ana", "updated_at": "2026-04-11T10:30:00Z" }
}

Subsequent request (client sends ETag):
GET /api/users/123
If-None-Match: "a1b2c3d4"

If resource hasn't changed:
  Response: 304 Not Modified (no body — save bandwidth)

If resource has changed:
  Response: 200 OK
  ETag: "e5f6g7h8"
  { "data": { "id": "usr_123", "name": "Ana Silva", ... } }
```

### ETag for Optimistic Locking (If-Match)

```
Step 1: Client fetches resource
GET /api/users/123
ETag: "a1b2c3d4"
{ "data": { "id": "usr_123", "name": "Ana" } }

Step 2: Client updates with ETag
PATCH /api/users/123
If-Match: "a1b2c3d4"
{ "name": "Ana Silva" }

If no one else modified (ETag matches):
  Response: 200 OK
  ETag: "e5f6g7h8"
  { "data": { "id": "usr_123", "name": "Ana Silva" } }

If someone else modified (ETag mismatch):
  Response: 409 Conflict (or 412 Precondition Failed)
  {
    "error": {
      "code": "conflict",
      "message": "Resource was modified by another request. Fetch and retry."
    }
  }
```

### ETag Generation Strategies

```
Option A: Hash of resource content
  ETag: md5(json_encode(resource))
  Pros: accurate, works for any storage
  Cons: compute cost

Option B: Last modified timestamp
  ETag: base64(updated_at)
  Pros: cheap, already in DB
  Cons: 1-second granularity issues

Option C: Version counter
  ETag: "v42"
  Pros: simple, no hash needed
  Cons: requires version column in DB

Recommendation: Use updated_at for reads, version counter for writes.
```

### WRONG: ETag Anti-Patterns

```
WRONG: Weak ETags without the W/ prefix
  ETag: "abc"  // when it's actually a weak ETag

WRONG: ETag that changes on every request
  ETag: random()  // defeats caching entirely

WRONG: Same ETag for different representations
  GET /api/users/123          -> ETag: "abc"
  GET /api/users/123?fields=name  -> ETag: "abc"  // different content, same ETag

CORRECT: ETag must change when content changes, and be stable when it doesn't.
```
