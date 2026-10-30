# OpenAPI & Documentation

OpenAPI 3.1 specification, schema design, documentation generation, and contract-first development.

---

## Table of Contents

1. [OpenAPI 3.1 Structure](#1-openapi-31-structure)
2. [Writing Schemas](#2-writing-schemas)
3. [Parameters: Path, Query, Header](#3-parameters-path-query-header)
4. [Request Body Schemas](#4-request-body-schemas)
5. [Response Schemas](#5-response-schemas)
6. [Security Schemes](#6-security-schemes)
7. [Documentation Generation](#7-documentation-generation)
8. [Code Generation](#8-code-generation)
9. [Contract-First vs Code-First](#9-contract-first-vs-code-first)
10. [API Testing with OpenAPI](#10-api-testing-with-openapi)
11. [Changelog and Versioning in Docs](#11-changelog-and-versioning-in-docs)
12. [Interactive Documentation](#12-interactive-documentation)
13. [OpenAPI with Laravel](#13-openapi-with-laravel)

---

## 1. OpenAPI 3.1 Structure

### Minimal Valid Spec

```yaml
openapi: "3.1.0"
info:
  title: Acme API
  version: "1.0.0"
  description: API for managing Acme Corp resources.
  contact:
    name: API Team
    email: api@acme.com
    url: https://docs.acme.com
  license:
    name: MIT
    url: https://opensource.org/licenses/MIT
servers:
  - url: https://api.acme.com
    description: Production
  - url: https://staging-api.acme.com
    description: Staging
  - url: http://localhost:8000
    description: Local development
paths:
  /api/users:
    get:
      summary: List users
      operationId: listUsers
      responses:
        "200":
          description: Success
components:
  schemas: {}
  securitySchemes: {}
```

### Key Sections

```
openapi:     Spec version (use 3.1.0 — aligns with JSON Schema)
info:        API metadata (title, version, contact, license)
servers:     Base URLs for each environment
paths:       All endpoints and their operations
components:  Reusable schemas, parameters, responses, security schemes
tags:        Grouping for endpoints
security:    Global security requirements
```

### Tags for Organization

```yaml
tags:
  - name: Users
    description: User management
  - name: Orders
    description: Order processing
  - name: Auth
    description: Authentication and authorization

paths:
  /api/users:
    get:
      tags: [Users]
      summary: List users
  /api/orders:
    get:
      tags: [Orders]
      summary: List orders
  /api/auth/login:
    post:
      tags: [Auth]
      summary: Authenticate user
```

---

## 2. Writing Schemas

### Object Schema

```yaml
components:
  schemas:
    User:
      type: object
      required: [id, name, email, created_at]
      properties:
        id:
          type: string
          example: "usr_abc123"
          description: Unique user identifier
          readOnly: true
        name:
          type: string
          minLength: 1
          maxLength: 255
          example: "Ana Silva"
        email:
          type: string
          format: email
          example: "ana@example.com"
        role:
          type: string
          enum: [user, editor, admin]
          default: user
          example: admin
        avatar_url:
          type: ["string", "null"]
          format: uri
          example: "https://cdn.example.com/avatars/usr_abc123.jpg"
        created_at:
          type: string
          format: date-time
          readOnly: true
          example: "2026-04-11T10:30:00Z"
```

### Array Schema

```yaml
UserList:
  type: object
  required: [data, meta]
  properties:
    data:
      type: array
      items:
        $ref: "#/components/schemas/User"
    meta:
      $ref: "#/components/schemas/PaginationMeta"
    links:
      $ref: "#/components/schemas/PaginationLinks"
```

### Enum Schema

```yaml
OrderStatus:
  type: string
  enum: [pending, confirmed, shipped, delivered, cancelled]
  description: |
    - `pending` — order created, awaiting payment
    - `confirmed` — payment received
    - `shipped` — in transit
    - `delivered` — received by customer
    - `cancelled` — order cancelled

# WRONG: enum without descriptions — consumers don't know what values mean
```

### Refs and Composition

```yaml
# $ref — reference a shared schema
items:
  $ref: "#/components/schemas/User"

# allOf — combine schemas (intersection/extension)
AdminUser:
  allOf:
    - $ref: "#/components/schemas/User"
    - type: object
      properties:
        permissions:
          type: array
          items:
            type: string
          example: ["manage_users", "view_reports"]

# oneOf — exactly one of (discriminated union)
Notification:
  oneOf:
    - $ref: "#/components/schemas/EmailNotification"
    - $ref: "#/components/schemas/SmsNotification"
    - $ref: "#/components/schemas/PushNotification"
  discriminator:
    propertyName: type
    mapping:
      email: "#/components/schemas/EmailNotification"
      sms: "#/components/schemas/SmsNotification"
      push: "#/components/schemas/PushNotification"

# anyOf — one or more of (less common in REST APIs)
```

### Discriminators

```yaml
# Use discriminator for polymorphic resources
PaymentMethod:
  oneOf:
    - $ref: "#/components/schemas/CreditCard"
    - $ref: "#/components/schemas/BankTransfer"
    - $ref: "#/components/schemas/Pix"
  discriminator:
    propertyName: type

CreditCard:
  type: object
  required: [type, last_four, brand]
  properties:
    type:
      type: string
      const: credit_card
    last_four:
      type: string
      example: "4242"
    brand:
      type: string
      enum: [visa, mastercard, amex]

BankTransfer:
  type: object
  required: [type, bank_code, account]
  properties:
    type:
      type: string
      const: bank_transfer
    bank_code:
      type: string
    account:
      type: string

Pix:
  type: object
  required: [type, key]
  properties:
    type:
      type: string
      const: pix
    key:
      type: string
      example: "ana@example.com"
```

### WRONG: Schema Anti-Patterns

```yaml
WRONG (no types, no validation):
User:
  type: object
  properties:
    name: {}
    email: {}
    age: {}

WRONG (additionalProperties not controlled):
User:
  type: object
  properties:
    name:
      type: string
  # additionalProperties defaults to true — any extra field accepted

CORRECT:
User:
  type: object
  required: [name, email]
  additionalProperties: false
  properties:
    name:
      type: string
      minLength: 1
      maxLength: 255
    email:
      type: string
      format: email
```

---

## 3. Parameters: Path, Query, Header

### Path Parameters

```yaml
/api/users/{user_id}:
  get:
    summary: Get a user
    operationId: getUser
    parameters:
      - name: user_id
        in: path
        required: true
        description: User ID
        schema:
          type: string
          pattern: "^usr_[a-zA-Z0-9]+$"
          example: "usr_abc123"
```

### Query Parameters

```yaml
/api/users:
  get:
    summary: List users
    operationId: listUsers
    parameters:
      - name: page
        in: query
        schema:
          type: integer
          minimum: 1
          default: 1
        description: Page number
      - name: per_page
        in: query
        schema:
          type: integer
          minimum: 1
          maximum: 100
          default: 20
        description: Items per page
      - name: status
        in: query
        schema:
          type: string
          enum: [active, suspended, deleted]
        description: Filter by status
      - name: sort
        in: query
        schema:
          type: string
          enum: [name, -name, created_at, -created_at]
          default: -created_at
        description: Sort field (prefix with - for descending)
      - name: q
        in: query
        schema:
          type: string
          minLength: 2
        description: Full-text search query
```

### Header Parameters

```yaml
parameters:
  - name: X-Tenant-ID
    in: header
    required: false
    schema:
      type: string
    description: Tenant identifier (optional, defaults to token tenant)
  - name: Idempotency-Key
    in: header
    required: true
    schema:
      type: string
      format: uuid
    description: Client-generated UUID for idempotent request
  - name: Accept-Language
    in: header
    required: false
    schema:
      type: string
      default: en-US
    description: Preferred response language
```

### Reusable Parameters

```yaml
components:
  parameters:
    PageParam:
      name: page
      in: query
      schema:
        type: integer
        minimum: 1
        default: 1
    PerPageParam:
      name: per_page
      in: query
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20

paths:
  /api/users:
    get:
      parameters:
        - $ref: "#/components/parameters/PageParam"
        - $ref: "#/components/parameters/PerPageParam"
  /api/orders:
    get:
      parameters:
        - $ref: "#/components/parameters/PageParam"
        - $ref: "#/components/parameters/PerPageParam"
```

---

## 4. Request Body Schemas

### Create Request

```yaml
/api/users:
  post:
    summary: Create a user
    operationId: createUser
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/CreateUserRequest"
          examples:
            basic:
              summary: Basic user
              value:
                name: Ana Silva
                email: ana@example.com
            admin:
              summary: Admin user
              value:
                name: Carlos Lima
                email: carlos@example.com
                role: admin

components:
  schemas:
    CreateUserRequest:
      type: object
      required: [name, email]
      additionalProperties: false
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 255
        email:
          type: string
          format: email
        role:
          type: string
          enum: [user, editor, admin]
          default: user
```

### Update Request (PATCH)

```yaml
/api/users/{user_id}:
  patch:
    summary: Update a user
    operationId: updateUser
    requestBody:
      required: true
      content:
        application/merge-patch+json:
          schema:
            $ref: "#/components/schemas/UpdateUserRequest"
          example:
            name: Ana Silva Updated

components:
  schemas:
    UpdateUserRequest:
      type: object
      additionalProperties: false
      minProperties: 1
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 255
        email:
          type: string
          format: email
        role:
          type: string
          enum: [user, editor, admin]
      # Note: no "required" — all fields optional for PATCH
      # minProperties: 1 — at least one field must be present
```

### WRONG: Same Schema for Create and Update

```yaml
WRONG (same schema, "required" doesn't make sense for PATCH):
requestBody:
  schema:
    $ref: "#/components/schemas/User"
    # User has required: [name, email]
    # But PATCH should allow partial updates

CORRECT: Separate schemas for create vs update:
  CreateUserRequest  -> required: [name, email]
  UpdateUserRequest  -> no required, minProperties: 1
```

---

## 5. Response Schemas

### Success Response

```yaml
/api/users/{user_id}:
  get:
    summary: Get a user
    responses:
      "200":
        description: User found
        content:
          application/json:
            schema:
              type: object
              properties:
                data:
                  $ref: "#/components/schemas/User"
            example:
              data:
                id: usr_abc123
                name: Ana Silva
                email: ana@example.com
                role: admin
                created_at: "2026-04-11T10:30:00Z"
      "404":
        description: User not found
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ErrorResponse"
            example:
              error:
                code: not_found
                message: "The requested user was not found."
                request_id: req_7f3a2b
```

### Reusable Error Responses

```yaml
components:
  responses:
    NotFound:
      description: Resource not found
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
          example:
            error:
              code: not_found
              message: "Resource not found."
    ValidationError:
      description: Validation failed
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ValidationErrorResponse"
    Unauthorized:
      description: Authentication required
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
          example:
            error:
              code: unauthorized
              message: "Authentication required."
    RateLimited:
      description: Rate limit exceeded
      headers:
        X-RateLimit-Limit:
          schema:
            type: integer
        X-RateLimit-Remaining:
          schema:
            type: integer
        Retry-After:
          schema:
            type: integer
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"

  schemas:
    ErrorResponse:
      type: object
      required: [error]
      properties:
        error:
          type: object
          required: [code, message]
          properties:
            code:
              type: string
              example: not_found
            message:
              type: string
              example: "Resource not found."
            request_id:
              type: string
              example: req_7f3a2b
            details:
              type: array
              items:
                $ref: "#/components/schemas/ErrorDetail"

    ErrorDetail:
      type: object
      required: [field, code, message]
      properties:
        field:
          type: string
          example: email
        code:
          type: string
          example: invalid_format
        message:
          type: string
          example: "Must be a valid email address."

# Usage in paths:
paths:
  /api/users/{user_id}:
    get:
      responses:
        "200":
          description: Success
        "404":
          $ref: "#/components/responses/NotFound"
        "401":
          $ref: "#/components/responses/Unauthorized"
```

---

## 6. Security Schemes

### Bearer Token (JWT)

```yaml
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: "JWT token obtained from POST /api/auth/login"

security:
  - BearerAuth: []   # Applied globally

# Override per endpoint (public endpoints):
paths:
  /api/auth/login:
    post:
      security: []   # No auth required
  /api/users:
    get:
      security:
        - BearerAuth: []
```

### API Key

```yaml
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
      description: "API key provided in dashboard settings"
```

### OAuth2

```yaml
components:
  securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://auth.example.com/authorize
          tokenUrl: https://auth.example.com/token
          refreshUrl: https://auth.example.com/token
          scopes:
            read:users: Read user information
            write:users: Create and update users
            read:orders: Read orders
            write:orders: Create and manage orders

paths:
  /api/users:
    get:
      security:
        - OAuth2: [read:users]
    post:
      security:
        - OAuth2: [write:users]
```

### Multiple Auth Methods

```yaml
# Any one of these methods (OR):
security:
  - BearerAuth: []
  - ApiKeyAuth: []

# Both required (AND):
security:
  - BearerAuth: []
    ApiKeyAuth: []
```

---

## 7. Documentation Generation

### Stoplight (Recommended)

```
Stoplight Elements — React-based, modern UI:

npm install @stoplight/elements

<API
  apiDescriptionUrl="/openapi.yaml"
  router="hash"
  layout="sidebar"
/>

Pros: Beautiful, fast, try-it-out support, hosted option
Cons: Commercial for advanced features
```

### Redocly

```
Redocly — clean, professional docs:

npx @redocly/cli preview-docs openapi.yaml

Features:
  - Three-panel layout (nav, docs, code samples)
  - Code samples in multiple languages
  - Search
  - Bundling multiple spec files

Config (.redocly.yaml):
apis:
  main:
    root: openapi.yaml
theme:
  openapi:
    generateCodeSamples:
      languages:
        - lang: curl
        - lang: python
        - lang: javascript
```

### Swagger UI

```
Classic option — still widely used:

docker run -p 8080:8080 \
  -e SWAGGER_JSON=/app/openapi.yaml \
  -v ./openapi.yaml:/app/openapi.yaml \
  swaggerapi/swagger-ui

Pros: Free, self-hosted, interactive try-it-out
Cons: Dated UI, slow for large specs
```

### WRONG: Documentation Anti-Patterns

```
WRONG: No examples in spec
  # Consumers have to guess what a valid request looks like

WRONG: Auto-generated descriptions only
  summary: "Get /api/users/{user_id}"
  # Useless — tell me what this endpoint DOES

WRONG: Outdated docs (spec doesn't match implementation)
  # Docs say field is optional, API requires it

CORRECT:
  - Every endpoint has summary + description
  - Every schema has examples
  - Spec is the source of truth (generated from code or validated against it)
  - Docs are auto-deployed on merge
```

---

## 8. Code Generation

### Client SDKs

```
Generate typed HTTP clients from OpenAPI spec:

# openapi-generator (most languages):
npx @openapitools/openapi-generator-cli generate \
  -i openapi.yaml \
  -g typescript-fetch \
  -o ./sdk/typescript

# Supported generators: typescript-fetch, python, go, java, php, ruby, swift, kotlin...

# kiota (Microsoft, excellent TypeScript/C#):
kiota generate -l typescript -d openapi.yaml -o ./sdk

# orval (React/Vue focused):
npx orval --input openapi.yaml --output ./src/api
# Generates React Query hooks, Axios client, Zod validators
```

### Server Stubs

```
Generate server boilerplate:

# Go:
npx @openapitools/openapi-generator-cli generate \
  -i openapi.yaml \
  -g go-server \
  -o ./server

# PHP/Laravel:
npx @openapitools/openapi-generator-cli generate \
  -i openapi.yaml \
  -g php-laravel \
  -o ./server

Warning: Generated server stubs are starting points only.
Don't regenerate after you start writing business logic — you'll lose it.
Use contract-first for initial generation, then maintain manually.
```

### WRONG: Code Generation Anti-Patterns

```
WRONG: Regenerating client SDK without checking breaking changes
  Old: getUser(id: string): User
  New: getUser(id: string): UserResponse  // breaking change for consumers

WRONG: Using generated code without reviewing it
  Generated code may have security issues, inefficient patterns, or bugs

CORRECT:
  - Version your SDK (semver)
  - Review generated code before shipping
  - Run generated tests against actual API
  - Pin generator version (don't auto-upgrade)
```

---

## 9. Contract-First vs Code-First

### Contract-First (Write Spec First)

```
Workflow:
  1. Design OpenAPI spec (YAML/JSON)
  2. Review spec with frontend and stakeholders
  3. Generate server stubs + client SDKs
  4. Implement business logic in generated stubs
  5. Validate implementation matches spec (CI)

Pros:
  + Frontend and backend work in parallel
  + Spec is the single source of truth
  + Forces intentional API design
  + Catches design issues before coding

Cons:
  - Maintaining YAML by hand is tedious
  - Spec can drift from implementation without CI validation
  - Slower to start than just coding
```

### Code-First (Write Code, Generate Spec)

```
Workflow:
  1. Write API code with annotations/attributes
  2. Generate OpenAPI spec from code
  3. Generate docs from spec
  4. Publish spec + docs

Pros:
  + Spec is always in sync with code (generated from it)
  + Faster to start
  + Less maintenance overhead
  + Natural for teams that prefer code over YAML

Cons:
  - API design is an afterthought
  - Hard to review API design without running the code
  - Annotations clutter the code
```

### Decision Guide

```
Team/Scenario                          | Approach
---------------------------------------|------------------
Public API with many consumers         | Contract-first
Frontend and backend teams are separate| Contract-first
Rapid prototyping / internal API       | Code-first
Framework has strong OpenAPI support   | Code-first
API design review process is important | Contract-first
Solo developer, small project          | Code-first
```

---

## 10. API Testing with OpenAPI

### Prism (Mock Server)

```bash
# Run a mock server from your OpenAPI spec:
npx @stoplight/prism-cli mock openapi.yaml

# Mock server responds based on examples in spec:
curl http://localhost:4010/api/users/123
# Returns example from spec

# Validates requests against spec:
curl -X POST http://localhost:4010/api/users \
  -H "Content-Type: application/json" \
  -d '{"invalid": "body"}'
# Returns 422 — request doesn't match spec

Use for:
  - Frontend development before backend is ready
  - Contract testing
  - API design validation
```

### Dredd (Contract Testing)

```bash
# Test your API against the spec:
npx dredd openapi.yaml http://localhost:8000

# Dredd sends requests defined in spec and validates responses match.
# Fails if: missing endpoint, wrong status code, schema mismatch.

# dredd.yml config:
language: nodejs
server: npm start
server-wait: 3
hookfiles: ./test/dredd-hooks.js
```

### Schemathesis (Fuzzing)

```bash
# Property-based testing for APIs:
pip install schemathesis
st run --checks all http://localhost:8000/openapi.json

# Generates random valid requests based on schema and checks:
#   - No 500 errors
#   - Response matches schema
#   - No crashes
#   - Content-type is correct
```

### WRONG: Testing Anti-Patterns

```
WRONG: Only testing happy paths
  Test: POST /api/users with valid data -> 201
  Missing: POST /api/users with empty body -> 422
  Missing: POST /api/users with duplicate email -> 409
  Missing: GET /api/users/nonexistent -> 404

WRONG: Not validating response schema
  Test passes because status is 200, but body is wrong shape.

CORRECT:
  - Test every status code documented in spec
  - Validate response body matches schema
  - Test edge cases (empty strings, null, max length, special chars)
  - Run contract tests in CI
```

---

## 11. Changelog and Versioning in Docs

### API Changelog Format

```markdown
# API Changelog

## 2026-04-11

### Added
- `POST /api/users/{id}/deactivate` — deactivate a user account
- `avatar_url` field to User resource

### Changed
- `GET /api/orders` now supports `?sort=-total` for sorting by total

### Deprecated
- `name` field on User — use `full_name` instead (removal: 2026-11-01)

### Removed
- `GET /api/v1/legacy-users` — removed after sunset period

## 2026-03-15

### Added
- Cursor pagination support on all list endpoints
- `Idempotency-Key` header support on POST endpoints
```

### Version Strategy in Docs

```
URL path versioning (recommended):
  /api/v1/users
  /api/v2/users

Document both versions simultaneously:
  - v2 docs: https://docs.example.com/v2
  - v1 docs: https://docs.example.com/v1 (with sunset banner)

OpenAPI per version:
  openapi-v1.yaml
  openapi-v2.yaml
```

---

## 12. Interactive Documentation

### Try-It-Out Functionality

```
Modern API docs should support "try it out" — send real requests from the browser.

Requirements:
  - CORS enabled for docs domain
  - Auth token input field
  - Editable request body
  - Copy-pasteable curl command
  - Response display with syntax highlighting

Tools that support this:
  - Stoplight Elements (best UX)
  - Swagger UI (classic)
  - Redocly (with paid tier)
  - Scalar (modern, open-source)
```

### Scalar (Open-Source Alternative)

```html
<!-- Modern, fast, beautiful API docs -->
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
<script>
  Scalar.createApiReference('#app', {
    url: '/openapi.yaml',
    theme: 'default'
  })
</script>

Features:
  - Multiple language code samples
  - Try-it-out with auth
  - Dark mode
  - Search
  - Fully open-source
```

---

## 13. OpenAPI with Laravel

### Scramble (Recommended — Zero Config)

```php
// Install:
// composer require dedoc/scramble

// Scramble auto-generates OpenAPI from your Laravel routes.
// No annotations needed — it reads route definitions, form requests,
// API resources, and return types.

// routes/api.php
Route::apiResource('users', UserController::class);

// app/Http/Controllers/UserController.php
class UserController extends Controller
{
    public function index(): UserCollection
    {
        return new UserCollection(User::paginate());
    }

    public function store(StoreUserRequest $request): UserResource
    {
        $user = User::create($request->validated());
        return new UserResource($user);
    }

    public function show(User $user): UserResource
    {
        return new UserResource($user);
    }
}

// Scramble generates OpenAPI at: /docs/api
// JSON spec at: /docs/api.json

// Config (config/scramble.php):
return [
    'api_path' => 'api',
    'api_domain' => null,
    'info' => [
        'title' => 'Acme API',
        'version' => '1.0.0',
        'description' => 'API for managing Acme Corp resources.',
    ],
];
```

### L5-Swagger (Annotation-Based)

```php
// Install:
// composer require darkaonline/l5-swagger

// Uses PHP annotations/attributes to define OpenAPI spec:

use OpenApi\Attributes as OA;

#[OA\Info(title: "Acme API", version: "1.0.0")]
#[OA\SecurityScheme(securityScheme: "Bearer", type: "http", scheme: "bearer")]
class Controller extends BaseController
{
}

#[OA\Get(
    path: "/api/users/{id}",
    summary: "Get a user",
    tags: ["Users"],
    parameters: [
        new OA\Parameter(name: "id", in: "path", required: true,
            schema: new OA\Schema(type: "string", example: "usr_abc123"))
    ],
    responses: [
        new OA\Response(response: 200, description: "Success",
            content: new OA\JsonContent(ref: "#/components/schemas/UserResponse")),
        new OA\Response(response: 404, description: "Not found")
    ]
)]
public function show(string $id): UserResource
{
    // ...
}

// Generate spec: php artisan l5-swagger:generate
// View docs: /api/documentation
```

### Scramble vs L5-Swagger

```
Feature                     | Scramble        | L5-Swagger
----------------------------|-----------------|------------------
Setup effort                | Zero config     | Manual annotations
Maintenance                 | Auto-generated  | Must update annotations
Accuracy                    | Always in sync  | Can drift from code
Laravel-native              | Yes             | Generic PHP
Learning curve              | None            | OpenAPI + PHP attributes
Customization               | Extensions API  | Full annotation control
Complex schemas             | Sometimes needs | Full control via annotations
                            | type hints      |

Recommendation:
  - New project: Start with Scramble
  - Existing project with complex specs: L5-Swagger
  - Need full control over spec: L5-Swagger
  - Want zero maintenance: Scramble
```

### WRONG: Laravel API Doc Anti-Patterns

```php
WRONG (returning raw arrays — Scramble can't infer schema):
public function index()
{
    return User::all()->toArray();
}

CORRECT (return API Resources — Scramble reads the schema):
public function index(): UserCollection
{
    return new UserCollection(User::paginate());
}

WRONG (no Form Request — validation rules not documented):
public function store(Request $request)
{
    $data = $request->validate(['name' => 'required']);
}

CORRECT (dedicated Form Request — Scramble documents validation):
public function store(StoreUserRequest $request): UserResource
{
    $user = User::create($request->validated());
    return new UserResource($user);
}

WRONG (no return type — Scramble can't determine response shape):
public function show(User $user)
{
    return new UserResource($user);
}

CORRECT (explicit return type):
public function show(User $user): UserResource
{
    return new UserResource($user);
}
```
