# CI/CD Pipelines

GitHub Actions workflow patterns, caching strategies, matrix builds, Docker build/push, deploy pipelines, secret management, and common automation patterns. Targets GitHub Actions with 2026 action versions.

---

## Table of Contents

1. [GitHub Actions Fundamentals](#1-github-actions-fundamentals)
2. [Triggers & Filters](#2-triggers--filters)
3. [Caching Strategies](#3-caching-strategies)
4. [Matrix Builds](#4-matrix-builds)
5. [Secret Management](#5-secret-management)
6. [Testing Pipeline](#6-testing-pipeline)
7. [Docker Build & Push](#7-docker-build--push)
8. [Reusable Workflows & Composite Actions](#8-reusable-workflows--composite-actions)
9. [Deploy Pipelines](#9-deploy-pipelines)
10. [Environments & Approvals](#10-environments--approvals)
11. [Artifacts](#11-artifacts)
12. [Monorepo Patterns](#12-monorepo-patterns)
13. [Notifications](#13-notifications)
14. [Self-Hosted Runners](#14-self-hosted-runners)
15. [Common Workflow Recipes](#15-common-workflow-recipes)

---

## 1. GitHub Actions Fundamentals

### 1.1 Workflow Structure

```yaml
# .github/workflows/ci.yml
name: CI                           # workflow name (shown in Actions tab)

on:                                 # trigger events
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:                        # least-privilege permissions
  contents: read

jobs:
  test:                             # job ID
    name: Run Tests                 # display name
    runs-on: ubuntu-latest          # runner
    timeout-minutes: 15             # kill if stuck

    steps:
      - uses: actions/checkout@v4   # checkout code

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci                 # install deps
      - run: npm test               # run tests
```

### 1.2 WRONG/CORRECT: Common Mistakes

```yaml
# WRONG: no timeout — stuck jobs run for 6 hours (default)
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test

# CORRECT: always set timeout
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: npm test
```

```yaml
# WRONG: overly broad permissions
permissions: write-all

# CORRECT: least-privilege
permissions:
  contents: read
  packages: write    # only if pushing to GHCR
```

```yaml
# WRONG: no concurrency control — multiple deploys running simultaneously
jobs:
  deploy:
    runs-on: ubuntu-latest

# CORRECT: cancel in-progress runs for the same branch
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: true
```

---

## 2. Triggers & Filters

### 2.1 Common Triggers

```yaml
on:
  # Push to specific branches
  push:
    branches: [main, develop]
    paths:
      - 'src/**'
      - 'package.json'
    paths-ignore:
      - '**.md'
      - 'docs/**'

  # Pull request events
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]

  # Manual trigger with inputs
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deploy environment'
        required: true
        type: choice
        options: [staging, production]
      skip_tests:
        description: 'Skip tests'
        type: boolean
        default: false

  # Scheduled (cron)
  schedule:
    - cron: '0 6 * * 1'   # every Monday at 6:00 UTC

  # On release
  release:
    types: [published]

  # On tag push
  push:
    tags:
      - 'v*.*.*'          # v1.0.0, v2.1.3, etc.
```

### 2.2 Conditional Steps

```yaml
steps:
  - name: Deploy to production
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    run: make deploy

  - name: Comment on PR
    if: github.event_name == 'pull_request'
    run: echo "This is a PR"

  - name: Skip tests if requested
    if: ${{ !inputs.skip_tests }}
    run: npm test

  - name: Run only on tags
    if: startsWith(github.ref, 'refs/tags/')
    run: make release
```

---

## 3. Caching Strategies

### 3.1 Built-in Cache in Setup Actions

Most setup actions have built-in caching — prefer this over manual `actions/cache`:

```yaml
# Node.js — built-in cache
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: npm           # or 'yarn' or 'pnpm'

# Go — built-in cache
- uses: actions/setup-go@v5
  with:
    go-version: '1.26'
    cache: true

# Python — setup + manual cache for pip
- uses: actions/setup-python@v5
  with:
    python-version: '3.13'
    cache: pip
```

### 3.2 Manual Caching (Composer, Custom)

```yaml
# PHP / Composer
- name: Get Composer cache dir
  id: composer-cache
  run: echo "dir=$(composer config cache-files-dir)" >> $GITHUB_OUTPUT

- uses: actions/cache@v4
  with:
    path: ${{ steps.composer-cache.outputs.dir }}
    key: ${{ runner.os }}-composer-${{ hashFiles('**/composer.lock') }}
    restore-keys: |
      ${{ runner.os }}-composer-

- run: composer install --prefer-dist --no-interaction
```

```yaml
# Generic cache pattern
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/custom-tool
      .build-cache
    key: ${{ runner.os }}-custom-${{ hashFiles('config.lock') }}
    restore-keys: |
      ${{ runner.os }}-custom-
```

### 3.3 WRONG/CORRECT: Caching

```yaml
# WRONG: no caching — installs 500MB of deps on every run
steps:
  - run: composer install
  - run: npm ci

# CORRECT: cache deps — 30s instead of 3min
steps:
  - uses: actions/cache@v4
    with:
      path: vendor
      key: ${{ runner.os }}-composer-${{ hashFiles('composer.lock') }}
  - run: composer install --prefer-dist
```

```yaml
# WRONG: cache key doesn't include lockfile — stale cache
- uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-modules   # never changes!

# CORRECT: key includes lockfile hash
- uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
```

---

## 4. Matrix Builds

### 4.1 Multiple PHP/Node Versions

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false    # don't cancel other jobs if one fails
      matrix:
        php-version: ['8.3', '8.4']
        node-version: [20, 22]
        database: [mysql, pgsql]
        exclude:
          - php-version: '8.3'
            database: pgsql    # skip this combination

    steps:
      - uses: actions/checkout@v4

      - uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php-version }}
          extensions: pdo_${{ matrix.database }}, mbstring, xml

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm

      - run: composer install --prefer-dist
      - run: npm ci
      - run: php artisan test
```

### 4.2 Matrix with Include (Add Specific Combinations)

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest]
    go-version: ['1.25', '1.26']
    include:
      # Add Windows only for latest Go
      - os: windows-latest
        go-version: '1.26'
      # Add extra env var for specific combo
      - os: ubuntu-latest
        go-version: '1.26'
        coverage: true
```

---

## 5. Secret Management

### 5.1 Using Secrets

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        env:
          SSH_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          HOST: ${{ secrets.DEPLOY_HOST }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          ssh -o StrictHostKeyChecking=no -i ~/.ssh/deploy_key user@$HOST 'cd /app && ./deploy.sh'

      - name: Push to registry
        env:
          REGISTRY_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          echo "$REGISTRY_TOKEN" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
```

### 5.2 WRONG/CORRECT: Secret Handling

```yaml
# WRONG: secret in command line (visible in logs)
- run: docker login -u user -p ${{ secrets.REGISTRY_PASSWORD }} ghcr.io

# CORRECT: pipe to stdin (not visible in logs)
- run: echo "${{ secrets.REGISTRY_PASSWORD }}" | docker login ghcr.io -u user --password-stdin
```

```yaml
# WRONG: secret as build arg (stored in image layer metadata)
- run: docker build --build-arg API_KEY=${{ secrets.API_KEY }} .

# CORRECT: use BuildKit secret mount
- run: |
    echo "${{ secrets.API_KEY }}" > /tmp/api_key
    docker build --secret id=api_key,src=/tmp/api_key .
    rm /tmp/api_key
```

### 5.3 Environment-Scoped Secrets

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production    # uses secrets defined in "production" environment
    steps:
      - run: echo "Deploying with ${{ secrets.PROD_DATABASE_URL }}"
      # This secret is only available when running in the "production" environment
```

### 5.4 OIDC (Keyless Auth to Cloud Providers)

No long-lived secrets needed — GitHub generates short-lived tokens:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789:role/github-actions
      aws-region: us-east-1
      # No AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY needed
```

---

## 6. Testing Pipeline

### 6.1 Laravel CI Pipeline

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
          tools: phpstan, pint

      - run: composer install --prefer-dist
      - run: pint --test
      - run: phpstan analyse

  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 3s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 3

    steps:
      - uses: actions/checkout@v4

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
          extensions: pdo_pgsql, redis, mbstring, xml
          coverage: xdebug

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install PHP dependencies
        run: composer install --prefer-dist

      - name: Install JS dependencies
        run: npm ci

      - name: Build assets
        run: npm run build

      - name: Run tests
        env:
          DB_CONNECTION: pgsql
          DB_HOST: localhost
          DB_DATABASE: test
          DB_USERNAME: test
          DB_PASSWORD: test
          REDIS_HOST: localhost
        run: php artisan test --coverage --min=80

  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    timeout-minutes: 10
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t myapp:${{ github.sha }} .
```

### 6.2 Node.js CI Pipeline

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test -- --coverage
```

### 6.3 Go CI Pipeline

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: '1.26'

      - name: Lint
        uses: golangci/golangci-lint-action@v6

      - name: Test
        run: go test -race -count=1 -coverprofile=coverage.out ./...

      - name: Build
        run: go build ./cmd/...
```

---

## 7. Docker Build & Push

### 7.1 Push to GitHub Container Registry (GHCR)

```yaml
name: Build & Push

on:
  push:
    branches: [main]
    tags: ['v*']

permissions:
  contents: read
  packages: write

jobs:
  docker:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=ref,event=branch
            type=sha,prefix=
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable={{is_default_branch}}

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### 7.2 Push to Docker Hub

```yaml
- uses: docker/login-action@v3
  with:
    username: ${{ secrets.DOCKERHUB_USERNAME }}
    password: ${{ secrets.DOCKERHUB_TOKEN }}

- uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    tags: |
      myorg/myapp:latest
      myorg/myapp:${{ github.sha }}
```

### 7.3 Multi-Platform Build

```yaml
- uses: docker/setup-qemu-action@v3    # required for cross-platform

- uses: docker/setup-buildx-action@v3

- uses: docker/build-push-action@v6
  with:
    context: .
    platforms: linux/amd64,linux/arm64
    push: true
    tags: ghcr.io/${{ github.repository }}:latest
```

### 7.4 WRONG/CORRECT: Docker CI

```yaml
# WRONG: no build cache — 10min builds every time
- uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    tags: myapp:latest

# CORRECT: GitHub Actions cache — 2min builds after first
- uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    tags: myapp:latest
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

---

## 8. Reusable Workflows & Composite Actions

### 8.1 Reusable Workflow (Called by Other Workflows)

```yaml
# .github/workflows/reusable-docker.yml
name: Docker Build (Reusable)

on:
  workflow_call:
    inputs:
      image_name:
        required: true
        type: string
      dockerfile:
        required: false
        type: string
        default: Dockerfile
    secrets:
      registry_token:
        required: true

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.registry_token }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: ${{ inputs.dockerfile }}
          push: true
          tags: ghcr.io/${{ inputs.image_name }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Caller:

```yaml
# .github/workflows/ci.yml
jobs:
  build-api:
    uses: ./.github/workflows/reusable-docker.yml
    with:
      image_name: myorg/api
      dockerfile: apps/api/Dockerfile
    secrets:
      registry_token: ${{ secrets.GITHUB_TOKEN }}

  build-worker:
    uses: ./.github/workflows/reusable-docker.yml
    with:
      image_name: myorg/worker
      dockerfile: apps/worker/Dockerfile
    secrets:
      registry_token: ${{ secrets.GITHUB_TOKEN }}
```

### 8.2 Composite Action (Reusable Steps)

```yaml
# .github/actions/setup-php-project/action.yml
name: Setup PHP Project
description: Install PHP, Composer deps, and Node deps

inputs:
  php-version:
    description: PHP version
    default: '8.4'
  node-version:
    description: Node version
    default: '22'

runs:
  using: composite
  steps:
    - uses: shivammathur/setup-php@v2
      with:
        php-version: ${{ inputs.php-version }}
        extensions: pdo_pgsql, redis, mbstring

    - name: Composer cache
      uses: actions/cache@v4
      with:
        path: vendor
        key: ${{ runner.os }}-composer-${{ hashFiles('composer.lock') }}

    - run: composer install --prefer-dist --no-interaction
      shell: bash

    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: npm

    - run: npm ci
      shell: bash
```

Usage:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/setup-php-project
    with:
      php-version: '8.4'
  - run: php artisan test
```

---

## 9. Deploy Pipelines

### 9.1 SSH Deploy to VPS

```yaml
name: Deploy

on:
  push:
    branches: [main]

concurrency:
  group: deploy-production
  cancel-in-progress: false    # don't cancel in-progress deploys

jobs:
  test:
    uses: ./.github/workflows/ci.yml

  deploy:
    needs: test
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: production
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/myapp
            docker compose pull
            docker compose up -d --remove-orphans
            docker compose exec -T app php artisan migrate --force
            docker compose exec -T app php artisan optimize
            docker image prune -f
```

### 9.2 Docker-Based Deploy (Pull & Restart)

```yaml
jobs:
  deploy:
    needs: [build]
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deploy new version
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: deploy
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            set -e

            cd /opt/myapp

            # Pull new image
            echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
            docker compose pull

            # Run migrations before switching
            docker compose run --rm app php artisan migrate --force

            # Restart with new image (zero downtime with health checks)
            docker compose up -d --remove-orphans

            # Verify deployment
            sleep 5
            curl -sf http://localhost:8080/health || (docker compose logs app && exit 1)

            # Cleanup
            docker image prune -f
```

### 9.3 Deploy to Railway / Render / Fly.io

```yaml
# Railway — auto-deploys from GitHub, but you can trigger manually
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: railwayapp/cli-action@v1
        with:
          railway_token: ${{ secrets.RAILWAY_TOKEN }}
      - run: railway up --service myapp

# Fly.io
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

---

## 10. Environments & Approvals

### 10.1 Environment Protection Rules

Configure in GitHub Settings > Environments:

```yaml
jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging        # auto-deploys (no protection)
    steps:
      - run: echo "Deploying to staging"

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production     # requires approval (configured in GitHub)
    steps:
      - run: echo "Deploying to production"
```

### 10.2 Manual Approval via workflow_dispatch

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [staging, production]
      version:
        description: 'Image tag to deploy'
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - run: echo "Deploying ${{ inputs.version }} to ${{ inputs.environment }}"
```

---

## 11. Artifacts

### 11.1 Upload & Download Build Artifacts

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build

      - uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: dist/
          retention-days: 7

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: build-output
          path: dist/

      - run: ls -la dist/    # artifacts are here
```

### 11.2 Test Reports

```yaml
- run: npm test -- --reporter=junit --output-file=reports/junit.xml

- uses: actions/upload-artifact@v4
  if: always()    # upload even if tests fail
  with:
    name: test-results
    path: reports/junit.xml
```

---

## 12. Monorepo Patterns

### 12.1 Path Filters

```yaml
on:
  push:
    branches: [main]
  pull_request:

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      api: ${{ steps.changes.outputs.api }}
      web: ${{ steps.changes.outputs.web }}
      shared: ${{ steps.changes.outputs.shared }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: changes
        with:
          filters: |
            api:
              - 'apps/api/**'
              - 'packages/shared/**'
            web:
              - 'apps/web/**'
              - 'packages/shared/**'
            shared:
              - 'packages/shared/**'

  test-api:
    needs: detect-changes
    if: needs.detect-changes.outputs.api == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd apps/api && make test

  test-web:
    needs: detect-changes
    if: needs.detect-changes.outputs.web == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd apps/web && npm test
```

---

## 13. Notifications

### 13.1 Slack Notification on Failure

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: make deploy

      - name: Notify Slack on failure
        if: failure()
        uses: slackapi/slack-github-action@v2
        with:
          webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": ":x: Deploy failed on `${{ github.repository }}`",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*Deploy Failed*\nRepo: `${{ github.repository }}`\nBranch: `${{ github.ref_name }}`\nCommit: `${{ github.sha }}`\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View Run>"
                  }
                }
              ]
            }
```

### 13.2 Discord Notification

```yaml
- name: Notify Discord
  if: failure()
  env:
    DISCORD_WEBHOOK: ${{ secrets.DISCORD_WEBHOOK_URL }}
  run: |
    curl -H "Content-Type: application/json" \
      -d "{\"content\": \"Deploy failed: ${{ github.repository }} (${{ github.ref_name }}) — ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\"}" \
      "$DISCORD_WEBHOOK"
```

---

## 14. Self-Hosted Runners

### 14.1 When to Use

| Use Self-Hosted | Use GitHub-Hosted |
|---|---|
| Builds need GPU access | Standard CI (lint, test, build) |
| Accessing private network resources | Open source projects |
| Very large builds (>14GB RAM) | Small-to-medium repos |
| Strict compliance (data can't leave network) | Most teams |
| Cost optimization for high-volume repos | Teams with <1000 CI min/month |

### 14.2 Runner Setup

```yaml
# Use a specific runner label
jobs:
  build:
    runs-on: [self-hosted, linux, x64]
    steps:
      - uses: actions/checkout@v4
      - run: make build
```

### 14.3 WRONG/CORRECT: Self-Hosted Runners

```yaml
# WRONG: no cleanup — workspace grows indefinitely
jobs:
  build:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - run: docker build .

# CORRECT: clean workspace and prune Docker
jobs:
  build:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
        with:
          clean: true
      - run: docker build .
      - name: Cleanup
        if: always()
        run: docker image prune -f --filter "until=24h"
```

---

## 15. Common Workflow Recipes

### 15.1 PR Checks (Lint + Test + Build)

```yaml
name: PR Checks

on:
  pull_request:

concurrency:
  group: pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test

  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build
```

### 15.2 Release Workflow (Tag-Triggered)

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write
  packages: write

jobs:
  release:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

### 15.3 Scheduled Maintenance

```yaml
name: Maintenance

on:
  schedule:
    - cron: '0 3 * * 0'    # Sundays at 3:00 UTC

jobs:
  update-deps:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      - run: npx npm-check-updates -u
      - run: npm install

      - name: Create PR if changes
        uses: peter-evans/create-pull-request@v6
        with:
          commit-message: 'chore: update dependencies'
          title: 'chore: weekly dependency update'
          branch: chore/update-deps
          delete-branch: true

  security-audit:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - run: npm audit --production
      - run: composer audit
```
