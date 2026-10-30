# Error Handling

Error response format, HTTP status codes, validation errors, and error communication patterns.

---

## Table of Contents

1. [Error Response Format](#1-error-response-format)
2. [Error Codes](#2-error-codes)
3. [Validation Errors](#3-validation-errors)
4. [HTTP Status Code Selection Guide](#4-http-status-code-selection-guide)
5. [Error Localization](#5-error-localization)
6. [Internal vs User-Facing Errors](#6-internal-vs-user-facing-errors)
7. [Problem Details RFC 9457](#7-problem-details-rfc-9457)
8. [Retry Guidance](#8-retry-guidance)
9. [Rate Limit Errors](#9-rate-limit-errors)
10. [Deprecation Warnings](#10-deprecation-warnings)
11. [Error Logging](#11-error-logging)

---

## 1. Error Response Format

### Standard Error Envelope

Every error response must follow the same structure, regardless of status code:

```json
{
  "error": {
    "code": "not_found",
    "message": "The requested user was not found.",
    "request_id": "req_abc123"
  }
}
```

### Full Error Structure

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request body contains invalid data.",
    "request_id": "req_abc123",
    "details": [
      {
        "field": "email",
        "code": "invalid_format",
        "message": "Must be a valid email address."
      },
      {
        "field": "age",
        "code": "out_of_range",
        "message": "Must be between 18 and 120.",
        "meta": { "min": 18, "max": 120, "received": 5 }
      }
    ],
    "doc_url": "https://docs.example.com/errors/validation_error"
  }
}
```

### WRONG: Inconsistent Error Shapes

```json
WRONG (different shapes for different errors):

// 400 errors:
{ "error": "Bad request" }

// 404 errors:
{ "message": "Not found", "status": 404 }

// 422 errors:
{ "errors": { "email": ["is required"], "name": ["too short"] } }

// 500 errors:
{ "statusCode": 500, "error": "Internal Server Error" }

CORRECT: One shape for ALL errors:
{
  "error": {
    "code": "<machine_readable>",
    "message": "<human_readable>",
    "request_id": "<trace_id>"
  }
}
```

### Always Include request_id

```json
{
  "error": {
    "code": "internal_error",
    "message": "An unexpected error occurred.",
    "request_id": "req_7f3a2b"
  }
}

Why: When users report issues, request_id lets you find the exact
server-side log entry. Without it, debugging is a needle-in-haystack.

Server-side log:
[req_7f3a2b] ERROR: NullPointerException at OrderService.java:42
[req_7f3a2b] Stack trace: ...
```

---

## 2. Error Codes

### Machine-Readable Codes

```
Error codes are for machines (programs). Messages are for humans.
Clients switch on code, not on message text.

pseudocode:
if error.code == "insufficient_funds":
    showPaymentForm()
elif error.code == "rate_limited":
    retryAfter(error.retry_after)
elif error.code == "validation_error":
    highlightFields(error.details)
else:
    showGenericError(error.message)
```

### Code Naming Convention

```
Use snake_case, specific, and descriptive:

WRONG:
"code": "ERR001"              # meaningless
"code": "error"               # too generic
"code": "Error::NotFound"     # language-specific format
"code": "NOT_FOUND"           # SCREAMING_CASE

CORRECT:
"code": "not_found"
"code": "validation_error"
"code": "insufficient_funds"
"code": "rate_limited"
"code": "duplicate_email"
"code": "order_already_cancelled"
"code": "token_expired"
"code": "payment_declined"
```

### Error Code Catalog (Example)

```
Code                        | HTTP | Description
----------------------------|------|-------------------------------------
not_found                   | 404  | Resource does not exist
validation_error            | 422  | Request body validation failed
unauthorized                | 401  | Missing or invalid authentication
forbidden                   | 403  | Authenticated but no permission
conflict                    | 409  | Resource version conflict
duplicate                   | 409  | Unique constraint violation
rate_limited                | 429  | Too many requests
internal_error              | 500  | Unhandled server error
service_unavailable         | 503  | Dependency down
method_not_allowed          | 405  | HTTP method not supported
unsupported_media_type      | 415  | Wrong Content-Type
payload_too_large           | 413  | Request body exceeds limit
gone                        | 410  | Resource permanently deleted
token_expired               | 401  | Auth token has expired
insufficient_funds          | 422  | Payment amount exceeds balance
order_already_cancelled     | 422  | Cannot cancel a cancelled order
```

---

## 3. Validation Errors

### Per-Field, Multiple Errors per Field

```json
POST /api/users
{
  "name": "",
  "email": "not-an-email",
  "password": "123",
  "role": "superadmin"
}

Response: 422 Unprocessable Entity
{
  "error": {
    "code": "validation_error",
    "message": "The request body contains invalid data.",
    "details": [
      {
        "field": "name",
        "code": "required",
        "message": "Name is required."
      },
      {
        "field": "email",
        "code": "invalid_format",
        "message": "Must be a valid email address."
      },
      {
        "field": "password",
        "code": "too_short",
        "message": "Must be at least 8 characters.",
        "meta": { "min_length": 8, "received_length": 3 }
      },
      {
        "field": "role",
        "code": "invalid_value",
        "message": "Must be one of: user, editor, admin.",
        "meta": { "allowed": ["user", "editor", "admin"], "received": "superadmin" }
      }
    ]
  }
}
```

### Nested Field Paths

```json
POST /api/orders
{
  "items": [
    { "product_id": "prd_1", "quantity": -5 },
    { "product_id": "", "quantity": 1 }
  ],
  "shipping_address": {
    "zip_code": "invalid"
  }
}

Response: 422 Unprocessable Entity
{
  "error": {
    "code": "validation_error",
    "message": "The request body contains invalid data.",
    "details": [
      {
        "field": "items[0].quantity",
        "code": "min_value",
        "message": "Must be at least 1.",
        "meta": { "min": 1, "received": -5 }
      },
      {
        "field": "items[1].product_id",
        "code": "required",
        "message": "Product ID is required."
      },
      {
        "field": "shipping_address.zip_code",
        "code": "invalid_format",
        "message": "Must be a valid ZIP code."
      }
    ]
  }
}

Use dot notation for nested objects, bracket notation for arrays.
```

### WRONG: Validation Error Anti-Patterns

```json
WRONG (only first error — user fixes one, submits, gets another):
{
  "error": { "message": "Name is required." }
}
// Fix name, submit again -> "Email is invalid" -> fix -> submit -> ...

WRONG (field errors as object — can't have multiple errors per field):
{
  "errors": {
    "email": "Invalid format",
    "name": "Required"
  }
}

WRONG (error messages only, no codes):
{
  "errors": ["Name is required", "Email is invalid"]
}
// Client can't programmatically handle specific errors

CORRECT: Return ALL validation errors at once, with field path + code + message.
```

---

## 4. HTTP Status Code Selection Guide

### Decision Tree

```
Is the request malformed (bad JSON, wrong Content-Type)?
  -> 400 Bad Request

Is authentication missing or invalid?
  -> 401 Unauthorized

Is the user authenticated but lacks permission?
  -> 403 Forbidden

Does the resource not exist?
  -> 404 Not Found

Was the resource permanently deleted?
  -> 410 Gone

Is the HTTP method not supported for this endpoint?
  -> 405 Method Not Allowed

Is there a version/uniqueness conflict?
  -> 409 Conflict

Is the JSON valid but business rules fail?
  -> 422 Unprocessable Entity

Is the request body too large?
  -> 413 Payload Too Large

Is the client sending too many requests?
  -> 429 Too Many Requests

Did something unexpected happen on the server?
  -> 500 Internal Server Error

Is a downstream service unavailable?
  -> 502 Bad Gateway or 503 Service Unavailable
```

### Common Mistakes

```
WRONG: Using 200 for errors
  Response: 200 OK
  { "success": false, "error": "Not found" }
  // Caches, monitoring, and clients all think this succeeded

WRONG: Using 500 for client errors
  Response: 500 Internal Server Error
  { "message": "Email is required" }
  // Triggers alerts, on-call pages, for a user mistake

WRONG: Using 400 for everything
  400 Bad Request for "not found"
  400 Bad Request for "unauthorized"
  400 Bad Request for "validation error"
  // Client can't distinguish between error types

WRONG: Using 404 to hide resources
  GET /api/admin/settings  ->  404 (when user is not admin)
  // Should be 403 — user knows the endpoint exists anyway
  Exception: Use 404 when hiding existence IS the security requirement
```

### 400 vs 422 — When to Use Which

```
400 Bad Request:
  - Malformed JSON (syntax error)
  - Wrong Content-Type header
  - Missing required header
  - Request body is not valid JSON at all

422 Unprocessable Entity:
  - JSON is syntactically valid but semantically wrong
  - Business rule violation
  - Field validation failure (wrong type, out of range)
  - Attempting invalid state transition

Example:
  POST /api/users
  Content-Type: application/json
  {invalid json}
  -> 400 Bad Request (can't parse the JSON)

  POST /api/users
  Content-Type: application/json
  { "email": "not-an-email" }
  -> 422 Unprocessable Entity (valid JSON, invalid email)
```

---

## 5. Error Localization

### Strategy: Server Returns Default Language, Client Translates

```json
Response (English default):
{
  "error": {
    "code": "insufficient_funds",
    "message": "Insufficient funds for this transaction.",
    "details": [
      {
        "field": "amount",
        "code": "exceeds_balance",
        "message": "Amount exceeds available balance.",
        "meta": { "balance": 5000, "requested": 15000, "currency": "BRL" }
      }
    ]
  }
}

Client-side (PT-BR translation table):
translations = {
  "insufficient_funds": "Saldo insuficiente para esta transacao.",
  "exceeds_balance": "O valor excede o saldo disponivel."
}

Client uses "code" to find translation, falls back to "message" if no translation.
```

### Strategy: Accept-Language Header

```
GET /api/users/123
Accept-Language: pt-BR

Response:
{
  "error": {
    "code": "not_found",
    "message": "O usuario solicitado nao foi encontrado."
  }
}

GET /api/users/123
Accept-Language: en-US

Response:
{
  "error": {
    "code": "not_found",
    "message": "The requested user was not found."
  }
}

Recommendation: Provide English as default. Add server-side localization
only if API serves end-users directly (rare — usually frontends handle i18n).
```

### WRONG: Localization Anti-Patterns

```
WRONG (error codes change with locale):
  EN: { "code": "not_found" }
  PT: { "code": "nao_encontrado" }
  // Codes are for machines — always English, always the same

WRONG (no code, only localized message):
  { "message": "Gebruiker niet gevonden" }
  // Client can't programmatically handle this in any language

CORRECT: Codes are always English snake_case. Messages can be localized.
```

---

## 6. Internal vs User-Facing Errors

### Never Expose Internal Details

```json
WRONG (leaks stack trace, DB info, internal paths):
{
  "error": "NullPointerException",
  "stack": "at com.app.service.UserService.findById(UserService.java:42)\nat...",
  "query": "SELECT * FROM users WHERE id = '1; DROP TABLE users--'",
  "server": "api-server-03.internal",
  "db_host": "postgres-primary.internal:5432"
}

CORRECT (generic, safe):
{
  "error": {
    "code": "internal_error",
    "message": "An unexpected error occurred. Please try again later.",
    "request_id": "req_7f3a2b"
  }
}
```

### Error Mapping Layer

```
pseudocode:

function handleError(error):
  if error is ValidationException:
    return 422, {
      code: "validation_error",
      message: "Validation failed.",
      details: error.getFieldErrors()
    }
  
  if error is NotFoundException:
    return 404, {
      code: "not_found",
      message: "Resource not found."
    }
  
  if error is DuplicateException:
    return 409, {
      code: "duplicate",
      message: error.getUserMessage()  // "Email already in use"
    }
  
  // Catch-all: never expose raw exception
  log.error(error, { request_id: context.requestId })
  return 500, {
    code: "internal_error",
    message: "An unexpected error occurred.",
    request_id: context.requestId
  }
```

### Debug Mode (Development Only)

```json
In development (never in production):
{
  "error": {
    "code": "internal_error",
    "message": "An unexpected error occurred.",
    "request_id": "req_7f3a2b",
    "_debug": {
      "exception": "QueryException",
      "message": "Column 'status' not found in table 'orders'",
      "file": "OrderRepository.php:87",
      "trace": ["..."]
    }
  }
}

_debug key is only present when APP_DEBUG=true or X-Debug header is set.
NEVER in production.
```

---

## 7. Problem Details RFC 9457

### Standard Format

RFC 9457 (formerly RFC 7807) defines a standard error format:

```json
Content-Type: application/problem+json

{
  "type": "https://docs.example.com/errors/insufficient-funds",
  "title": "Insufficient Funds",
  "status": 422,
  "detail": "Your account balance is $50.00 but the transaction requires $150.00.",
  "instance": "/api/payments/pay_abc123"
}
```

### With Extensions

```json
{
  "type": "https://docs.example.com/errors/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "The request body contains 3 validation errors.",
  "instance": "/api/users",
  "errors": [
    {
      "pointer": "/email",
      "detail": "Must be a valid email address."
    },
    {
      "pointer": "/password",
      "detail": "Must be at least 8 characters."
    },
    {
      "pointer": "/name",
      "detail": "Required."
    }
  ]
}
```

### When to Use RFC 9457

```
USE when:
  - Building a public API that follows industry standards
  - Integrating with partners who expect RFC 9457
  - Your framework supports it natively (ASP.NET, Spring Boot)

SKIP when:
  - Internal API with established custom format
  - Team prefers simpler { "error": { "code", "message" } } pattern
  - You don't need the "type" URL (documentation links)

Both approaches are valid. Consistency matters more than which format.
```

---

## 8. Retry Guidance

### Retry-After Header

```
HTTP/1.1 429 Too Many Requests
Retry-After: 30

{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests. Please retry after 30 seconds.",
    "retry_after": 30
  }
}

HTTP/1.1 503 Service Unavailable
Retry-After: 120

{
  "error": {
    "code": "service_unavailable",
    "message": "Service temporarily unavailable. Please retry after 120 seconds.",
    "retry_after": 120
  }
}
```

### Retryable vs Non-Retryable Errors

```
Retryable (client should retry with backoff):
  429  Too Many Requests      -> wait, retry
  500  Internal Server Error   -> might be transient
  502  Bad Gateway             -> upstream issue
  503  Service Unavailable     -> temporary outage
  408  Request Timeout         -> try again

Non-retryable (don't retry, fix the request):
  400  Bad Request             -> fix request format
  401  Unauthorized            -> re-authenticate
  403  Forbidden               -> you don't have access
  404  Not Found               -> resource doesn't exist
  409  Conflict                -> resolve conflict first
  422  Unprocessable Entity    -> fix request data

Include this in error response:
{
  "error": {
    "code": "internal_error",
    "message": "...",
    "retryable": true,
    "retry_after": 5
  }
}
```

### Exponential Backoff Guidance

```
Document recommended retry strategy:

Attempt 1: wait 1 second
Attempt 2: wait 2 seconds
Attempt 3: wait 4 seconds
Attempt 4: wait 8 seconds
Attempt 5: give up

Formula: min(base * 2^attempt + random_jitter, max_delay)
  base = 1 second
  max_delay = 30 seconds
  jitter = random(0, 1) second

Include in API docs, not in every error response.
```

---

## 9. Rate Limit Errors

### Rate Limit Headers (Every Response)

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 742
X-RateLimit-Reset: 1712838600

X-RateLimit-Limit:     max requests in window
X-RateLimit-Remaining: requests left in current window
X-RateLimit-Reset:     Unix timestamp when window resets
```

### Rate Limit Exceeded Response

```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1712838600
Retry-After: 42

{
  "error": {
    "code": "rate_limited",
    "message": "Rate limit exceeded. 1000 requests per hour allowed.",
    "retry_after": 42,
    "limit": {
      "max": 1000,
      "remaining": 0,
      "resets_at": "2026-04-11T11:30:00Z",
      "window": "1 hour"
    }
  }
}
```

### Per-Endpoint Rate Limits

```
Different limits for different endpoints:

Endpoint               | Limit          | Window
-----------------------|----------------|--------
GET /api/users         | 1000/hour      | Sliding
POST /api/users        | 100/hour       | Sliding
POST /api/auth/login   | 10/minute      | Fixed
POST /api/emails/send  | 50/hour        | Sliding
GET /api/search        | 200/hour       | Sliding

Headers reflect the specific endpoint limit:
GET /api/search
X-RateLimit-Limit: 200
X-RateLimit-Remaining: 198
```

### WRONG: Rate Limit Anti-Patterns

```
WRONG (no headers — client blindly retries):
HTTP/1.1 429 Too Many Requests
{ "error": "Too many requests" }
// Client has no idea when to retry

WRONG (blocking without informing):
HTTP/1.1 200 OK
// Silently dropping requests or returning empty results when rate limited

WRONG (same limit for all endpoints):
POST /api/auth/login -> 1000/hour (brute force friendly!)

CORRECT: Always include rate limit headers, use Retry-After, 
differentiate limits by endpoint sensitivity.
```

---

## 10. Deprecation Warnings

### Sunset Header (RFC 8594)

```
HTTP/1.1 200 OK
Sunset: Sat, 01 Nov 2026 00:00:00 GMT
Deprecation: true
Link: <https://docs.example.com/migration/v2>; rel="successor-version"

{
  "data": { ... },
  "_deprecation": {
    "message": "This endpoint is deprecated and will be removed on 2026-11-01.",
    "sunset": "2026-11-01",
    "migration_guide": "https://docs.example.com/migration/v2",
    "replacement": "GET /api/v2/users"
  }
}
```

### Deprecated Fields

```json
{
  "data": {
    "id": "usr_123",
    "name": "Ana Silva",
    "full_name": "Ana Silva",
    "username": "ana.silva"
  },
  "_deprecations": [
    {
      "field": "name",
      "message": "Use 'full_name' instead. 'name' will be removed on 2026-11-01.",
      "replacement": "full_name",
      "sunset": "2026-11-01"
    }
  ]
}
```

### Deprecation Timeline

```
Phase 1: Announce (3+ months before removal)
  - Add Sunset header
  - Add deprecation notice to docs
  - Notify API consumers via email/changelog

Phase 2: Warn (1 month before removal)
  - Log all requests to deprecated endpoint
  - Contact consumers still using it
  - Return warning in response

Phase 3: Soft Remove (on sunset date)
  - Return 410 Gone with migration info
  - Keep logging for stragglers

Phase 4: Hard Remove (1 month after sunset)
  - Remove endpoint completely
  - Return 404
```

---

## 11. Error Logging

### What to Log Server-Side

```
Log EVERYTHING server-side for debugging:

{
  "request_id": "req_7f3a2b",
  "timestamp": "2026-04-11T10:30:00.123Z",
  "method": "POST",
  "path": "/api/orders",
  "status": 500,
  "duration_ms": 342,
  "client_ip": "203.0.113.42",
  "user_id": "usr_123",
  "user_agent": "MyApp/2.1.0",
  "error": {
    "type": "QueryException",
    "message": "Column 'status' not found in table 'orders'",
    "file": "OrderRepository.php:87",
    "stack_trace": "..."
  },
  "request_body": { "product_id": "prd_1", "quantity": 2 },
  "response_body": { "error": { "code": "internal_error", "message": "..." } }
}
```

### What to Return to the Client

```
Return MINIMAL information:

{
  "error": {
    "code": "internal_error",
    "message": "An unexpected error occurred.",
    "request_id": "req_7f3a2b"
  }
}

The request_id is the bridge between client-visible error and server-side details.
```

### What to NEVER Log

```
NEVER log (even server-side):
  - Passwords (raw or hashed)
  - Credit card numbers (full)
  - API secrets/tokens (full — log last 4 chars only)
  - Personal health information
  - SSN / government ID numbers

Mask sensitive fields:
{
  "request_body": {
    "email": "ana@example.com",
    "password": "***REDACTED***",
    "card_number": "***4242"
  }
}
```

### Structured Error Logging

```
pseudocode:

function logError(context, error, statusCode):
  log.error({
    request_id: context.requestId,
    user_id: context.userId,
    method: context.method,
    path: context.path,
    status: statusCode,
    error_code: error.code,
    error_type: error.constructor.name,
    error_message: error.message,
    duration_ms: context.elapsed(),
    // Stack trace only for 5xx errors
    stack_trace: statusCode >= 500 ? error.stack : null
  })

Don't log stack traces for 4xx — those are client errors, not bugs.
DO log stack traces for 5xx — those are server bugs.
```

### Error Monitoring Alerts

```
Set up alerts based on error patterns:

Alert: "5xx spike"
  Condition: 5xx rate > 1% of requests in 5-minute window
  Action: Page on-call

Alert: "Auth failure spike"
  Condition: 401 rate > 20% from single IP in 1-minute window
  Action: Notify security team (possible brute force)

Alert: "Endpoint error rate"
  Condition: Any single endpoint > 5% error rate
  Action: Notify team

Alert: "Slow errors"
  Condition: Error responses taking > 5s (timeout-related)
  Action: Check downstream services
```
