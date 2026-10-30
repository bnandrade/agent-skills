# Writing Guide

Estilo, formatacao, tom e estrutura para documentacao tecnica. Escreva para ser lido, nao para impressionar.

---

## Table of Contents

1. [Tone and Voice](#1-tone-and-voice)
2. [Structure Hierarchy](#2-structure-hierarchy)
3. [Sentence and Paragraph Rules](#3-sentence-and-paragraph-rules)
4. [Code Examples](#4-code-examples)
5. [Visual Elements](#5-visual-elements)
6. [Links and References](#6-links-and-references)
7. [Versioning Docs with Code](#7-versioning-docs-with-code)
8. [Templates](#8-templates)
9. [Markdown Best Practices](#9-markdown-best-practices)
10. [Common Mistakes](#10-common-mistakes)

---

## 1. Tone and Voice

### The Target Tone

Clear, direct, helpful. Like a senior colleague explaining something to a capable peer — not a professor lecturing, not a friend chatting.

```
WRONG (academic):
  "The implementation of the authentication mechanism necessitates
  the utilization of JSON Web Tokens, which facilitate stateless
  verification of user credentials across distributed systems."

WRONG (casual):
  "So basically we use JWTs for auth lol. They're pretty cool
  because you don't need to hit the database every request!"

CORRECT (clear + direct):
  "Authentication uses JWTs. The API validates tokens without
  database lookups, which keeps response times under 5ms."
```

### Rules

| Rule | Example |
|---|---|
| Active voice | "Run the command" not "The command should be run" |
| Second person | "You configure..." not "The user configures..." |
| Present tense | "This returns..." not "This will return..." |
| Imperative for instructions | "Install Docker" not "You should install Docker" |
| No hedge words | "This causes..." not "This might potentially cause..." |
| No unnecessary filler | Delete "basically", "simply", "just", "obviously", "clearly" |

### Active vs Passive Voice

```
WRONG (passive):
  "The configuration file is read by the application on startup."
  "An error will be thrown if the token is expired."
  "The database should be migrated before the new code is deployed."

CORRECT (active):
  "The application reads the configuration file on startup."
  "The API throws an error if the token is expired."
  "Migrate the database before deploying the new code."
```

### Removing Filler Words

```
WRONG:
  "Simply run the following command to basically install all of
  the necessary dependencies that you'll obviously need."

CORRECT:
  "Install dependencies:"
  (followed by the command)
```

---

## 2. Structure Hierarchy

When explaining something, use the most scannable format first:

```
1. Headers         ← for sections (reader can jump to what they need)
2. Bullet lists    ← for unordered items
3. Numbered lists  ← for sequences/steps
4. Code blocks     ← for commands, examples, configs
5. Tables          ← for comparisons, references
6. Diagrams        ← for flows, architecture
7. Prose           ← last resort (for context that can't be structured)
```

### Headers

```
WRONG: No headers (wall of text)
WRONG: Too many header levels (H1 → H2 → H3 → H4 → H5 → H6)
WRONG: Vague headers ("Introduction", "Details", "Conclusion")

CORRECT: Descriptive headers, max 3 levels deep
  # How Authentication Works          ← H1 (page title)
  ## Token Generation                  ← H2 (major section)
  ### Refresh Token Rotation           ← H3 (subsection)
```

### Lists vs Prose

```
WRONG (prose for what should be a list):
  "The API supports GET, POST, PUT, PATCH, and DELETE methods.
  GET retrieves resources, POST creates new resources, PUT replaces
  resources, PATCH partially updates resources, and DELETE removes
  resources."

CORRECT (list):
  The API supports these HTTP methods:
  - `GET` — Retrieve a resource
  - `POST` — Create a new resource
  - `PUT` — Replace a resource entirely
  - `PATCH` — Partially update a resource
  - `DELETE` — Remove a resource
```

### Tables vs Lists

Use tables when you're comparing items across the same dimensions:

```
WRONG (list for what should be a table):
  - Standard plan: 100 req/min, 1GB storage, $10/month
  - Pro plan: 1000 req/min, 10GB storage, $50/month
  - Enterprise: unlimited req/min, 100GB storage, custom pricing

CORRECT (table):
  | Plan | Rate Limit | Storage | Price |
  |---|---|---|---|
  | Standard | 100 req/min | 1GB | $10/mo |
  | Pro | 1,000 req/min | 10GB | $50/mo |
  | Enterprise | Unlimited | 100GB | Custom |
```

### Progressive Disclosure

```
WRONG: Everything upfront
  → 2000-word page about authentication
  → Reader just wants to know how to get a token

CORRECT: Quick answer first, details later
  ## Authentication

  Get a token:
  ```bash
  curl -X POST /auth/login -d '{"email":"...", "password":"..."}'
  ```

  ### How Tokens Work
  (Details for those who need to understand the mechanism)

  ### Token Refresh
  (Details for those implementing refresh logic)

  ### Security Considerations
  (Details for security-conscious readers)
```

---

## 3. Sentence and Paragraph Rules

### Sentence Length

```
Target: < 25 words per sentence
Maximum: 35 words (split if longer)

WRONG (52 words):
  "When the application starts up, it reads the configuration from
  the environment variables that have been set in the .env file,
  validates them against the schema defined in config/schema.ts,
  and then uses the validated configuration to initialize all of
  the service dependencies."

CORRECT (3 sentences, 14/11/13 words):
  "The application reads configuration from environment variables on startup.
  It validates them against `config/schema.ts`.
  Valid configuration initializes all service dependencies."
```

### Paragraph Length

```
Target: 2-4 sentences per paragraph
Maximum: 5 sentences

WRONG: 10-sentence paragraph (reader's eyes glaze over)

CORRECT: Short paragraphs with one idea each
  → Paragraph 1: What it does
  → Paragraph 2: How to use it
  → Paragraph 3: What to watch out for
```

### One Idea Per Sentence

```
WRONG:
  "Run `make test` to execute the test suite, which includes unit tests,
  integration tests, and end-to-end tests, and make sure all tests pass
  before submitting your PR, since CI will reject PRs with failing tests."

CORRECT:
  "Run `make test` to execute the full test suite (unit, integration, e2e).
  All tests must pass before submitting a PR. CI rejects PRs with failures."
```

---

## 4. Code Examples

### Rules for Code Examples

```
1. ALWAYS complete — no "..." or "// rest of code"
2. ALWAYS runnable — copy-paste should work
3. ALWAYS include expected output
4. ALWAYS specify the language in code fences
5. ALWAYS show the file path in a comment if context matters
6. NEVER show code that requires unstated prerequisites
```

### Before/After Pattern

```
WRONG (description only):
  "Use the createUser endpoint to create a new user by sending
  a POST request with name and email in the body."

CORRECT (show the code):
  ```bash
  curl -X POST https://api.example.com/v1/users \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name": "Maria Silva", "email": "maria@example.com"}'
  ```

  Response (201 Created):
  ```json
  {
    "id": "usr_abc123",
    "name": "Maria Silva",
    "email": "maria@example.com",
    "created_at": "2024-01-15T10:30:00Z"
  }
  ```
```

### Multi-Language Examples

When documenting an API, show examples in the languages your consumers use:

````markdown
### Create a user

**cURL:**

```bash
curl -X POST https://api.example.com/v1/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Maria", "email": "maria@example.com"}'
```

**JavaScript (fetch):**

```javascript
const response = await fetch("https://api.example.com/v1/users", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ name: "Maria", email: "maria@example.com" }),
});
const user = await response.json();
```

**PHP (Guzzle):**

```php
$response = $client->post('https://api.example.com/v1/users', [
    'headers' => ['Authorization' => "Bearer {$token}"],
    'json' => ['name' => 'Maria', 'email' => 'maria@example.com'],
]);
$user = json_decode($response->getBody(), true);
```

**Go:**

```go
body := map[string]string{"name": "Maria", "email": "maria@example.com"}
jsonBody, _ := json.Marshal(body)

req, _ := http.NewRequest("POST", "https://api.example.com/v1/users", bytes.NewBuffer(jsonBody))
req.Header.Set("Authorization", "Bearer "+token)
req.Header.Set("Content-Type", "application/json")

resp, err := http.DefaultClient.Do(req)
```
````

### Command Output

Always show what the reader should expect:

```
WRONG:
  Run `make test` to execute the tests.

CORRECT:
  Run `make test`:
  ```
  $ make test
  Running 142 tests...
  ✓ 142 passed, 0 failed (4.2s)
  ```
```

---

## 5. Visual Elements

### Screenshots

```
WRONG: Unannotated screenshot
  → Reader doesn't know what to look at
  → Screenshot becomes outdated when UI changes

CORRECT: Annotated screenshot with numbered steps
  → Red circles or arrows pointing to relevant UI elements
  → Numbered to match the step-by-step text
  → Alt text describes the screenshot content
  → Caption explains what the screenshot shows
```

```markdown
<!-- Screenshot with proper context -->
![Step 3: Click the "Deploy" button in the top-right corner](./assets/deploy-button.png)
*The Deploy button appears after all checks pass.*
```

### When to Use Diagrams vs Text

```
USE DIAGRAMS for:
  - System architecture (how components connect)
  - Data flows (how a request travels through the system)
  - State machines (which states transition to which)
  - Decision trees (flowcharts for complex decisions)

USE TEXT for:
  - Step-by-step instructions
  - Configuration details
  - API endpoint descriptions
  - Anything that changes frequently (diagrams are hard to update)
```

### ASCII Diagrams for Simple Flows

```
When a full diagram tool is overkill:

  Client → API Gateway → Auth Service → Database
                ↓
           Rate Limiter

Use Mermaid for anything more complex (see mermaid-studio skill).
```

---

## 6. Links and References

### Descriptive Link Text

```
WRONG:
  For more details, click [here](docs/auth.md).
  See [this page](https://example.com/docs) for configuration.

CORRECT:
  See the [authentication guide](docs/auth.md) for details.
  See the [configuration reference](https://example.com/docs).
```

### Internal vs External Links

```
Internal links (within the repo):
  Use relative paths: [Auth guide](./docs/auth.md)
  → Works in GitHub, IDE, and local Markdown viewers

External links:
  Use full URLs: [PostgreSQL docs](https://www.postgresql.org/docs/17/)
  → Add version numbers when possible (docs change between versions)
```

### Link Rot Prevention

```
WRONG: Links to specific lines of code (they shift with every commit)
  See [this function](https://github.com/org/repo/blob/main/src/auth.ts#L42)

CORRECT: Links to the file (or use a permalink with commit hash)
  See [auth.ts](https://github.com/org/repo/blob/main/src/auth.ts)
  or
  See [auth.ts at v2.1](https://github.com/org/repo/blob/v2.1.0/src/auth.ts#L42)
```

---

## 7. Versioning Docs with Code

### Docs Live in the Repo

```
WRONG: Documentation in Confluence/Notion/Google Docs
  → Out of sync with code within weeks
  → No review process (PRs don't touch docs)
  → No version history tied to code versions

CORRECT: Documentation in the repo
  project/
  ├── docs/
  │   ├── architecture.md
  │   ├── api/
  │   │   ├── authentication.md
  │   │   └── endpoints.md
  │   ├── runbooks/
  │   │   ├── deploy.md
  │   │   └── rollback.md
  │   └── adrs/
  │       ├── 001-use-postgresql.md
  │       └── 002-monolith-first.md
  ├── README.md
  ├── CHANGELOG.md
  └── CONTRIBUTING.md
```

### When Code Changes, Docs Change

```
WRONG: PR changes API behavior, doesn't update docs
  → Docs are now wrong
  → Someone wastes 2 hours debugging because they trusted the docs

CORRECT: PR template includes a docs checkbox
  ## PR Checklist
  - [ ] Tests added/updated
  - [ ] Documentation updated (if behavior changed)
  - [ ] Changelog entry added (if user-facing)
```

### Generated Docs

```
When possible, generate documentation from code:
  - API docs from OpenAPI spec (which is generated from code)
  - CLI help from code annotations
  - Configuration reference from schema definitions
  - Type definitions from source code

Generated docs are always accurate because they come from the source.
```

---

## 8. Templates

### README Template

```markdown
# [Project Name]

[One sentence: what this does and why.]

## Quick Start

\`\`\`bash
[3-5 commands to get running]
\`\`\`

## Prerequisites

- [Tool] [version]+
- [Tool] [version]+

## Development

\`\`\`bash
make install   # install dependencies
make dev       # run with hot reload
make test      # run tests
make lint      # run linter
\`\`\`

## Environment Variables

| Variable | Description | Default | Required |
|---|---|---|---|
| ... | ... | ... | ... |

## Architecture

[Brief description + link to detailed docs]

## Deploy

[How to deploy or link to runbook]

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
```

### RFC Template

```markdown
# RFC: [Title]

**Author:** [Name] | **Status:** Draft | **Date:** [YYYY-MM-DD]

## Summary
[2-3 sentences]

## Motivation
[Why is this needed?]

## Design
[How it works]

## Alternatives Considered
[What else was evaluated and why it was rejected]

## Open Questions
[What needs to be answered before proceeding]
```

### Runbook Template

```markdown
# Runbook: [Procedure Name]

**Last tested:** [Date] | **Owner:** [Team/Person]

## Purpose
[When to use this runbook]

## Prerequisites
- [ ] [Access/tool/credential needed]

## Steps

1. [Step with exact command]
   \`\`\`bash
   [command]
   \`\`\`
   Expected: [what you should see]

2. [Next step]
   ...

## Verification
[How to confirm the procedure worked]

## Rollback
[How to undo if something went wrong]

## Troubleshooting
[Common issues and solutions]
```

### Changelog Entry Template

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- [New feature description] (#issue)

### Changed
- [Modified behavior description] (#issue)

### Fixed
- [Bug fix description] (#issue)

### Deprecated
- [What's deprecated and what to use instead]

### Removed
- [What was removed (previously deprecated)]

### Security
- [Security fix description] (CVE if applicable)
```

---

## 9. Markdown Best Practices

### GitHub Flavored Markdown (GFM) Rules

```markdown
<!-- Headers: one blank line before and after -->

## Section Title

Content here.

## Next Section

<!-- Lists: no blank lines between items (unless multi-paragraph) -->

- Item one
- Item two
- Item three

<!-- Code fences: always specify language -->

```typescript
const x = 42;
```

<!-- Tables: align pipes for readability -->

| Name    | Type   | Required |
|---------|--------|----------|
| `email` | string | Yes      |
| `name`  | string | Yes      |
| `role`  | string | No       |

<!-- Links: descriptive text, not URLs -->

See the [deployment guide](docs/deploy.md) for details.
```

### Consistent Formatting

| Element | Convention |
|---|---|
| File names | `kebab-case.md` |
| Headers | Title Case for H1, Sentence case for H2+ |
| Code references | Always in `backticks` |
| File paths | Always in `backticks` |
| CLI commands | `backticks` inline, code block for multi-line |
| Key terms (first use) | **bold** |
| Emphasis | *italic* (use sparingly) |
| Environment variables | `UPPER_SNAKE_CASE` in backticks |

### Admonitions (GitHub-style)

```markdown
> [!NOTE]
> This is additional context that's helpful but not critical.

> [!TIP]
> This is a useful suggestion or shortcut.

> [!IMPORTANT]
> This is essential information the reader must know.

> [!WARNING]
> This could cause problems if ignored.

> [!CAUTION]
> This could cause data loss or security issues if ignored.
```

---

## 10. Common Mistakes

### 10.1 Walls of Text

```
WRONG:
  A 500-word paragraph explaining how the authentication system
  works, covering JWT generation, token refresh, RBAC, session
  management, and security considerations all in one block.

CORRECT:
  ## Authentication
  ### Token Generation
  (3 sentences + code example)
  ### Token Refresh
  (3 sentences + code example)
  ### Role-Based Access
  (table of roles + permissions)
```

### 10.2 Outdated Examples

```
WRONG:
  ```bash
  npm install --save express  # --save hasn't been needed since npm 5
  ```

CORRECT:
  ```bash
  npm install express
  ```

Prevention: Treat code examples like code — test them, update them,
review them in PRs.
```

### 10.3 Assumed Knowledge

```
WRONG:
  "Configure the reverse proxy and set up the SSL certificate."
  → Which reverse proxy? How to configure? Which SSL tool?

CORRECT:
  "Set up Caddy as a reverse proxy with automatic HTTPS:
  ```
  # /etc/caddy/Caddyfile
  api.example.com {
    reverse_proxy localhost:8080
  }
  ```
  Caddy obtains and renews SSL certificates automatically."
```

### 10.4 Documentation That Duplicates Code

```
WRONG:
  "The UserController has 5 methods: index, show, store, update, delete.
  The index method retrieves all users. The show method retrieves a
  single user by ID. The store method creates a new user..."

  → This adds zero value. The code already says this.

CORRECT:
  "The Users API follows standard REST conventions.
  See the [API reference](docs/api/users.md) for endpoints,
  authentication, and error responses."

  → Document what the code DOESN'T tell you: business rules,
    edge cases, authentication requirements, error scenarios.
```

### 10.5 Missing Prerequisites

```
WRONG:
  ## Quick Start
  ```bash
  docker compose up -d
  ```
  → Reader doesn't have Docker installed. Or doesn't have the .env file.

CORRECT:
  ## Prerequisites
  - Docker 27+ ([install guide](https://docs.docker.com/get-docker/))
  - Git

  ## Quick Start
  ```bash
  git clone git@github.com:org/project.git
  cd project
  cp .env.example .env
  docker compose up -d
  ```
```

### 10.6 Jargon Without Context

```
WRONG:
  "The service uses CQRS with event sourcing, deployed on K8s
  with Istio sidecar proxies behind a CDN with edge caching."

CORRECT (for mixed audience):
  "The service separates read and write operations (CQRS pattern)
  and stores all changes as events (event sourcing) for a complete
  audit trail. It runs on Kubernetes with Istio for service mesh
  networking, behind Cloudflare for caching and DDoS protection."
```

### 10.7 No Examples for Error States

```
WRONG:
  "The API returns an error if the email is invalid."
  → What does the error look like? What status code? What format?

CORRECT:
  "Invalid email returns a 400 error:
  ```json
  {
    "error": {
      "code": "validation_error",
      "message": "Invalid email format",
      "field": "email"
    }
  }
  ```"
```

---

## Quick Reference: Writing Checklist

Before publishing any document:

```
[ ] Title clearly describes the content
[ ] Reader can find what they need in < 30 seconds (headers, ToC)
[ ] Sentences are < 25 words
[ ] Active voice throughout
[ ] Code examples are complete and runnable
[ ] Expected output is shown for commands
[ ] No jargon without explanation
[ ] No assumed knowledge without prerequisites section
[ ] Links use descriptive text (not "click here")
[ ] Markdown renders correctly (preview before committing)
```
