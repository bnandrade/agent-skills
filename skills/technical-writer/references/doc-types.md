# Document Types

Guia para escolher o tipo certo de documentacao. Cada tipo com: quando criar, quem le, template e exemplo.

---

## Table of Contents

1. [README](#1-readme)
2. [API Documentation](#2-api-documentation)
3. [Architecture Documentation](#3-architecture-documentation)
4. [Onboarding Guide](#4-onboarding-guide)
5. [RFC / Design Doc](#5-rfc--design-doc)
6. [Runbook](#6-runbook)
7. [Changelog](#7-changelog)
8. [Contributing Guide](#8-contributing-guide)
9. [FAQ](#9-faq)
10. [Decision Log](#10-decision-log)
11. [Document Type Selection Guide](#11-document-type-selection-guide)

---

## 1. README

The front door to every project. If a developer can't get started in 5 minutes, the README failed.

### When to Create
- Every project, every repo, no exceptions
- Update when setup steps change, prerequisites change, or architecture shifts

### Who Reads It
- New developers evaluating or joining the project
- Future you, 6 months from now
- Open source contributors
- Hiring candidates assessing your engineering culture

### Template

```markdown
# Project Name

One sentence: what this does and why it exists.

## Quick Start

\`\`\`bash
git clone git@github.com:org/project.git
cd project
cp .env.example .env
docker compose up -d
open http://localhost:3000
\`\`\`

## Prerequisites

- Docker 27+
- Node 22+ (for frontend)
- Go 1.23+ (for API)

## Development

\`\`\`bash
# Install dependencies
make install

# Run tests
make test

# Run linter
make lint

# Run in development mode (hot reload)
make dev
\`\`\`

## Architecture

Brief description of the system architecture.
[Detailed architecture docs](docs/architecture.md)

```
app/
├── api/          # Go HTTP server
├── web/          # React frontend
├── worker/       # Background job processor
├── migrations/   # Database migrations
└── deploy/       # Docker and infra configs
```

## Environment Variables

| Variable | Description | Default | Required |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | - | Yes |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` | No |
| `API_PORT` | API server port | `8080` | No |

## Deploy

How to deploy to production (or link to deploy runbook).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
```

### Common Mistakes

```
WRONG: README with no Quick Start section
  → Developer spends 30 minutes figuring out how to run the project
  → They give up and ask someone on Slack

WRONG: Quick Start that requires 15 steps
  → Too much friction, nobody follows all 15 steps
  → Half the steps are outdated

CORRECT: Quick Start in 5 commands or less
  → git clone, cp .env, docker compose up, open browser
  → If it requires more, automate the setup into a script
```

---

## 2. API Documentation

Reference documentation for every endpoint. Must be complete, accurate, and include examples.

### When to Create
- When the API has external consumers (other teams, third parties)
- When the API is complex enough that Swagger alone isn't sufficient
- When onboarding new developers who will consume the API

### Who Reads It
- Frontend developers consuming the API
- Mobile developers
- Third-party integrators
- QA engineers writing test cases

### Template (per endpoint)

```markdown
## Create User

Creates a new user account.

**Endpoint:** `POST /api/v1/users`

**Authentication:** Bearer token (admin role required)

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Full name, 2-100 characters |
| `email` | string | Yes | Valid email, must be unique |
| `role` | string | No | One of: `user`, `admin`. Default: `user` |

**Example Request:**

\`\`\`bash
curl -X POST https://api.example.com/v1/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Maria Silva",
    "email": "maria@example.com",
    "role": "user"
  }'
\`\`\`

**Success Response (201 Created):**

\`\`\`json
{
  "id": "usr_abc123",
  "name": "Maria Silva",
  "email": "maria@example.com",
  "role": "user",
  "created_at": "2024-01-15T10:30:00Z"
}
\`\`\`

**Error Responses:**

| Status | Code | Description |
|---|---|---|
| 400 | `validation_error` | Invalid input (see errors array) |
| 409 | `email_taken` | Email already registered |
| 401 | `unauthorized` | Missing or invalid token |
| 403 | `forbidden` | Token doesn't have admin role |

**Error Example (400):**

\`\`\`json
{
  "error": {
    "code": "validation_error",
    "message": "Validation failed",
    "errors": [
      { "field": "email", "message": "Invalid email format" },
      { "field": "name", "message": "Name must be at least 2 characters" }
    ]
  }
}
\`\`\`
```

See `references/api-docs.md` for comprehensive API documentation strategies.

---

## 3. Architecture Documentation

How the system works, why it was built this way, and how the pieces fit together.

### When to Create
- When the system has more than 2-3 components
- When new developers need more than a day to understand the system
- When architectural decisions need to be recorded

### Who Reads It
- New team members (onboarding)
- Other teams that integrate with your system
- Future architects making decisions about the system
- Incident responders trying to understand blast radius

### Template

```markdown
# System Architecture: [Project Name]

## Overview

One paragraph: what the system does and its core architecture style.

## System Context (C4 Level 1)

Who uses this system and what external systems does it interact with?

[Diagram: system context — users, system, external dependencies]

## Container Diagram (C4 Level 2)

What are the major components/services?

[Diagram: containers — API, frontend, database, cache, queue]

| Container | Technology | Purpose |
|---|---|---|
| API | Go + Chi | REST API, business logic |
| Web | React + Vite | User-facing SPA |
| Worker | Go | Background job processing |
| Database | PostgreSQL 17 | Primary data store |
| Cache | Redis 7 | Session store, rate limiting |
| Queue | Redis Streams | Async job queue |

## Data Flow

How does data flow through the system for key operations?

### User Registration Flow
1. User submits form on Web
2. Web sends POST /api/v1/users to API
3. API validates, creates user in Database
4. API publishes UserCreated event to Queue
5. Worker picks up event, sends welcome email

### Order Processing Flow
[similar step-by-step]

## Key Architectural Decisions

| Decision | Rationale | Date |
|---|---|---|
| PostgreSQL over MySQL | JSONB support, better concurrency, pgvector for future AI features | 2024-01 |
| Monolith first | Team of 3, product-market fit uncertain, optimize for iteration speed | 2024-01 |
| Redis Streams over SQS | Lower latency, simpler ops (already running Redis for cache) | 2024-03 |

See `docs/adrs/` for detailed Architecture Decision Records.

## Infrastructure

Where does it run and how is it deployed?

[Diagram: infrastructure — servers, load balancers, CDN]

## Security

- Authentication: JWT tokens with 15-minute expiry, refresh tokens in HTTP-only cookies
- Authorization: RBAC with roles stored in PostgreSQL
- Encryption: TLS 1.3 in transit, AES-256 at rest for sensitive fields
- Rate limiting: 100 req/min per IP (unauthenticated), 1000 req/min per user

## Monitoring & Alerts

| Metric | Alert Threshold | Runbook |
|---|---|---|
| API error rate | > 1% for 5 min | [runbook-api-errors.md] |
| API p99 latency | > 2s for 10 min | [runbook-latency.md] |
| Queue depth | > 10,000 for 15 min | [runbook-queue.md] |
| Disk usage | > 80% | [runbook-disk.md] |
```

---

## 4. Onboarding Guide

Get a new developer productive in their first week. Not a comprehensive manual — a curated path.

### When to Create
- When the team has more than 2 people
- When you find yourself repeating the same setup instructions
- When new hires take more than 2 days to make their first PR

### Who Reads It
- New team members (day 1-5)
- Contractors or temporary collaborators
- Developers from other teams contributing a PR

### Template

```markdown
# Welcome to [Team/Project]

## Day 1: Setup

### 1. Get Access
- [ ] GitHub org invitation (ask @person)
- [ ] Slack channels: #team-name, #team-name-alerts
- [ ] 1Password vault: "Team Name - Dev"
- [ ] Staging environment credentials

### 2. Setup Local Environment
\`\`\`bash
# Clone and run
git clone git@github.com:org/project.git
cd project
./scripts/setup.sh  # installs deps, creates DB, seeds data
\`\`\`

Expected: browser opens to http://localhost:3000 with login screen.
Use admin@test.com / password123 in dev mode.

### 3. Verify Everything Works
\`\`\`bash
make test      # all tests should pass (~2 min)
make lint      # no errors
make dev       # app runs with hot reload
\`\`\`

If something fails, check [Troubleshooting](#troubleshooting) below.

## Day 2: Understand the System

### Read These (in order)
1. [Architecture overview](docs/architecture.md) — 15 min
2. [API docs](docs/api/) — skim, 20 min
3. [Key ADRs](docs/adrs/) — understand why we chose X, 30 min

### Explore the Code
Start here:
- `api/handlers/` — HTTP handlers (entry points)
- `api/services/` — Business logic
- `api/models/` — Data models
- `web/src/pages/` — Frontend pages

### Key Concepts
- [How authentication works](docs/auth.md)
- [How background jobs work](docs/jobs.md)
- [How we handle errors](docs/errors.md)

## Day 3-5: First Tasks

Pick from the "good first issue" label on GitHub.
Suggested order:
1. Fix a small bug (learn the codebase)
2. Add a simple feature (learn the workflow)
3. Write a missing test (learn the testing patterns)

## Who to Ask

| Topic | Person |
|---|---|
| Architecture questions | @alice |
| Frontend | @bob |
| DevOps / Deploy | @carol |
| Business context | @dave |

## Troubleshooting

### "Port 3000 already in use"
\`\`\`bash
lsof -ti:3000 | xargs kill -9
make dev
\`\`\`

### "Database connection refused"
\`\`\`bash
docker compose up -d postgres
make db-migrate
\`\`\`

### Tests fail with "relation does not exist"
\`\`\`bash
make db-test-reset  # recreates test database
\`\`\`
```

---

## 5. RFC / Design Doc

Propose a significant change before building it. Get feedback early, not in code review.

### When to Create
- Any change that takes more than 1 week to build
- Changes that affect multiple teams or systems
- New features with unclear requirements
- Architecture decisions with long-term impact
- When you're not sure which approach is best

### When NOT to Create
- Bug fixes
- Small features (< 1 week)
- Changes within a single module with clear requirements

### Who Reads It
- The team building the feature
- Tech leads and architects
- Product managers (summary section)
- Future developers understanding why a decision was made

### Template

```markdown
# RFC: [Feature/Change Title]

**Author:** [Name]
**Status:** Draft | Review | Accepted | Rejected | Superseded
**Created:** [Date]
**Updated:** [Date]
**Reviewers:** [Names]

## Summary

2-3 sentences: What are we doing and why?

## Motivation

Why is this change needed? What problem does it solve?
What happens if we don't do it?

## Detailed Design

### Option A: [Name]

How it works, architecture, data flow, API changes.

**Pros:**
- ...

**Cons:**
- ...

**Effort:** X weeks, Y developers

### Option B: [Name]

(Same structure as Option A)

### Recommendation

Which option and why.

## Migration Plan

How do we get from current state to target state?
Is it incremental? What's the rollback plan?

## Open Questions

1. [Question that needs answering before we proceed]
2. [Another question]

## Timeline

| Phase | Duration | Milestone |
|---|---|---|
| Design review | 1 week | RFC approved |
| Implementation | 3 weeks | Feature complete |
| Testing | 1 week | Ready for staging |
| Rollout | 1 week | 100% traffic |

## References

- [Link to related RFC]
- [Link to relevant docs]
```

### Common Mistakes

```
WRONG: RFC that's actually a specification
  → 40 pages, every edge case documented
  → Nobody reads it, takes 3 weeks to write
  → By the time it's "done," requirements changed

CORRECT: RFC that's a decision document
  → 2-4 pages, focuses on the WHY and tradeoffs
  → Written in 1-2 days
  → Enough detail to make a decision, not to write code from
```

---

## 6. Runbook

Step-by-step operational procedures. When it's 3 AM and something breaks, the on-call engineer reads this.

### When to Create
- Any procedure that happens regularly (deploy, maintenance)
- Incident response procedures
- Complex manual operations (database migrations, data exports)

### Who Reads It
- On-call engineers (possibly junior, possibly tired, possibly stressed)
- DevOps team during maintenance windows
- Developers debugging production issues

See `references/runbooks.md` for templates and detailed runbook guidance.

---

## 7. Changelog

User-facing record of what changed. Not a git log — a curated summary.

### When to Create
- Every release for products with users or API consumers
- Follow semantic versioning for libraries and APIs

### Who Reads It
- API consumers checking for breaking changes
- Users looking for new features or bug fixes
- Product managers tracking what shipped

### Template

```markdown
# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- User avatar upload (PNG, JPG, max 5MB)

### Changed
- Improved search performance (3x faster for large datasets)

### Fixed
- Fixed timezone handling for Australian users (#234)

---

## [2.1.0] - 2024-03-15

### Added
- SSO authentication via SAML 2.0
- Bulk user import from CSV

### Changed
- Upgraded PostgreSQL from 15 to 17
- Rate limit increased from 100 to 500 req/min for premium plans

### Deprecated
- `GET /api/v1/users/search` — use `GET /api/v2/users?q=` instead

### Fixed
- Fixed race condition in concurrent order creation (#189)
- Fixed email template rendering for non-Latin characters (#201)

---

## [2.0.0] - 2024-02-01

### Breaking Changes
- Removed `GET /api/v1/legacy-endpoint` (deprecated since v1.8)
- Changed `user.name` to `user.full_name` in all API responses
- Minimum Node.js version: 20 (was 18)

### Migration Guide
1. Update API client to use `full_name` instead of `name`
2. Upgrade Node.js to 20+
3. Remove calls to `/api/v1/legacy-endpoint`
```

### Rules

```
WRONG: Changelog is a git log dump
  "a]d8f2 fix typo"
  "b3c9e1 wip"
  "c4d0f2 Merge branch 'feature/thing'"

CORRECT: Changelog is curated for the reader
  "Added: User avatar upload (PNG, JPG, max 5MB)"
  → Human-readable, grouped by type, relevant to users
```

---

## 8. Contributing Guide

How to contribute to the project. Code standards, PR process, and expectations.

### When to Create
- Open source projects (always)
- Internal projects with contributions from outside the core team
- Projects with more than 5 regular contributors

### Who Reads It
- External contributors (open source)
- Developers from other teams submitting PRs
- New team members learning the workflow

### Template

```markdown
# Contributing to [Project]

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone git@github.com:YOU/project.git`
3. Create a branch: `git checkout -b feat/your-feature`
4. Make changes and commit (see [Commit Convention](#commit-convention))
5. Push: `git push origin feat/your-feature`
6. Open a Pull Request against `main`

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

\`\`\`
feat: add user avatar upload
fix: handle timezone correctly for AU users
docs: update API endpoint documentation
refactor: extract PaymentService from OrderController
test: add tests for discount calculation
chore: upgrade dependencies
\`\`\`

## Pull Request Guidelines

- Keep PRs small (< 400 lines changed)
- One logical change per PR
- Include tests for new functionality
- Update docs if behavior changes
- Fill in the PR template

## Code Style

- Run `make lint` before committing
- Follow existing patterns in the codebase
- No commented-out code
- No TODO comments without a linked issue

## Review Process

1. Open PR → CI runs automatically
2. Request review from at least 1 team member
3. Address feedback
4. Maintainer merges when approved + CI green

## Questions?

Open an issue with the "question" label or ask in #project-name on Slack.
```

---

## 9. FAQ

Common questions and troubleshooting. Should grow from actual questions people ask.

### When to Create
- When the same questions come up repeatedly
- When support tickets show patterns
- When onboarding reveals common confusion

### Who Reads It
- Anyone who encounters a specific problem
- New users/developers getting oriented
- Support team looking for answers

### Template

```markdown
# Frequently Asked Questions

## General

### What does this project do?
One sentence answer. Link to README for details.

### Who maintains this?
Team Name. Contact via #channel on Slack.

## Setup & Development

### How do I reset my local database?
\`\`\`bash
make db-reset  # drops, creates, migrates, seeds
\`\`\`

### My Docker containers won't start
Check if ports 3000, 5432, 6379 are available:
\`\`\`bash
lsof -i :3000 -i :5432 -i :6379
\`\`\`
If occupied, stop the conflicting service or change ports in `.env`.

### Tests pass locally but fail in CI
Most likely cause: test order dependency. Run tests in random order:
\`\`\`bash
make test-random
\`\`\`

## API

### How do I get an API token?
\`\`\`bash
curl -X POST https://api.example.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "your-password"}'
\`\`\`

### Why am I getting 429 Too Many Requests?
Rate limit: 100 requests/minute for free tier, 1000 for premium.
Wait 60 seconds or upgrade your plan.

## Deployment

### How do I deploy to staging?
Push to `staging` branch. CI deploys automatically.

### How do I rollback a production deploy?
See the [deploy rollback runbook](runbooks/deploy-rollback.md).
```

### Rule

```
WRONG: FAQ written before launch (guessing what people will ask)

CORRECT: FAQ grown from actual questions
  → When someone asks on Slack, add it to the FAQ
  → When a support ticket is resolved, add it to the FAQ
  → Review FAQ monthly: remove obsolete entries, add new ones
```

---

## 10. Decision Log

Lighter than an ADR. For decisions that are important to record but don't need a full formal document.

### When to Create
- When you choose between two reasonable options
- When future developers might wonder "why did they do it this way?"
- When the decision might be revisited later

### When to Use ADR Instead
- Architecture-level decisions (use `create-adr` skill)
- Decisions with long-term, system-wide impact
- Decisions requiring formal review

### Who Reads It
- Future team members wondering "why?"
- Current team members who missed the discussion
- You, in 6 months, when you've forgotten the context

### Template

```markdown
# Decision Log

| Date | Decision | Context | Alternatives Considered |
|---|---|---|---|
| 2024-03-15 | Use Zod for validation | Need runtime validation for API inputs, TypeScript types aren't enough | Yup (less TypeScript-native), Joi (no TS types), manual validation |
| 2024-03-10 | Use pnpm over npm | Faster installs, better monorepo support, stricter dependency resolution | npm (slower), yarn (extra complexity), bun (too new for production) |
| 2024-02-28 | Use ULIDs over UUIDs | Sortable, time-ordered, better for database indexing | UUIDv7 (not widely supported yet), UUIDv4 (not sortable), auto-increment (exposes count) |
| 2024-02-15 | Use Hetzner over AWS | 1/5th the cost for our workload, team has VPS experience, no vendor lock-in needed | AWS (expensive), DigitalOcean (middle ground), Railway (too limited) |
```

### Expanded Entry (when needed)

```markdown
## 2024-03-15: Use Zod for validation

### Context
We need runtime validation for API inputs. TypeScript types are erased at
runtime, so we can't rely on them for data coming from HTTP requests.

### Decision
Use Zod for all API input validation.

### Alternatives
- **Yup:** Less TypeScript-native, doesn't infer types as well
- **Joi:** No TypeScript type inference at all
- **Manual validation:** Error-prone, no standard error format

### Consequences
- Every API handler uses `schema.parse(req.body)` for validation
- Validation errors automatically have consistent format
- Can generate OpenAPI schemas from Zod schemas (with zod-to-openapi)
```

---

## 11. Document Type Selection Guide

```
What do you need to document?

How to run the project?
  → README (section 1)

How an API works?
  → API Documentation (section 2)

How the system is built?
  → Architecture Documentation (section 3)

How a new developer gets started?
  → Onboarding Guide (section 4)

A proposed change to the system?
  → RFC / Design Doc (section 5)

How to perform an operational task?
  → Runbook (section 6)

What changed in a release?
  → Changelog (section 7)

How to contribute to the project?
  → Contributing Guide (section 8)

Answers to common questions?
  → FAQ (section 9)

Why a specific decision was made?
  → Decision Log (section 10) or ADR (for architecture)
```

### Priority Order (if starting from zero)

```
1. README         ← create today (every project needs this)
2. Onboarding     ← create when second person joins
3. Contributing   ← create when third person joins
4. Changelog      ← create with first release
5. API docs       ← create when API has consumers
6. Runbooks       ← create before first incident
7. Architecture   ← create when system has 3+ components
8. RFC template   ← create when team has 5+ engineers
9. Decision log   ← create anytime (it's just a table)
10. FAQ           ← grow organically from real questions
```
