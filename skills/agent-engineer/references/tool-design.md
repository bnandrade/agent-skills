# Tool Design

Patterns for designing tools that AI agents call safely, reliably, and efficiently. Tools are the agent's hands — they're also the primary attack surface. Every tool you give an agent is a capability and a risk. Language-agnostic with examples in Python and pseudocode.

---

## Table of Contents

1. [Tool Anatomy](#1-tool-anatomy)
2. [Principle of Least Privilege](#2-principle-of-least-privilege)
3. [Input Validation](#3-input-validation)
4. [Output Sanitization](#4-output-sanitization)
5. [Database Tools](#5-database-tools)
6. [File System Tools](#6-file-system-tools)
7. [API Tools](#7-api-tools)
8. [Web Scraping Tools](#8-web-scraping-tools)
9. [Search Tools](#9-search-tools)
10. [Idempotency](#10-idempotency)
11. [Error Handling](#11-error-handling)
12. [Tool Composition](#12-tool-composition)
13. [Testing Patterns](#13-testing-patterns)
14. [Dangerous Tools and Human Approval](#14-dangerous-tools-and-human-approval)

---

## 1. Tool Anatomy

Every tool exposed to an LLM needs these components:

```python
@dataclass
class ToolDefinition:
    # Identity
    name: str              # Unique, descriptive (e.g., "search_products", not "tool_1")
    description: str       # What it does — the LLM reads this to decide when to call it

    # Interface
    parameters: dict       # JSON Schema for input validation
    return_type: str       # What the LLM should expect back

    # Safety
    read_only: bool        # Can this tool modify state?
    requires_approval: bool  # Does a human need to approve before execution?
    max_execution_time: int  # Timeout in seconds
    rate_limit: str        # e.g., "10/minute"
```

### Writing Good Descriptions

The description is the most critical field. LLMs choose tools based on descriptions alone.

```python
# WRONG: Vague description — LLM doesn't know when to use it
ToolDefinition(
    name="search",
    description="Searches for things.",
)

# WRONG: Too long — wastes context tokens and confuses the LLM
ToolDefinition(
    name="search_products",
    description="This tool allows you to search for products in the database. "
                "It supports full-text search, category filtering, price ranges, "
                "and pagination. Results are returned as JSON arrays with product "
                "ID, name, price, stock level, category, brand, dimensions, "
                "weight, and 47 other fields...",
)

# CORRECT: Precise, tells the LLM what it does AND when to use it
ToolDefinition(
    name="search_products",
    description="Search the product catalog by keyword, category, or price range. "
                "Use when the customer asks about product availability or features. "
                "Returns: name, price, stock status (max 10 results).",
)
```

### Parameter Schema

Use JSON Schema to define parameters. The schema serves double duty: the LLM uses it to construct arguments, and the runtime uses it for validation.

```python
ToolDefinition(
    name="search_products",
    description="Search product catalog. Returns max 10 results.",
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search keywords",
                "maxLength": 200,
            },
            "category": {
                "type": "string",
                "enum": ["electronics", "clothing", "food", "home"],
                "description": "Filter by category (optional)",
            },
            "max_price": {
                "type": "number",
                "minimum": 0,
                "maximum": 100000,
                "description": "Maximum price filter (optional)",
            },
        },
        "required": ["query"],
        "additionalProperties": False,
    },
)
```

---

## 2. Principle of Least Privilege

Give the agent the minimum permissions it needs. Read-only by default. Write only with explicit scoping.

### Privilege Tiers

| Tier | Can Do | Example Tools |
|------|--------|---------------|
| **Read-only** | Query data, search, read files | `search_products`, `get_order_status` |
| **Scoped write** | Modify specific fields or records | `update_order_status`, `add_note` |
| **Create** | Create new records | `create_ticket`, `generate_quote` |
| **Delete** | Remove records | `cancel_order`, `delete_draft` |
| **Admin** | Destructive or irreversible actions | `drop_table`, `send_bulk_email` |

### WRONG: Agent with full access

```python
# WRONG: Agent can read and write everything
tools = [
    execute_sql,        # Can run ANY SQL including DROP TABLE
    write_file,         # Can write to ANY path
    send_email,         # Can send email to ANYONE
    call_api,           # Can call ANY endpoint
]

# CORRECT: Scoped tools per agent
sales_tools = [
    search_products,          # Read-only: product catalog
    check_stock,              # Read-only: inventory
    create_quote,             # Scoped write: only creates quotes
    get_customer_info,        # Read-only: customer data (no payment info)
]
```

### Separating Read and Write Tools

```python
# WRONG: One tool that does both read and write
def manage_order(order_id: str, action: str, data: dict = None):
    if action == "get":
        return db.get_order(order_id)
    elif action == "update":
        return db.update_order(order_id, data)
    elif action == "delete":
        return db.delete_order(order_id)

# CORRECT: Separate tools with different permission levels
def get_order(order_id: str) -> dict:
    """Read-only: Retrieve order details."""
    return db.get_order(order_id)

def update_order_status(order_id: str, status: str) -> dict:
    """Scoped write: Only changes the status field."""
    if status not in VALID_STATUSES:
        raise ToolError(f"Invalid status. Valid: {VALID_STATUSES}")
    return db.update_order(order_id, {"status": status})

# Delete is a separate tool that requires approval
@requires_human_approval
def cancel_order(order_id: str) -> dict:
    """Destructive: Cancels an order. Requires human approval."""
    return db.cancel_order(order_id)
```

---

## 3. Input Validation

Never trust the LLM's tool call arguments. LLMs hallucinate parameters, inject unexpected values, and ignore constraints. Validate everything.

### Validation Layers

```
LLM generates arguments
    │
    ├── 1. Schema validation (type, required fields, enums)
    │
    ├── 2. Range/format validation (min/max, regex, length)
    │
    ├── 3. Business rule validation (exists in DB, user has access)
    │
    └── 4. Injection prevention (SQL, path traversal, command injection)
```

### Schema Validation

```python
import jsonschema

def validate_tool_input(schema: dict, arguments: dict) -> dict:
    """Validate LLM-provided arguments against the tool's JSON Schema."""
    try:
        jsonschema.validate(arguments, schema)
        return arguments
    except jsonschema.ValidationError as e:
        raise ToolError(f"Invalid input: {e.message}")
```

### WRONG: Trusting LLM output directly

```python
# WRONG: LLM could pass any string as order_id
def get_order(order_id: str) -> dict:
    return db.execute(f"SELECT * FROM orders WHERE id = '{order_id}'")
    # LLM could pass: "'; DROP TABLE orders; --"

# CORRECT: Validate format and use parameterized queries
def get_order(order_id: str) -> dict:
    if not re.match(r'^ORD-\d{6}$', order_id):
        raise ToolError("Invalid order ID format. Expected: ORD-XXXXXX")
    return db.execute("SELECT * FROM orders WHERE id = %s", [order_id])
```

### Common Input Attacks from LLMs

| Attack | Example | Defense |
|--------|---------|---------|
| SQL injection | `order_id="'; DROP TABLE--"` | Parameterized queries, input regex |
| Path traversal | `filename="../../etc/passwd"` | Resolve path, check it's within sandbox |
| Command injection | `query="data; rm -rf /"` | Never pass LLM input to shell |
| Excessive size | `query="A" * 1_000_000` | maxLength in schema |
| Type confusion | `count="not_a_number"` | JSON Schema type validation |
| Prompt injection via tool args | `name="Ignore previous instructions and..."` | Treat tool args as data, never as instructions |

---

## 4. Output Sanitization

Tool output goes back to the LLM as context. Sanitize what you return.

### Rules

1. **Limit size.** Don't return 10MB of data. Truncate or summarize.
2. **Strip PII.** Don't leak customer emails, phone numbers, or payment info into LLM context.
3. **Format for LLM consumption.** JSON or structured text, not raw HTML or binary.
4. **Don't return secrets.** API keys, tokens, passwords — redact them.

```python
def sanitize_tool_output(output: any, max_chars: int = 5000) -> str:
    """Sanitize tool output before returning to the LLM."""
    if isinstance(output, (dict, list)):
        text = json.dumps(output, indent=2, default=str)
    else:
        text = str(output)

    # Strip PII patterns
    text = re.sub(r'\b[\w.+-]+@[\w-]+\.[\w.]+\b', '[EMAIL_REDACTED]', text)
    text = re.sub(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b', '[PHONE_REDACTED]', text)
    text = re.sub(r'\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b', '[CARD_REDACTED]', text)

    # Truncate if too large
    if len(text) > max_chars:
        text = text[:max_chars] + f"\n\n[TRUNCATED — showing {max_chars}/{len(text)} chars]"

    return text
```

### WRONG: Returning raw database rows

```python
# WRONG: Returns ALL columns including sensitive data
def get_customer(customer_id: str) -> dict:
    return db.execute("SELECT * FROM customers WHERE id = %s", [customer_id])
    # Returns: {id, name, email, phone, ssn, credit_card, password_hash, ...}

# CORRECT: Return only what the agent needs
SAFE_CUSTOMER_FIELDS = ["id", "name", "city", "membership_tier", "created_at"]

def get_customer(customer_id: str) -> dict:
    row = db.execute("SELECT * FROM customers WHERE id = %s", [customer_id])
    return {k: v for k, v in row.items() if k in SAFE_CUSTOMER_FIELDS}
```

---

## 5. Database Tools

Database tools are the highest-risk category. One unrestricted SQL tool can destroy your entire database.

### Real-World: BHEN SQL Allowlist

BHEN restricts database access using a SQL allowlist — only pre-approved query patterns are allowed:

```python
import sqlparse

# Configuration: what the agent is allowed to query
ALLOWED_OPERATIONS = {"SELECT"}
ALLOWED_TABLES = {"products", "orders", "order_items", "categories"}
BLOCKED_COLUMNS = {"password_hash", "ssn", "credit_card", "api_key"}
MAX_ROWS = 100

def execute_sql(query: str) -> str:
    """Execute a read-only SQL query against allowed tables.

    Only SELECT queries are permitted. Restricted to specific tables.
    Results are limited to 100 rows.
    """
    # Step 1: Parse and validate operation
    parsed = sqlparse.parse(query)
    if not parsed:
        raise ToolError("Could not parse SQL query")

    statement = parsed[0]
    stmt_type = statement.get_type()

    if stmt_type not in ALLOWED_OPERATIONS:
        raise ToolError(
            f"Only SELECT queries are allowed. Got: {stmt_type}. "
            f"If you need to modify data, ask a human to do it."
        )

    # Step 2: Validate tables
    tables = extract_table_names(statement)
    unauthorized = tables - ALLOWED_TABLES
    if unauthorized:
        raise ToolError(
            f"Access denied to tables: {unauthorized}. "
            f"Allowed tables: {ALLOWED_TABLES}"
        )

    # Step 3: Check for blocked columns
    columns = extract_column_names(statement)
    blocked = columns & BLOCKED_COLUMNS
    if blocked:
        raise ToolError(f"Access denied to columns: {blocked}")

    # Step 4: Enforce row limit
    if "LIMIT" not in query.upper():
        query = query.rstrip(";") + f" LIMIT {MAX_ROWS}"

    # Step 5: Execute with read-only connection
    with db.read_only_connection() as conn:
        result = conn.execute(query)
        return format_as_table(result.fetchall(), max_rows=MAX_ROWS)
```

### Safer Alternative: Pre-Built Query Tools

Instead of giving the agent raw SQL, give it purpose-built query functions:

```python
# Instead of raw SQL, give the agent specific query tools
def search_products(query: str, category: str = None, limit: int = 10) -> list:
    """Search products by keyword and optional category."""
    sql = "SELECT id, name, price, stock FROM products WHERE name ILIKE %s"
    params = [f"%{query}%"]
    if category:
        sql += " AND category = %s"
        params.append(category)
    sql += " LIMIT %s"
    params.append(min(limit, 50))
    return db.execute(sql, params)

def get_order_summary(order_id: str) -> dict:
    """Get order summary (no sensitive customer data)."""
    return db.execute("""
        SELECT o.id, o.status, o.total, o.created_at,
               c.name as customer_name, c.city
        FROM orders o JOIN customers c ON o.customer_id = c.id
        WHERE o.id = %s
    """, [order_id])
```

### WRONG: Agent with write access to production

```python
# WRONG: Agent can INSERT, UPDATE, DELETE in production
def execute_sql(query: str):
    return production_db.execute(query)

# CORRECT: Read-only replica, or explicit write tools with constraints
def execute_sql(query: str):
    return read_replica_db.execute(query)  # Read-only replica

def update_order_status(order_id: str, new_status: str):
    """Write tool: only changes order status, nothing else."""
    if new_status not in {"processing", "shipped", "delivered", "cancelled"}:
        raise ToolError(f"Invalid status: {new_status}")
    production_db.execute(
        "UPDATE orders SET status = %s WHERE id = %s",
        [new_status, order_id]
    )
```

---

## 6. File System Tools

File system access is dangerous. Path traversal can read `/etc/passwd`. Unrestricted writes can overwrite system files.

### Sandboxing

```python
import os

SANDBOX_DIR = "/app/agent-workspace"  # Agent can only access this directory

def resolve_safe_path(user_path: str) -> str:
    """Resolve a path and verify it's within the sandbox."""
    # Resolve to absolute path
    resolved = os.path.realpath(os.path.join(SANDBOX_DIR, user_path))

    # Verify it's within the sandbox
    if not resolved.startswith(os.path.realpath(SANDBOX_DIR)):
        raise ToolError(
            f"Access denied: path '{user_path}' resolves outside the sandbox. "
            f"You can only access files within the workspace directory."
        )

    return resolved

def read_file(path: str) -> str:
    """Read a file from the agent workspace (read-only)."""
    safe_path = resolve_safe_path(path)

    if not os.path.exists(safe_path):
        raise ToolError(f"File not found: {path}")

    size = os.path.getsize(safe_path)
    if size > 1_000_000:  # 1MB limit
        raise ToolError(f"File too large ({size} bytes). Max: 1MB")

    with open(safe_path, "r") as f:
        return f.read()

def write_file(path: str, content: str) -> str:
    """Write a file to the agent workspace."""
    safe_path = resolve_safe_path(path)

    # Prevent overwriting system files
    BLOCKED_EXTENSIONS = {".env", ".sh", ".bash", ".key", ".pem"}
    if os.path.splitext(safe_path)[1] in BLOCKED_EXTENSIONS:
        raise ToolError(f"Cannot write files with extension {os.path.splitext(path)[1]}")

    if len(content) > 1_000_000:
        raise ToolError("Content too large. Max: 1MB")

    os.makedirs(os.path.dirname(safe_path), exist_ok=True)
    with open(safe_path, "w") as f:
        f.write(content)

    return f"File written: {path} ({len(content)} bytes)"
```

### WRONG: Unsandboxed file access

```python
# WRONG: Agent can read any file on the system
def read_file(path: str) -> str:
    with open(path) as f:
        return f.read()
# LLM could call: read_file("/etc/shadow")

# WRONG: No size limit
def read_file(path: str) -> str:
    safe_path = resolve_safe_path(path)
    with open(safe_path) as f:
        return f.read()  # What if the file is 10GB? Blows up memory.
```

---

## 7. API Tools

Tools that call external APIs on behalf of the agent. Each needs authentication, rate limiting, timeouts, and error handling.

### API Tool Template

```python
class APITool:
    def __init__(self, base_url: str, api_key: str, rate_limit: int = 10):
        self.base_url = base_url
        self.api_key = api_key
        self.rate_limiter = RateLimiter(max_calls=rate_limit, period=60)
        self.timeout = 30  # seconds

    def call(self, endpoint: str, method: str = "GET",
             params: dict = None, body: dict = None) -> dict:
        # Rate limit check
        if not self.rate_limiter.allow():
            raise ToolError("Rate limit exceeded. Try again in a moment.")

        # Build request
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        headers = {"Authorization": f"Bearer {self.api_key}"}

        try:
            response = http_request(
                method=method,
                url=url,
                headers=headers,
                params=params,
                json=body,
                timeout=self.timeout,
            )
        except TimeoutError:
            raise ToolError(f"API call timed out after {self.timeout}s")
        except ConnectionError:
            raise ToolError("Could not connect to API. Service may be down.")

        if response.status_code >= 400:
            raise ToolError(
                f"API returned error {response.status_code}: "
                f"{response.text[:500]}"
            )

        return response.json()
```

### WRONG: Unrestricted API access

```python
# WRONG: Agent can call ANY URL with ANY method
def call_api(url: str, method: str, headers: dict, body: dict) -> str:
    return requests.request(method, url, headers=headers, json=body).text
# Agent could: POST to payment APIs, DELETE resources, exfiltrate data

# CORRECT: Scoped to specific endpoints
def get_weather(city: str) -> dict:
    """Get current weather for a city."""
    return weather_api.call(f"/current?city={quote(city)}")

def get_exchange_rate(from_currency: str, to_currency: str) -> dict:
    """Get current exchange rate between two currencies."""
    return fx_api.call(f"/rate?from={from_currency}&to={to_currency}")
```

### Retry with Backoff

```python
import time

def call_with_retry(func, max_retries: int = 3, base_delay: float = 1.0):
    """Retry API calls with exponential backoff."""
    last_error = None
    for attempt in range(max_retries):
        try:
            return func()
        except (TimeoutError, ConnectionError) as e:
            last_error = e
            delay = base_delay * (2 ** attempt)  # 1s, 2s, 4s
            time.sleep(delay)
        except ToolError:
            raise  # Don't retry client errors (400s)

    raise ToolError(f"API call failed after {max_retries} retries: {last_error}")
```

---

## 8. Web Scraping Tools

Tools for extracting data from websites. Powerful but risky — the agent is navigating the open web.

### Real-World: BHEN Playwright-Based Scraper

BHEN uses headless Playwright for web scraping with strict sandboxing:

```python
class WebScrapingTool:
    """Headless browser tool for extracting web content."""

    ALLOWED_DOMAINS = {"docs.python.org", "github.com", "stackoverflow.com"}
    MAX_PAGE_SIZE = 500_000  # 500KB
    TIMEOUT = 15  # seconds

    def __init__(self):
        self.browser = None

    async def scrape_page(self, url: str, selector: str = "body") -> str:
        """Scrape text content from a web page.

        Args:
            url: The URL to scrape (must be in allowed domains)
            selector: CSS selector to extract specific content (default: body)
        """
        # Validate domain
        domain = urlparse(url).netloc
        if domain not in self.ALLOWED_DOMAINS:
            raise ToolError(
                f"Domain '{domain}' not in allowed list. "
                f"Allowed: {self.ALLOWED_DOMAINS}"
            )

        # Validate URL scheme
        if not url.startswith(("https://", "http://")):
            raise ToolError("Only HTTP/HTTPS URLs are allowed")

        browser = await self.get_browser()
        page = await browser.new_page()

        try:
            # Block unnecessary resources
            await page.route("**/*.{png,jpg,gif,svg,mp4,woff,woff2}", lambda r: r.abort())

            await page.goto(url, timeout=self.TIMEOUT * 1000, wait_until="domcontentloaded")
            element = await page.query_selector(selector)

            if not element:
                return f"No element found matching selector: {selector}"

            text = await element.inner_text()

            # Limit output size
            if len(text) > self.MAX_PAGE_SIZE:
                text = text[:self.MAX_PAGE_SIZE] + "\n[TRUNCATED]"

            return text

        finally:
            await page.close()
```

### WRONG: Unrestricted web access

```python
# WRONG: Agent can browse any URL, including internal network
def scrape(url: str) -> str:
    return requests.get(url).text
# Agent could access: http://169.254.169.254/latest/meta-data/ (AWS metadata)
# Agent could access: http://localhost:5432/ (internal database)

# CORRECT: Domain allowlist + SSRF protection
BLOCKED_IPS = {"127.0.0.1", "169.254.169.254", "10.0.0.0/8", "172.16.0.0/12"}

def scrape(url: str) -> str:
    domain = urlparse(url).netloc
    if domain not in ALLOWED_DOMAINS:
        raise ToolError(f"Domain not allowed: {domain}")
    ip = socket.gethostbyname(domain)
    if is_private_ip(ip):
        raise ToolError("Cannot access internal/private IP addresses")
    return requests.get(url, timeout=15).text[:50000]
```

---

## 9. Search Tools

Tools for finding information — semantic search, keyword search, or hybrid. Core to any RAG system.

### Semantic Search (Vector Similarity)

```python
def semantic_search(query: str, collection: str = "documents",
                    limit: int = 5, threshold: float = 0.7) -> list:
    """Search documents by semantic similarity.

    Args:
        query: Natural language search query
        collection: Which document collection to search
        limit: Maximum results (default: 5)
        threshold: Minimum similarity score 0-1 (default: 0.7)
    """
    if collection not in ALLOWED_COLLECTIONS:
        raise ToolError(f"Unknown collection: {collection}")

    # Generate embedding for query
    query_embedding = embedding_model.encode(query)

    # Search vector database
    results = vector_db.search(
        collection=collection,
        vector=query_embedding,
        limit=limit,
        score_threshold=threshold,
    )

    return [
        {
            "content": r.text[:1000],    # Truncate long documents
            "source": r.metadata["source"],
            "score": round(r.score, 3),
        }
        for r in results
    ]
```

### Hybrid Search (Vector + Keyword)

```python
def hybrid_search(query: str, collection: str = "documents",
                  limit: int = 5) -> list:
    """Search using both semantic similarity and keyword matching.
    Combines results using Reciprocal Rank Fusion (RRF).
    """
    # Semantic search
    semantic_results = semantic_search(query, collection, limit=limit * 2)

    # Keyword search (BM25)
    keyword_results = keyword_search(query, collection, limit=limit * 2)

    # Combine with RRF
    combined = reciprocal_rank_fusion(
        [semantic_results, keyword_results],
        k=60,  # RRF constant
    )

    return combined[:limit]

def reciprocal_rank_fusion(result_lists: list, k: int = 60) -> list:
    """Combine multiple ranked lists using RRF."""
    scores = {}
    for result_list in result_lists:
        for rank, result in enumerate(result_list):
            doc_id = result["source"]
            if doc_id not in scores:
                scores[doc_id] = {"result": result, "score": 0}
            scores[doc_id]["score"] += 1.0 / (k + rank + 1)

    ranked = sorted(scores.values(), key=lambda x: x["score"], reverse=True)
    return [item["result"] for item in ranked]
```

### WRONG: Returning too many results

```python
# WRONG: Returns 50 documents — blows up the context window
def search(query: str) -> list:
    return vector_db.search(query, limit=50)
# 50 documents * ~500 tokens each = 25,000 tokens of context. Expensive.

# CORRECT: Return few, high-quality results
def search(query: str) -> list:
    results = vector_db.search(query, limit=10, score_threshold=0.75)
    # Rerank for quality
    reranked = reranker.rank(query, results)
    return reranked[:5]  # Top 5 after reranking
```

---

## 10. Idempotency

A tool is idempotent if calling it twice with the same arguments produces the same result without side effects. LLMs retry tools. Network failures cause retries. Your tools must handle this.

### Categories

| Category | Naturally Idempotent? | Strategy |
|----------|----------------------|----------|
| Read/query | Yes | No action needed |
| Create (POST) | No | Deduplication key |
| Update (PUT) | Yes (full replace) | No action needed |
| Update (PATCH) | Depends | Version check |
| Delete | Yes (after first call) | No action needed |
| Send email | No | Deduplication key |
| Payment | No | Idempotency key |

### Deduplication Keys

```python
def create_order(customer_id: str, items: list,
                 idempotency_key: str = None) -> dict:
    """Create a new order. Idempotent when idempotency_key is provided.

    Args:
        customer_id: The customer placing the order
        items: List of {product_id, quantity}
        idempotency_key: Unique key to prevent duplicate creation
    """
    if idempotency_key:
        existing = db.execute(
            "SELECT * FROM orders WHERE idempotency_key = %s",
            [idempotency_key]
        )
        if existing:
            return existing  # Return existing order, don't create duplicate

    order = db.execute(
        "INSERT INTO orders (customer_id, items, idempotency_key) "
        "VALUES (%s, %s, %s) RETURNING *",
        [customer_id, json.dumps(items), idempotency_key]
    )
    return order
```

### WRONG: Non-idempotent email tool

```python
# WRONG: Every call sends another email
def send_email(to: str, subject: str, body: str) -> str:
    mailer.send(to=to, subject=subject, body=body)
    return "Email sent"
# If the LLM retries (or calls twice by mistake), customer gets 2 emails

# CORRECT: Deduplicate by content hash
def send_email(to: str, subject: str, body: str) -> str:
    dedup_key = hashlib.sha256(f"{to}:{subject}:{body}".encode()).hexdigest()
    if cache.exists(f"email:{dedup_key}"):
        return "Email already sent (duplicate detected)"
    mailer.send(to=to, subject=subject, body=body)
    cache.set(f"email:{dedup_key}", "sent", ttl=3600)  # 1 hour dedup window
    return "Email sent"
```

---

## 11. Error Handling

When a tool fails, the error message goes back to the LLM. Good error messages help the LLM self-correct. Bad ones cause loops.

### Error Message Design

```python
# WRONG: Generic error — LLM will retry the same thing
def search_products(query: str) -> list:
    try:
        return db.search(query)
    except Exception:
        raise ToolError("An error occurred")
# LLM response: "Let me try again." (same error, forever)

# CORRECT: Specific error with actionable guidance
def search_products(query: str, category: str = None) -> list:
    if len(query) < 2:
        raise ToolError(
            "Search query too short (minimum 2 characters). "
            "Try a more specific search term."
        )
    if category and category not in VALID_CATEGORIES:
        raise ToolError(
            f"Invalid category '{category}'. "
            f"Valid categories: {VALID_CATEGORIES}. "
            f"Try again with one of these categories, or omit the category filter."
        )
    results = db.search(query, category=category)
    if not results:
        return (
            f"No products found for '{query}'"
            + (f" in category '{category}'" if category else "")
            + ". Try broader search terms or a different category."
        )
    return results
```

### Error Categories and LLM Guidance

| Error Type | Return to LLM | Example |
|-----------|---------------|---------|
| **Invalid input** | What was wrong + how to fix | "Invalid date format. Use YYYY-MM-DD." |
| **Not found** | What was searched + alternatives | "No order #123. Try searching by customer name." |
| **Permission denied** | What's not allowed + what is | "Cannot delete orders. You can update status instead." |
| **Rate limit** | When to retry | "Rate limit hit. Wait 30 seconds before retrying." |
| **External failure** | What failed + alternative action | "Payment API is down. Ask the user to try later." |
| **Internal error** | Generic message (don't leak internals) | "Internal error. Try a different approach." |

### Structured Error Returns

```python
@dataclass
class ToolResult:
    success: bool
    data: any = None
    error: str = None
    suggestion: str = None  # What the LLM should try instead

def execute_tool(tool, arguments) -> str:
    try:
        result = tool.execute(**arguments)
        return ToolResult(success=True, data=result).to_string()
    except ToolError as e:
        return ToolResult(
            success=False,
            error=str(e),
            suggestion=e.suggestion,
        ).to_string()
    except Exception as e:
        logger.error(f"Unexpected error in {tool.name}: {e}")
        return ToolResult(
            success=False,
            error="Internal error executing tool.",
            suggestion="Try a different approach or ask the user for help.",
        ).to_string()
```

---

## 12. Tool Composition

Simple tools that combine into complex actions. Better than monolithic tools because each piece is testable, reusable, and has limited scope.

### Composition Pattern

```python
# Instead of one complex "analyze_and_report" tool, compose simple tools:

# Tool 1: Gather data
def query_sales_data(period: str) -> list:
    """Query sales data for a given period (e.g., '2024-Q4')."""
    return db.query("SELECT * FROM sales WHERE period = %s", [period])

# Tool 2: Analyze data
def calculate_metrics(data: list) -> dict:
    """Calculate key metrics from sales data."""
    return {
        "total_revenue": sum(r["amount"] for r in data),
        "avg_deal_size": statistics.mean(r["amount"] for r in data),
        "conversion_rate": len([r for r in data if r["won"]]) / len(data),
    }

# Tool 3: Format output
def generate_report(metrics: dict, format: str = "markdown") -> str:
    """Format metrics into a human-readable report."""
    if format == "markdown":
        return format_markdown(metrics)
    elif format == "csv":
        return format_csv(metrics)

# The LLM orchestrates: query → calculate → report
# Each tool is simple, testable, and has clear permissions
```

### WRONG: Monolithic tool

```python
# WRONG: One tool that does everything — untestable, unsafe
def analyze_sales_and_send_report(period: str, email: str) -> str:
    data = db.query(...)        # DB access
    metrics = calculate(data)    # Business logic
    report = format(metrics)     # Formatting
    send_email(email, report)    # Side effect
    return "Report sent"
# Can't test calculation without DB. Can't test formatting without calculation.
# Can't query without sending email.

# CORRECT: Separate tools, LLM composes
# query_sales_data → calculate_metrics → generate_report → send_email
# Each step is independently testable and has its own permission level
```

---

## 13. Testing Patterns

Testing agent tools requires testing both the tool itself and how the LLM uses it.

### Unit Tests (Tool in Isolation)

```python
# Test the tool function directly — no LLM involved
def test_search_products_returns_results():
    results = search_products(query="laptop", category="electronics")
    assert len(results) > 0
    assert all("laptop" in r["name"].lower() for r in results)

def test_search_products_validates_category():
    with pytest.raises(ToolError, match="Invalid category"):
        search_products(query="laptop", category="nonexistent")

def test_search_products_limits_results():
    results = search_products(query="a", limit=5)
    assert len(results) <= 5
```

### Input Validation Tests

```python
# Test every edge case the LLM might produce
@pytest.mark.parametrize("bad_input,expected_error", [
    ("", "too short"),
    ("a" * 10000, "too long"),
    ("'; DROP TABLE--", "Invalid characters"),
    (None, "required"),
    (123, "must be a string"),
])
def test_search_rejects_bad_input(bad_input, expected_error):
    with pytest.raises(ToolError, match=expected_error):
        search_products(query=bad_input)
```

### Idempotency Tests

```python
def test_create_order_idempotent():
    key = "test-idem-001"
    order1 = create_order("C1", [{"product": "P1", "qty": 1}], idempotency_key=key)
    order2 = create_order("C1", [{"product": "P1", "qty": 1}], idempotency_key=key)
    assert order1["id"] == order2["id"]  # Same order, not a duplicate
```

### Integration Tests (LLM + Tool)

```python
# Test that the LLM uses the tool correctly for a given task
def test_agent_uses_search_for_product_query():
    agent = Agent(tools=[search_products, get_order_status])
    result = agent.run("Do you have any laptops under $1000?")

    # Verify the agent called the right tool
    assert agent.last_tool_calls[0].name == "search_products"
    assert "laptop" in agent.last_tool_calls[0].arguments["query"].lower()

    # Verify the response is useful (not just "I called the tool")
    assert "laptop" in result.lower()
    assert any(char.isdigit() for char in result)  # Contains prices

# Test error recovery
def test_agent_recovers_from_tool_error():
    agent = Agent(tools=[search_products_that_fails_once, search_products])
    result = agent.run("Find laptops")
    # Agent should handle the error and try again or inform the user
    assert "error" not in result.lower() or "couldn't find" in result.lower()
```

### Sandbox Tests

```python
def test_file_tool_blocks_path_traversal():
    with pytest.raises(ToolError, match="outside the sandbox"):
        read_file("../../etc/passwd")

def test_file_tool_blocks_path_traversal_encoded():
    with pytest.raises(ToolError, match="outside the sandbox"):
        read_file("..%2F..%2Fetc%2Fpasswd")

def test_sql_tool_blocks_write_operations():
    with pytest.raises(ToolError, match="Only SELECT"):
        execute_sql("DROP TABLE users")

    with pytest.raises(ToolError, match="Only SELECT"):
        execute_sql("UPDATE users SET admin = true")
```

---

## 14. Dangerous Tools and Human Approval

Some tools are too dangerous to execute automatically. They need human approval before execution.

### Risk Classification

| Risk Level | Actions | Approval Required |
|-----------|---------|------------------|
| **Low** | Read data, search, query | No |
| **Medium** | Create records, generate reports | No (with constraints) |
| **High** | Update records, modify state | Configurable |
| **Critical** | Delete data, send money, send emails, deploy | Always |

### Human-in-the-Loop Implementation

```python
class ApprovalGate:
    """Gate that pauses execution until a human approves."""

    def __init__(self, notification_channel: str = "slack"):
        self.channel = notification_channel

    async def request_approval(self, agent_id: str, tool_name: str,
                                arguments: dict, reason: str) -> bool:
        # Send approval request to human
        request = {
            "agent": agent_id,
            "tool": tool_name,
            "arguments": sanitize_for_display(arguments),
            "reason": reason,
            "timestamp": datetime.utcnow().isoformat(),
        }

        await send_notification(self.channel, {
            "text": f"Agent '{agent_id}' wants to execute '{tool_name}'",
            "details": json.dumps(request, indent=2),
            "actions": ["approve", "deny"],
        })

        # Wait for response (with timeout)
        response = await wait_for_response(request["timestamp"], timeout=300)

        if response is None:
            return False  # Timeout = deny
        return response.action == "approve"

# Decorator for dangerous tools
def requires_approval(func):
    async def wrapper(*args, **kwargs):
        approved = await approval_gate.request_approval(
            agent_id=current_agent(),
            tool_name=func.__name__,
            arguments=kwargs,
            reason=f"Agent wants to call {func.__name__}",
        )
        if not approved:
            raise ToolError(
                f"Human denied execution of {func.__name__}. "
                f"The action was not performed. Ask the user for alternatives."
            )
        return func(*args, **kwargs)
    return wrapper

# Usage
@requires_approval
def delete_customer_data(customer_id: str) -> str:
    """Permanently delete all data for a customer. IRREVERSIBLE."""
    db.execute("DELETE FROM customers WHERE id = %s", [customer_id])
    db.execute("DELETE FROM orders WHERE customer_id = %s", [customer_id])
    return f"Deleted all data for customer {customer_id}"

@requires_approval
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email. Requires human approval."""
    mailer.send(to=to, subject=subject, body=body)
    return f"Email sent to {to}"

@requires_approval
def process_refund(order_id: str, amount: float) -> str:
    """Process a financial refund. Requires human approval."""
    payment_gateway.refund(order_id, amount)
    return f"Refund of ${amount:.2f} processed for order {order_id}"
```

### Auto-Approve with Rules

For high-volume systems, define rules for auto-approval of low-risk actions:

```python
class ApprovalPolicy:
    """Rules-based approval for common cases, human for edge cases."""

    rules = [
        # Auto-approve small refunds
        {"tool": "process_refund", "condition": lambda args: args["amount"] < 50,
         "action": "auto_approve"},

        # Auto-approve internal emails
        {"tool": "send_email", "condition": lambda args: args["to"].endswith("@mycompany.com"),
         "action": "auto_approve"},

        # Always require human for large refunds
        {"tool": "process_refund", "condition": lambda args: args["amount"] >= 500,
         "action": "require_human"},

        # Always require human for external emails
        {"tool": "send_email", "condition": lambda args: not args["to"].endswith("@mycompany.com"),
         "action": "require_human"},
    ]

    def evaluate(self, tool_name: str, arguments: dict) -> str:
        for rule in self.rules:
            if rule["tool"] == tool_name and rule["condition"](arguments):
                return rule["action"]
        return "require_human"  # Default: require human approval
```

---

## Summary: Tool Design Checklist

Before shipping a new tool, verify:

| Check | Question |
|-------|----------|
| **Name & Description** | Can the LLM understand when to use this tool from the description alone? |
| **Least Privilege** | Is this the minimum permission the agent needs? Can it be read-only? |
| **Input Validation** | Are all inputs validated for type, range, format, and injection? |
| **Output Sanitization** | Is the output truncated, PII-stripped, and LLM-friendly? |
| **Idempotency** | Is it safe to call this tool twice with the same arguments? |
| **Error Messages** | Do errors tell the LLM what went wrong and what to try instead? |
| **Rate Limiting** | Is there a limit on how often this tool can be called? |
| **Timeout** | Does the tool have a timeout? What happens on timeout? |
| **Human Approval** | If this tool is dangerous, does it require human approval? |
| **Testing** | Do you have unit tests, validation tests, and sandbox escape tests? |
| **Logging** | Is every invocation logged with input summary, output summary, and duration? |
