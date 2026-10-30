# Pagination & Filtering

Pagination strategies, filtering, searching, sorting, and sparse fieldsets.

---

## Table of Contents

1. [Offset Pagination](#1-offset-pagination)
2. [Cursor Pagination](#2-cursor-pagination)
3. [Keyset Pagination](#3-keyset-pagination)
4. [Pagination Decision Matrix](#4-pagination-decision-matrix)
5. [Filtering Patterns](#5-filtering-patterns)
6. [Advanced Filtering](#6-advanced-filtering)
7. [Search](#7-search)
8. [Sorting](#8-sorting)
9. [Multi-Field Sort](#9-multi-field-sort)
10. [Sparse Fieldsets](#10-sparse-fieldsets)
11. [Default and Maximum Limits](#11-default-and-maximum-limits)
12. [Response Metadata for Pagination](#12-response-metadata-for-pagination)
13. [Infinite Scroll vs Traditional Pagination](#13-infinite-scroll-vs-traditional-pagination)
14. [Cursor Encoding](#14-cursor-encoding)

---

## 1. Offset Pagination

The simplest approach. Uses `page` and `per_page` (or `limit` and `offset`).

### Page/Per-Page Style

```
GET /api/users?page=1&per_page=20
GET /api/users?page=2&per_page=20
GET /api/users?page=5&per_page=50

Response:
{
  "data": [...],
  "meta": {
    "total": 487,
    "page": 2,
    "per_page": 20,
    "last_page": 25
  },
  "links": {
    "first": "/api/users?page=1&per_page=20",
    "prev": "/api/users?page=1&per_page=20",
    "self": "/api/users?page=2&per_page=20",
    "next": "/api/users?page=3&per_page=20",
    "last": "/api/users?page=25&per_page=20"
  }
}
```

### Limit/Offset Style

```
GET /api/users?limit=20&offset=0    # page 1
GET /api/users?limit=20&offset=20   # page 2
GET /api/users?limit=20&offset=40   # page 3

Same SQL under the hood:
SELECT * FROM users ORDER BY id LIMIT 20 OFFSET 40;
```

### Pros and Cons

```
Pros:
  + Simple to implement
  + Client can jump to any page
  + Easy to show "page X of Y"
  + Works with any SQL database

Cons:
  - OFFSET is slow on large tables (DB scans rows to skip)
  - Inconsistent results when data changes between pages
    (inserts/deletes can cause duplicates or missed items)
  - COUNT(*) for "total" can be expensive on large tables
```

### WRONG: Offset Without Limits

```
WRONG:
GET /api/users?page=1           # no per_page — returns everything?
GET /api/users?per_page=999999  # client requests all records

CORRECT:
- Always have a default per_page (e.g., 20)
- Always enforce a maximum per_page (e.g., 100)
- Return 400 if per_page exceeds maximum
```

---

## 2. Cursor Pagination

Uses an opaque cursor to mark the position. The cursor points to a specific record.

### Implementation

```
GET /api/users?limit=20

Response:
{
  "data": [
    { "id": "usr_001", "name": "Ana" },
    ...
    { "id": "usr_020", "name": "Zara" }
  ],
  "meta": {
    "has_more": true,
    "next_cursor": "eyJpZCI6InVzcl8wMjAifQ=="
  },
  "links": {
    "next": "/api/users?limit=20&after=eyJpZCI6InVzcl8wMjAifQ=="
  }
}

Next page:
GET /api/users?limit=20&after=eyJpZCI6InVzcl8wMjAifQ==

Previous page (optional):
GET /api/users?limit=20&before=eyJpZCI6InVzcl8wMDEifQ==
```

### Pros and Cons

```
Pros:
  + Consistent results even when data changes (no skipped/duplicate items)
  + O(1) performance regardless of how deep you paginate
  + Works well with real-time data feeds
  + Natural fit for infinite scroll

Cons:
  - Can't jump to arbitrary page (no "go to page 7")
  - Can't easily show "total" count (requires separate query)
  - Slightly more complex implementation
  - Cursor becomes invalid if referenced record is deleted
```

### Bidirectional Cursors

```
GET /api/messages?limit=20&after=cursor_abc

Response:
{
  "data": [...],
  "meta": {
    "has_next": true,
    "has_prev": true,
    "next_cursor": "cursor_xyz",
    "prev_cursor": "cursor_def"
  },
  "links": {
    "next": "/api/messages?limit=20&after=cursor_xyz",
    "prev": "/api/messages?limit=20&before=cursor_def"
  }
}
```

---

## 3. Keyset Pagination

Uses the actual column value (usually ID or timestamp) instead of an opaque cursor.

### Implementation

```
GET /api/users?limit=20&sort=id

Response:
{
  "data": [
    { "id": 1, "name": "Ana" },
    ...
    { "id": 20, "name": "Zara" }
  ],
  "meta": { "has_more": true }
}

Next page:
GET /api/users?limit=20&sort=id&after_id=20

SQL:
SELECT * FROM users WHERE id > 20 ORDER BY id ASC LIMIT 20;
```

### With Composite Keys

```
Sorting by created_at (non-unique):

GET /api/users?limit=20&sort=-created_at

SQL for next page (tie-breaking with ID):
SELECT * FROM users
WHERE (created_at, id) < ('2026-04-10T10:00:00Z', 'usr_050')
ORDER BY created_at DESC, id DESC
LIMIT 20;

Query param:
GET /api/users?limit=20&sort=-created_at&after=2026-04-10T10:00:00Z,usr_050
```

### Pros and Cons

```
Pros:
  + Fastest method — uses index seek, no row scanning
  + Consistent results (same as cursor)
  + Simple SQL translation
  + Transparent — client sees the actual values

Cons:
  - Client sees internal values (leaky abstraction)
  - Complex for multi-column sort (composite keys)
  - Client must handle the key format correctly
  - Breaks if sort column allows nulls
```

---

## 4. Pagination Decision Matrix

```
Scenario                               | Method        | Why
---------------------------------------|---------------|---------------------------
Public API, users expect page numbers  | Offset        | Simple, familiar UX
Mobile infinite scroll                 | Cursor        | Consistent, scalable
Real-time feed (chat, notifications)   | Cursor        | Data changes constantly
Dashboard table with "page 1 of N"    | Offset        | Users need random access
Internal service with millions of rows | Keyset        | Fastest for large datasets
Export/sync all records                | Cursor/Keyset | Must not skip records
Admin panel, small dataset (<10K)      | Offset        | Simple, total count is cheap

Rule of thumb:
  - Under 100K rows: Offset is fine
  - 100K-1M rows: Cursor recommended
  - Over 1M rows: Keyset or Cursor required
```

### WRONG: No Pagination

```
WRONG:
GET /api/logs
Response: 200 OK
{ "data": [ ...2.3 million records... ] }
// Out of memory, timeout, client dies

CORRECT:
Every list endpoint MUST paginate. No exceptions.
Even if today there are 10 records, tomorrow there might be 10 million.
```

---

## 5. Filtering Patterns

### Simple Equality Filters

```
GET /api/users?status=active
GET /api/users?role=admin
GET /api/orders?status=shipped&customer_id=usr_123

SQL:
SELECT * FROM users WHERE status = 'active';
SELECT * FROM orders WHERE status = 'shipped' AND customer_id = 'usr_123';

Multiple values for same field (OR):
GET /api/users?status=active,suspended
SQL: SELECT * FROM users WHERE status IN ('active', 'suspended');
```

### WRONG: Filter Anti-Patterns

```
WRONG (verb in URL):
GET /api/users/filterByStatus/active
GET /api/findUsers?status=active

WRONG (POST for filtering):
POST /api/users/search
{ "status": "active" }
// Use GET with query params for simple filters

WRONG (unnamed positional params):
GET /api/users/active/admin
// What does this mean? status=active? role=admin?

CORRECT:
GET /api/users?status=active&role=admin
```

### Boolean Filters

```
GET /api/users?is_verified=true
GET /api/users?has_orders=false

WRONG:
GET /api/users?is_verified=1       # ambiguous
GET /api/users?is_verified=yes     # inconsistent
GET /api/users?verified             # no value

CORRECT:
Use "true" and "false" as string values.
```

### Null Filters

```
GET /api/users?deleted_at=null          # where deleted_at IS NULL
GET /api/users?deleted_at=!null         # where deleted_at IS NOT NULL

Alternative:
GET /api/users?has_deleted_at=false     # more readable
GET /api/users?is_deleted=false
```

---

## 6. Advanced Filtering

### Operator-Based Filtering

```
Bracket syntax (common pattern):

GET /api/orders?filter[created_at][gte]=2026-01-01&filter[created_at][lt]=2026-04-01
GET /api/orders?filter[total][gte]=10000
GET /api/users?filter[age][between]=18,65
GET /api/products?filter[name][like]=key*

Supported operators:
  eq    = equal (default)
  neq   = not equal
  gt    = greater than
  gte   = greater than or equal
  lt    = less than
  lte   = less than or equal
  like  = pattern match (use * as wildcard)
  in    = one of (comma-separated)
  nin   = not one of
  between = range (two values, comma-separated)
```

### SQL Translation

```
filter[created_at][gte]=2026-01-01
  -> WHERE created_at >= '2026-01-01'

filter[total][gte]=10000&filter[total][lte]=50000
  -> WHERE total >= 10000 AND total <= 50000

filter[status][in]=active,pending
  -> WHERE status IN ('active', 'pending')

filter[name][like]=ana*
  -> WHERE name LIKE 'ana%'
```

### Simpler Alternative: Colon-Separated Operators

```
GET /api/orders?created_at=gte:2026-01-01
GET /api/orders?total=between:10000,50000
GET /api/users?status=in:active,pending

Simpler URLs but less standard. Pick one convention and be consistent.
```

### WRONG: Complex Filtering Without Validation

```
WRONG (SQL injection risk, no whitelist):
GET /api/users?filter[password_hash][eq]=...
GET /api/users?filter[is_admin][eq]=true
GET /api/users?sort=;DROP TABLE users;--

CORRECT:
- Whitelist filterable fields per endpoint
- Validate operator is in allowed list
- Validate value types match field type
- Never pass filter values directly to SQL
```

### Filterable Fields Documentation

```
Document for each endpoint which fields support filtering:

# GET /api/orders
# Filterable fields:
#   status      enum    [eq, in]
#   created_at  date    [eq, gte, lte, between]
#   total       integer [eq, gte, lte, between]
#   customer_id string  [eq]
#
# Non-filterable: internal_notes, payment_token
```

---

## 7. Search

### Simple Text Search

```
GET /api/users?q=ana silva
GET /api/products?search=wireless keyboard

Server decides which fields to search (name, email, description, etc.)

WRONG:
GET /api/users?search_name=ana&search_email=ana   # use filters for specific fields

CORRECT:
GET /api/users?q=ana               # full-text search across relevant fields
GET /api/users?email=ana@ex.com    # specific field filter
```

### Search Response with Relevance

```
GET /api/products?q=bluetooth headphones

{
  "data": [
    { "id": "prd_1", "name": "Pro Bluetooth Headphones", "relevance": 0.95 },
    { "id": "prd_2", "name": "Bluetooth Speaker", "relevance": 0.42 },
    { "id": "prd_3", "name": "Wired Headphones", "relevance": 0.38 }
  ],
  "meta": {
    "total": 3,
    "query": "bluetooth headphones"
  }
}

When using ?q=, default sort should be by relevance (not created_at).
```

### Search + Filters (Combined)

```
GET /api/products?q=keyboard&category=electronics&price[lte]=10000

Search for "keyboard" in electronics under $100.

Combine freely:
  ?q=        -> full-text search
  ?field=    -> exact filter
  ?sort=     -> ordering
  ?page=     -> pagination
```

---

## 8. Sorting

### Single-Field Sort

```
Ascending (default):
GET /api/users?sort=name
GET /api/users?sort=created_at

Descending (prefix with -):
GET /api/users?sort=-created_at     # newest first
GET /api/orders?sort=-total          # highest total first
```

### WRONG: Sort Anti-Patterns

```
WRONG (multiple params for sort direction):
GET /api/users?sort=name&order=desc
GET /api/users?sort_by=name&sort_dir=asc

WRONG (non-standard direction indicators):
GET /api/users?sort=name:desc
GET /api/users?sort=name.desc

CORRECT (prefix convention — widely adopted):
GET /api/users?sort=name        # ascending
GET /api/users?sort=-name       # descending
```

### Sortable Fields Whitelist

```
WRONG (sort by any field):
GET /api/users?sort=password_hash    # security risk
GET /api/users?sort=internal_score   # leaks internal data

CORRECT:
Whitelist sortable fields per endpoint:
  users:  id, name, email, created_at, updated_at
  orders: id, total, status, created_at
  
Non-sortable field returns 400:
{
  "error": {
    "code": "invalid_sort",
    "message": "Cannot sort by 'password_hash'. Sortable fields: id, name, email, created_at, updated_at."
  }
}
```

---

## 9. Multi-Field Sort

### Comma-Separated Fields

```
GET /api/users?sort=role,-created_at

Sorts by role ascending, then by created_at descending (newest first within same role).

SQL:
SELECT * FROM users ORDER BY role ASC, created_at DESC;

More examples:
GET /api/orders?sort=status,-total              # by status asc, then total desc
GET /api/products?sort=-stock,name              # out-of-stock last, then alphabetical
GET /api/users?sort=last_name,first_name        # alphabetical by full name
```

### Maximum Sort Fields

```
Enforce a maximum number of sort fields (e.g., 3):

GET /api/users?sort=a,b,c,d,e

Response: 400 Bad Request
{
  "error": {
    "code": "too_many_sort_fields",
    "message": "Maximum 3 sort fields allowed. Received 5."
  }
}
```

### Default Sort

```
Every list endpoint should have a deterministic default sort:

GET /api/users              # default: sort=-created_at,id
GET /api/orders             # default: sort=-created_at,id
GET /api/products           # default: sort=name,id

Always include a unique field (id) as tie-breaker to ensure deterministic ordering.

WRONG: No default sort
  SQL: SELECT * FROM users LIMIT 20;
  # Order is undefined — results vary between queries
```

---

## 10. Sparse Fieldsets

### Basic Field Selection

```
GET /api/users?fields=id,name,email

Response:
{
  "data": [
    { "id": "usr_1", "name": "Ana", "email": "ana@example.com" },
    { "id": "usr_2", "name": "Carlos", "email": "carlos@example.com" }
  ]
}

vs full response:
GET /api/users
{
  "data": [
    {
      "id": "usr_1", "name": "Ana", "email": "ana@example.com",
      "role": "admin", "phone": "+55...", "avatar_url": "...",
      "created_at": "...", "updated_at": "...", "last_login_at": "..."
    }
  ]
}
```

### Per-Resource Type (JSON:API Style)

```
GET /api/orders?include=customer&fields[orders]=id,total&fields[customers]=id,name

{
  "data": [
    {
      "id": "ord_1",
      "total": 15000,
      "customer": {
        "id": "usr_123",
        "name": "Ana"
      }
    }
  ]
}
```

### WRONG: Fieldset Anti-Patterns

```
WRONG (returning only requested fields, excluding ID):
GET /api/users?fields=name,email
{ "data": [{ "name": "Ana", "email": "..." }] }
// No ID — can't reference this resource

WRONG (allowing selection of sensitive fields):
GET /api/users?fields=id,password_hash,api_secret
// Should be blocked

CORRECT:
- Always include "id" regardless of field selection
- Whitelist selectable fields
- Ignore unknown fields (don't error — forward compatibility)
```

---

## 11. Default and Maximum Limits

### Standard Defaults

```
Endpoint type     | Default per_page | Max per_page
------------------|------------------|-------------
General list      | 20               | 100
Search results    | 10               | 50
Admin panel       | 50               | 200
Feed/timeline     | 20               | 100
Export/sync       | 100              | 1000
Autocomplete      | 5                | 20
```

### Enforce Limits

```json
GET /api/users?per_page=500

Response: 400 Bad Request
{
  "error": {
    "code": "invalid_per_page",
    "message": "per_page must be between 1 and 100. Received 500."
  }
}

Alternative (silently cap):
GET /api/users?per_page=500
// Server treats as per_page=100 and indicates in response:
{
  "meta": {
    "per_page": 100,
    "requested_per_page": 500,
    "max_per_page": 100
  }
}
```

### WRONG: No Limits

```
WRONG:
GET /api/users?per_page=0          # all records? or none?
GET /api/users?per_page=-1         # negative?
GET /api/users?per_page=999999     # effectively no pagination
GET /api/users                      # no default, returns everything

CORRECT:
- per_page=0 -> 400 Bad Request
- per_page=-1 -> 400 Bad Request
- per_page > max -> 400 or silently cap
- No per_page -> use default (e.g., 20)
```

---

## 12. Response Metadata for Pagination

### Offset Pagination Metadata

```json
{
  "data": [...],
  "meta": {
    "total": 487,
    "page": 3,
    "per_page": 20,
    "last_page": 25,
    "from": 41,
    "to": 60
  },
  "links": {
    "first": "/api/users?page=1&per_page=20",
    "prev": "/api/users?page=2&per_page=20",
    "self": "/api/users?page=3&per_page=20",
    "next": "/api/users?page=4&per_page=20",
    "last": "/api/users?page=25&per_page=20"
  }
}
```

### Cursor Pagination Metadata

```json
{
  "data": [...],
  "meta": {
    "has_more": true,
    "count": 20,
    "next_cursor": "eyJpZCI6InVzcl8wNDAifQ==",
    "prev_cursor": "eyJpZCI6InVzcl8wMjEifQ=="
  },
  "links": {
    "next": "/api/users?limit=20&after=eyJpZCI6InVzcl8wNDAifQ==",
    "prev": "/api/users?limit=20&before=eyJpZCI6InVzcl8wMjEifQ=="
  }
}

Note: Cursor pagination typically does NOT include "total" count.
If the client needs total, provide a separate endpoint:
  GET /api/users/count?status=active  ->  { "data": { "count": 487 } }
```

### WRONG: Missing Navigation Links

```json
WRONG (meta without links — client has to construct URLs):
{
  "data": [...],
  "meta": { "total": 487, "page": 3, "per_page": 20 }
}
// Client must build: /api/users?page=4&per_page=20... including all current filters

CORRECT (server provides ready-to-use links):
{
  "links": {
    "next": "/api/users?page=4&per_page=20&status=active&sort=-created_at"
  }
}
// Links preserve all current filters and sort — client just follows the link
```

### Link Header Alternative (RFC 8288)

```
HTTP/1.1 200 OK
Link: </api/users?page=4&per_page=20>; rel="next",
      </api/users?page=25&per_page=20>; rel="last",
      </api/users?page=2&per_page=20>; rel="prev",
      </api/users?page=1&per_page=20>; rel="first"

Can use both Link header AND links in body — they should be consistent.
```

---

## 13. Infinite Scroll vs Traditional Pagination

### Traditional Pagination (Page Numbers)

```
Best for:
  - Desktop dashboards and admin panels
  - When users need to jump to specific pages
  - When total count matters
  - SEO (crawlable pages)

Implementation:
  GET /api/products?page=1&per_page=20
  Use offset pagination
  Show "Page 3 of 25" and page number buttons
```

### Infinite Scroll

```
Best for:
  - Mobile apps
  - Social feeds and timelines
  - Content discovery (browsing, not searching)
  - When total count doesn't matter

Implementation:
  GET /api/posts?limit=20
  GET /api/posts?limit=20&after=cursor_abc
  Use cursor pagination
  Load more when user scrolls near bottom
```

### WRONG: Offset Pagination for Infinite Scroll

```
WRONG (offset + infinite scroll = inconsistent data):
Load page 1: items 1-20 (user sees these)
New item inserted at position 5
Load page 2: items 21-40... but item 20 is now at position 21
Result: user sees item 20 twice

CORRECT (cursor + infinite scroll = consistent):
Load first batch: items 1-20, cursor points to item 20
New item inserted at position 5
Load next batch: items after cursor = items 21-40 (original IDs)
Result: no duplicates, new item appears on refresh
```

---

## 14. Cursor Encoding

### Opaque Base64 (Recommended for Public APIs)

```
Cursor: eyJpZCI6InVzcl8wNDAiLCJjcmVhdGVkX2F0IjoiMjAyNi0wNC0xMFQxMDozMDowMFoifQ==

Decoded: {"id":"usr_040","created_at":"2026-04-10T10:30:00Z"}

Pros:
  + Client treats it as opaque string (doesn't parse it)
  + You can change the internal format without breaking clients
  + Hides implementation details

Cons:
  - Slightly harder to debug
  - Client can still decode it (it's base64, not encryption)
```

### Raw ID (Simpler for Internal APIs)

```
GET /api/users?limit=20&after_id=usr_040

Pros:
  + Simple, debuggable
  + Client can construct cursors

Cons:
  - Leaks implementation details
  - Client might hardcode cursor format
  - Hard to change format later
```

### Signed/Encrypted Cursors (High Security)

```
Cursor: eyJ...signed-payload...

Server signs the cursor with a secret key.
If client tampers with cursor -> 400 Bad Request.

Use when:
  - Cursor contains sensitive data
  - You want to prevent cursor forgery
  - API is public and security-critical
```

### WRONG: Cursor Anti-Patterns

```
WRONG (sequential integers — guessable, reveals table size):
  cursor=1, cursor=2, cursor=3...

WRONG (timestamp only — not unique):
  cursor=2026-04-11T10:30:00Z
  // Multiple records at same timestamp -> skip/duplicate

WRONG (cursor that expires silently):
  GET /api/users?after=old_cursor  ->  200 OK with empty results
  // Client thinks there's no more data, but cursor was just expired

CORRECT:
  - Cursor is at minimum (unique_id) or (sort_field + unique_id)
  - Expired cursor returns 400 with clear error message
  - Document cursor TTL if applicable (e.g., "cursors valid for 24h")
```
