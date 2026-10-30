# Workflow de Projeto

Dois trilhos, conforme o ponto de partida:

- **[Greenfield](#fluxo-greenfield)** — criando do zero, partindo da fonte de verdade do produto. Vai de **regras → especificação → arquitetura → plano de desenvolvimento**.
- **[Projeto existente](#fluxo-de-projeto-existente)** — já tem código rodando. Vai de **entender → auditar → corrigir → deploy**.

Em ambos o fluxo é fixo — a **profundidade** muda conforme o estágio e o tamanho.

> As skills são globais (instaladas via `install.sh`), então você as invoca de dentro de **qualquer projeto**. Este arquivo é só o *mapa* do processo — a fonte de verdade e o código vivem no repo do produto, não aqui.

---

## Fluxo Greenfield

Para quando você está criando um sistema **do zero**, partindo da **fonte de verdade do produto** (as regras de negócio que você define ANTES de qualquer código). A fonte de verdade vive no repo do produto; aqui fica só o roteiro.

```
FONTE DE VERDADE (definida no repo do produto)
        ↓
1. DESAFIAR        the-fool            → fura as regras antes de construir em cima
        ↓
2. ESPECIFICAR     tlc-spec-driven     → regras → requisitos rastreáveis
   (fase Specify)
        ↓
3. ARQUITETAR      software-architect  → stack, boundaries, padrões, build-vs-buy
   (+ agent-engineer se for sistema agêntico)
        ↓
4. REGISTRAR       create-adr          → cristaliza cada decisão grande + o "porquê"
        ↓
5. MODELAR DADOS   database-expert     → schema, relacionamentos, índices, ERD
        ↓
6. CONTRATOS       api-designer        → endpoints, erros, paginação, OpenAPI
        ↓
7. TESTES          testing-strategist  → o que testar por camada, desde o dia 1
        ↓
8. PLANO DE DEV    tlc-spec-driven     → integra 3-7 em design técnico + tasks atômicas
   (fase Design+Tasks)
        ↓
9. DOCUMENTAR      technical-writer    → README, design doc navegável
   + DIAGRAMAR     mermaid-studio      → C4 context/container, ERD, sequence dos fluxos
```

### O que cada etapa entrega

| # | Skill | Entrega (alimenta a próxima) |
|---|---|---|
| 1 | `the-fool` | Premissas frágeis e riscos → você revisa a fonte de verdade antes de gastar esforço |
| 2 | `tlc-spec-driven` (Specify) | Requisitos formais rastreáveis até as regras |
| 3 | `software-architect` | Stack + boundaries + padrão arquitetural |
| 4 | `create-adr` | 1 ADR por decisão estrutural (banco, monolito vs serviços...) |
| 5 | `database-expert` | Schema + ERD + estratégia de índices |
| 6 | `api-designer` | Contrato de API / OpenAPI |
| 7 | `testing-strategist` | Pirâmide de testes e cobertura-alvo pro launch |
| 8 | `tlc-spec-driven` (Design+Tasks) | **Plano de desenvolvimento**: tasks atômicas priorizadas com critério de verificação |
| 9 | `technical-writer` + `mermaid-studio` | Documentação inicial + diagramas |

> O `tlc-spec-driven` aparece **duas vezes de propósito**: na etapa 2 formaliza os *requisitos* (o "o quê"); na etapa 8 consolida as decisões técnicas em *tasks executáveis* (o "como" e em que ordem). As etapas 3-7 são o miolo técnico entre as duas passadas — não gere tasks antes de saber schema e contratos, senão o plano nasce furado.

### Profundidade

| Etapa | MVP enxuto | Produto pra validar/escalar |
|---|---|---|
| 1. Desafiar | Pular ou rápido | `the-fool` obrigatório nas premissas-chave |
| 2. Especificar | Specify leve | Specify completo com rastreabilidade |
| 3. Arquitetar | Só decisão de stack | Arquitetura + boundaries documentados |
| 4. Registrar (ADR) | Pular | 1 ADR por decisão estrutural |
| 5. Modelar dados | Schema no código direto | Modelagem formal + ERD |
| 6. Contratos | Emergem no código | OpenAPI antes de implementar |
| 7. Testes | Estratégia mental | Estratégia formal por camada |
| 8. Plano de dev | 5-10 tasks | `tlc-spec-driven` completo |
| 9. Documentar | README | + design doc + diagramas |

**Atalho MVP:** rode só `1 → 2 → 3 → 8`.

**Sistema com agentes de IA** (ex: BHEN): encaixe `agent-engineer` dentro da etapa 3 — ele decide tools, memory/RAG, orquestração e guardrails, que viram input pra arquitetura (3) e pro data model (5).

---

## Fluxo de Projeto Existente

Para quando já existe código rodando e você quer entender, auditar e melhorar.

### O Fluxo

```
ENTENDER → AUDITAR → DESAFIAR → PLANEJAR → CORRIGIR → TESTAR → DOCUMENTAR → DEPLOY → MONITORAR
```

```
                    ┌──────────────┐
                    │  1. ENTENDER │
                    │   codenavi   │
                    │   architect  │
                    └──────┬───────┘
                           ↓
              ┌────────────────────────┐
              │      2. AUDITAR        │
              │  code-reviewer (x3)    │
              │  security-best-pract.  │
              │  database-expert       │
              └────────────┬───────────┘
                           ↓
                    ┌──────────────┐
                    │  3. DESAFIAR │
                    │   the-fool   │
                    └──────┬───────┘
                           ↓
                    ┌──────────────┐
                    │  4. PLANEJAR │
                    │ tlc-spec-drv │
                    └──────┬───────┘
                           ↓
              ┌────────────────────────┐
              │      5. CORRIGIR       │
              │  laravel-expert (api)  │
              │  frontend-expert (web) │
              │  react-native (mobile) │
              │  api-designer          │
              │  database-expert       │
              └────────────┬───────────┘
                           ↓
              ┌────────────────────────┐
              │       6. TESTAR        │
              │  testing-strategist    │
              │  laravel/frontend/rn   │
              └────────────┬───────────┘
                           ↓
              ┌────────────────────────┐
              │     7. DOCUMENTAR      │
              │  technical-writer      │
              │  create-adr            │
              │  mermaid-studio        │
              └────────────┬───────────┘
                           ↓
              ┌────────────────────────┐
              │       8. DEPLOY        │
              │  infra-specialist      │
              │  devops-engineer       │
              └────────────┬───────────┘
                           ↓
                    ┌──────────────┐
                    │ 9. MONITORAR │
                    │   devops     │
                    └──────────────┘
```

---

## Profundidade por Estagio

| Phase | MVP (2-4 semanas) | Validado (tem users) | Producao (escala) |
|---|---|---|---|
| **1. Entender** | `codenavi` rapido | `codenavi` + `software-architect` | Audit completo com architect |
| **2. Auditar** | `code-reviewer` so critical | + `security` + `database-expert` | Todas as auditorias |
| **3. Desafiar** | Pular | `the-fool` nos pontos criticos | `the-fool` obrigatorio |
| **4. Planejar** | Lista mental ou 5 tasks | `tlc-spec-driven` com tasks | `tlc-spec-driven` completo |
| **5. Corrigir** | So bugs e seguranca | Bugs + performance + design | Tudo |
| **6. Testar** | Testes manuais + happy path | Feature tests nos fluxos criticos | Suite completa + load test |
| **7. Documentar** | README com quick start | + API docs + ADRs | + runbooks + onboarding |
| **8. Deploy** | PaaS (Railway/Render) | Docker + VPS + Cloudflare | Infra completa + CI/CD |
| **9. Monitorar** | Sentry free | + health checks + backups | + Grafana + alertas + DR |

---

## Phase 1: ENTENDER

Antes de mexer em qualquer coisa, entender o que existe.

### Explorar a codebase

```
/codenavi

"Investiga o projeto atual. Quero entender:
- Estrutura de pastas e organizacao do codigo
- Quais os endpoints da API e como se conectam
- Como esta a autenticacao
- Quais models existem e seus relacionamentos
- Quais as dependencias principais
Monta um notebook com suas descobertas."
```

### Validar arquitetura

```
/software-architect

"Analisa a arquitetura atual do projeto e me diz:
- A separacao entre camadas esta bem feita?
- As tecnologias escolhidas fazem sentido pro caso?
- Tem algo que deveria ser diferente na estrutura?"
```

**MVP:** Faca so o codenavi rapido.
**Validado/Producao:** Ambos.

---

## Phase 2: AUDITAR

Rode em sequencia: API, depois Web, depois Mobile.

### 2.1 Code Review geral

```
/code-reviewer

"Revisao completa da API. Foque em:
- [BUG] Erros de logica, null handling, edge cases
- [SEC] Vulnerabilidades (SQL injection, XSS, auth bypass, mass assignment)
- [PERF] N+1 queries, queries sem paginacao, falta de cache
- [DESIGN] Code smells, acoplamento, responsabilidades misturadas
Resultado categorizado por severidade."
```

### 2.2 Seguranca

```
/security-best-practices

"Auditoria de seguranca da API.
Verifica: autenticacao, autorizacao, input validation,
CORS, rate limiting, headers de seguranca, secrets expostos."
```

### 2.3 Banco de dados

```
/database-expert

"Analisa as migrations e models:
- Foreign keys estao corretas?
- Faltam indices pra queries frequentes?
- Colunas nullable que deveriam ser NOT NULL?
- Relacoes modeladas corretamente?
- EXPLAIN nas queries mais pesadas."
```

### 2.4 API Design

```
/api-designer

"Revisa os contratos da API:
- Endpoints seguem convencoes REST?
- Respostas tem envelope padrao { data, meta }?
- Erros sao consistentes?
- Paginacao esta implementada em todas as listas?"
```

### 2.5 Frontend / Mobile

```
/code-reviewer

"Revisa o frontend React:
- TypeScript strict, sem 'any'?
- Server state no TanStack Query (nao em useState)?
- Componentes desacoplados?
- Acessibilidade basica?
- Performance (lazy loading, code splitting)?"
```

**MVP:** So o 2.1 (code review) focando em [BUG] e [SEC].
**Validado:** 2.1 + 2.2 + 2.3.
**Producao:** Todos.

---

## Phase 3: DESAFIAR

Pega os achados da auditoria e desafia as decisoes.

```
/the-fool

"A auditoria encontrou [lista de problemas].
As decisoes arquiteturais sao [lista de decisoes].
Roda um pre-mortem: o que pode dar errado?
Stress-test as decisoes. Algo que deveriamos mudar?"
```

**MVP:** Pular — nao vale o tempo.
**Validado:** Nos pontos criticos.
**Producao:** Obrigatorio.

---

## Phase 4: PLANEJAR

Organiza os achados em tasks priorizadas.

```
/tlc-spec-driven

"A auditoria encontrou estes problemas:

CRITICOS (bloqueia producao):
- [lista]

IMPORTANTES (melhorar antes do launch):
- [lista]

NICE-TO-HAVE:
- [lista]

Cria plano de execucao com tasks atomicas, priorizadas por impacto."
```

**MVP:** Lista mental ou 5 tasks simples.
**Validado/Producao:** tlc-spec-driven completo.

---

## Phase 5: CORRIGIR

Executa cada task usando a skill especializada.

### API (Laravel)

```
/laravel-expert
"Corrige o N+1 no endpoint GET /api/orders.
Precisa de eager loading com with('user', 'items')."
```

### API (Go)

```
/go-expert
"Implementa rate limiting no middleware HTTP.
Usa token bucket com sync.Map por IP."
```

### Frontend (React/Vue)

```
/frontend-expert
"Migra o state de usuarios de useState para TanStack Query.
Endpoint: GET /api/users com paginacao cursor."
```

### Mobile (React Native)

```
/react-native-expert
"A lista de produtos usa ScrollView com .map().
Migra para LegendList com estimatedItemSize."
```

### Banco de dados

```
/database-expert
"Cria indices para as queries mais frequentes
e corrige as migrations que faltam foreign keys."
```

### Refatoracao

```
/refactoring-expert
"O UserController tem 500 linhas. Precisa extrair
a logica de negocios para um UserService.
Faz com seguranca — sem quebrar nada."
```

---

## Phase 6: TESTAR

### Definir estrategia

```
/testing-strategist
"Projeto [stack]. Ainda nao tem testes.
O que testar primeiro? Que tipo de teste por camada?
Cobertura minima aceitavel pro launch?"
```

### Implementar testes

```
/laravel-expert
"Cria feature tests com Pest para os endpoints criticos:
- POST /api/auth/login
- GET /api/orders (paginacao)
- POST /api/orders (criacao)
Testa happy path, validacao, e autorizacao."
```

```
/frontend-expert
"Cria testes com Vitest + Testing Library para OrderList.
Testa: loading, dados, paginacao, empty state, erro."
```

**MVP:** Testes manuais + 3-5 tests nos fluxos criticos.
**Validado:** Feature tests em todos os fluxos criticos.
**Producao:** Suite completa + load testing.

### Verificar a UI entregue (opcional)

Quando a feature tem interface que importa (tela de cliente, fluxo relevante),
antes de considerar entregue:

```
/ui-verifier
"Tier standard. Verifica a tela de pedidos contra .specs/features/orders/spec.md
e o DESIGN.md. App em http://localhost:5173."
```

Verifica a UI **renderizada** contra o briefing/spec com evidencia observavel e
ate 2 ciclos de correcao. Nao substitui o `impeccable` (que julga a qualidade
visual, e e invocado por dentro dele). Nao rode para qualquer ajuste de CSS.

### Implementar com veredito baseado em evidencia (opcional, so Claude Code)

Quando a correcao ou a feature tem contrato fechado e errar sai caro (regressao,
auth, dados, concorrencia), use o Gauntlet em vez do expert direto:

```
/gauntlet
"Corrige o N+1 em GET /api/orders sem mudar o contrato da resposta.
AC1: uma query por pagina. INV1: paginacao e filtros continuam iguais (feature tests).
Gates: vendor/bin/pest tests/Feature/OrdersTest.php"
```

Ele triagem o risco (LIGHT/STANDARD/ELEVATED/CRITICAL), roda os gates
deterministicos primeiro, so chama critico independente quando o tier justifica
e para em `FIT_FOR_PURPOSE` ou num gate humano. PASS tecnico nao e aprovacao de
merge/deploy. Precisa de um work tree git. Para economizar cota numa unica
execucao: `/gauntlet <tarefa> models:economy` (volta ao padrao na proxima).
Nao serve para transformar briefing em produto — isso e a `pipeline-entrega`.

---

## Phase 7: DOCUMENTAR

### Documentacao do projeto

```
/technical-writer
"Cria documentacao do projeto:
1. README com quick start
2. Guia de onboarding pra novo dev
3. Documentacao dos endpoints da API"
```

### Decisoes arquiteturais

```
/create-adr
"Documenta a decisao de usar [tecnologia] para [proposito].
Contexto: [por que essa decisao foi tomada]."
```

### Diagramas

```
/mermaid-studio
"Cria diagrama C4 Context do sistema mostrando
todos os componentes e suas relacoes."
```

**MVP:** So README com quick start.
**Validado:** + API docs + ADRs.
**Producao:** + runbooks + onboarding.

---

## Phase 8: DEPLOY

### Infraestrutura

```
/infra-specialist
"Configura infra pro projeto:
- Stack: [listar]
- Budget: R$[X]/mes
- Preciso de HTTPS, Cloudflare, backup diario
Qual provider? Como configurar?"
```

### CI/CD e containers

```
/devops-engineer
"Cria setup Docker pra producao:
- Dockerfiles por servico
- Docker Compose completo
- GitHub Actions (test + lint + build + deploy)"
```

**MVP:** PaaS direto (Railway, Render, Vercel).
**Validado:** Docker + VPS + Cloudflare.
**Producao:** Infra completa + CI/CD + blue-green deploy.

---

## Phase 9: MONITORAR

```
/devops-engineer
"Configura monitoring pra producao:
- Sentry pra erros
- Health check endpoint
- Backup automatizado do banco
- Alertas se o site cair"
```

**MVP:** Sentry free tier.
**Validado:** + health checks + backups automatizados.
**Producao:** + Grafana + alertas + disaster recovery plan.

---

## Regra de Ouro

> Quanto mais users dependem do sistema, mais phases voce roda e mais fundo vai em cada uma.

Um MVP pode passar pelas 9 phases em **1 dia**.
Um produto validado leva **1-2 semanas**.
Uma preparacao pra producao leva **2-4 semanas**.

O fluxo e um framework — adapte a profundidade ao seu contexto.
