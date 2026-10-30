# Agent Architecture

Patterns for structuring autonomous AI agent systems. Each pattern includes when to use it, trade-offs, real-world examples from production systems (BHEN, Aurelia OS), and anti-patterns. Language-agnostic — examples in Python and pseudocode.

---

## Table of Contents

1. [Agent vs Pipeline Decision Framework](#1-agent-vs-pipeline-decision-framework)
2. [Single Agent Pattern](#2-single-agent-pattern)
3. [Specialist Swarm Pattern](#3-specialist-swarm-pattern)
4. [Supervisor/CEO Pattern](#4-supervisorceo-pattern)
5. [Hierarchical Pattern](#5-hierarchical-pattern)
6. [Router Pattern](#6-router-pattern)
7. [Pipeline Pattern](#7-pipeline-pattern)
8. [Agent-as-Microservice Pattern](#8-agent-as-microservice-pattern)
9. [Pattern Comparison Table](#9-pattern-comparison-table)
10. [Agent Definition Format](#10-agent-definition-format)
11. [Agent Lifecycle](#11-agent-lifecycle)
12. [Anti-Patterns](#12-anti-patterns)

---

## 1. Agent vs Pipeline Decision Framework

Not every problem needs an agent. Many tasks are better served by deterministic pipelines. An agent adds value when the task requires **dynamic decision-making** — when the next step depends on intermediate results the system can't predict at design time.

### Decision Matrix

| Signal | Use a Pipeline | Use an Agent |
|--------|---------------|--------------|
| Steps are known at design time | Yes | — |
| Output of step N determines what step N+1 is | — | Yes |
| Error recovery requires judgment | — | Yes |
| Task is the same every time | Yes | — |
| Task requires tool selection based on context | — | Yes |
| Latency is critical (< 1s) | Yes | — |
| Cost per execution matters a lot | Yes | — |
| Human can't enumerate all branches | — | Yes |

### Decision Flowchart

```
Can you write an if/else tree that covers all cases?
  ├─ YES → Pipeline. Don't pay for LLM intelligence you don't need.
  └─ NO → Does the task require selecting from > 3 tools based on context?
            ├─ YES → Agent.
            └─ NO → Does it require multi-step reasoning where step N+1
                     depends on the result of step N?
                      ├─ YES → Agent.
                      └─ NO → Pipeline with an LLM call at the decision point.
```

### WRONG: Using an agent for a deterministic task

```python
# WRONG: Agent for a fixed ETL pipeline
agent = Agent(
    instructions="Extract data from CSV, transform dates, load to Postgres",
    tools=[read_csv, transform_dates, insert_postgres],
)
result = agent.run("Process today's data")  # $0.05/run, 8 seconds

# CORRECT: Deterministic pipeline
def etl_pipeline(date: str):
    data = read_csv(f"data/{date}.csv")        # Step 1: always the same
    transformed = transform_dates(data)         # Step 2: always the same
    insert_postgres(transformed)                # Step 3: always the same
# $0.00/run, 200ms
```

### CORRECT: Using an agent when the path is dynamic

```python
# CORRECT: Agent for customer support — can't predict what the customer needs
agent = Agent(
    instructions="Help the customer resolve their issue. Use tools to look up "
                 "their account, check order status, initiate refunds, or escalate.",
    tools=[lookup_account, check_order, initiate_refund, escalate_to_human],
)
# The agent decides which tools to call based on the conversation
result = agent.run(customer_message)
```

---

## 2. Single Agent Pattern

One agent with a set of tools. The simplest architecture. Start here.

```
User → [Agent + Tools] → Response
```

### When to Use

- The task domain is focused (one area of expertise)
- You need fewer than ~10 tools
- There's no need for different "roles" or perspectives
- You're prototyping or the task is low-stakes

### Implementation

```python
class Agent:
    def __init__(self, instructions: str, tools: list, model: str):
        self.instructions = instructions
        self.tools = tools
        self.model = model

    def run(self, user_message: str, context: dict = None) -> str:
        messages = [{"role": "system", "content": self.instructions}]
        if context:
            messages.append({"role": "system", "content": format_context(context)})
        messages.append({"role": "user", "content": user_message})

        while True:
            response = llm_call(self.model, messages, tools=self.tools)

            if response.has_tool_calls:
                for call in response.tool_calls:
                    result = self.execute_tool(call)
                    messages.append(tool_result_message(call.id, result))
            else:
                return response.content

    def execute_tool(self, call) -> str:
        tool = self.find_tool(call.name)
        validated_args = tool.validate(call.arguments)
        return tool.execute(**validated_args)
```

### Trade-offs

| Advantage | Disadvantage |
|-----------|-------------|
| Simple to build and debug | Instructions get long as scope grows |
| Low latency (one LLM, no routing) | Tool confusion when > 10 tools |
| Easy to test | No specialization — jack of all trades |
| Lowest cost per interaction | Hard to scale to multiple domains |

### When to Upgrade

Move to a multi-agent pattern when:
- The instructions exceed ~2000 tokens and cover distinct domains
- The agent confuses which tool to use (e.g., calling `search_products` when it should call `search_docs`)
- You need different model tiers for different sub-tasks

---

## 3. Specialist Swarm Pattern

Multiple agents, each with a focused set of tools and instructions. No central coordinator — agents hand off to each other directly.

```
User → [Agent A] ←→ [Agent B] ←→ [Agent C]
          ↕              ↕              ↕
       [Tools A]      [Tools B]      [Tools C]
```

### Real-World: BHEN (17 Specialist Agents)

BHEN runs 17 specialized agents in production:

```python
# Each agent has a focused domain and restricted tool set
AGENTS = {
    "sales_agent": Agent(
        instructions="You handle sales inquiries. Check product availability, "
                     "calculate prices, generate quotes.",
        tools=[search_products, check_stock, calculate_price, generate_quote],
        model="claude-sonnet",
    ),
    "support_agent": Agent(
        instructions="You handle customer support. Look up orders, check status, "
                     "process returns, escalate complex issues.",
        tools=[lookup_order, check_status, process_return, escalate],
        model="claude-sonnet",
    ),
    "analytics_agent": Agent(
        instructions="You answer data questions. Query the database (SELECT only), "
                     "generate charts, export reports.",
        tools=[query_db_readonly, generate_chart, export_csv],
        model="claude-sonnet",
    ),
    # ... 14 more specialists
}
```

### When to Use

- Tasks fall into distinct categories with little overlap
- Different tasks need different tool sets
- You want to limit each agent's blast radius (security)
- Teams can develop agents independently

### Handoff Mechanism

Agents need a way to transfer control:

```python
# Handoff tool — available to every agent
def transfer_to_agent(agent_name: str, context: str) -> str:
    """Transfer conversation to another specialist agent.

    Args:
        agent_name: Name of the target agent (e.g., "sales_agent")
        context: Summary of what was discussed and what the user needs
    """
    if agent_name not in AGENTS:
        return f"Unknown agent: {agent_name}. Available: {list(AGENTS.keys())}"
    target = AGENTS[agent_name]
    return target.run(context)
```

### WRONG: Agents that can hand off to anyone

```python
# WRONG: Every agent can transfer to every other agent — spaghetti
sales_agent.tools = [transfer_to_support, transfer_to_analytics,
                     transfer_to_billing, transfer_to_shipping,
                     transfer_to_marketing, ...]  # N^2 complexity

# CORRECT: Agents can only hand off to related specialists
sales_agent.tools = [transfer_to_support, transfer_to_billing]  # only 2
support_agent.tools = [transfer_to_sales, transfer_to_shipping]  # only 2
```

### Trade-offs

| Advantage | Disadvantage |
|-----------|-------------|
| Each agent is simple and focused | Handoff logic can get complex |
| Easy to add/remove agents | No global oversight of the conversation |
| Limited blast radius per agent | User may bounce between agents |
| Parallel development by teams | Hard to maintain conversation context across handoffs |

---

## 4. Supervisor/CEO Pattern

A central orchestrator agent that decomposes tasks and delegates to specialist agents. The supervisor sees the full picture; specialists see only their piece.

```
User → [Supervisor/CEO Agent]
            ├── delegate → [Agent A] → result
            ├── delegate → [Agent B] → result
            └── delegate → [Agent C] → result
       [Supervisor synthesizes results] → Response
```

### Real-World: BHEN CEO Agent (5-Step Pipeline)

BHEN's CEO Agent receives complex tasks and orchestrates a 5-step pipeline:

```python
class CEOAgent:
    """Orchestrator that decomposes tasks and delegates to specialists."""

    def __init__(self):
        self.model = "claude-opus"  # Needs strong reasoning for decomposition
        self.specialists = load_specialist_registry()

    def run(self, task: str) -> str:
        # Step 1: Research — gather context
        research = self.delegate("research_agent", f"Research: {task}")

        # Step 2: PRD — define requirements from research
        prd = self.delegate("prd_agent", f"Create PRD based on: {research}")

        # Step 3: Architecture — design solution from PRD
        arch = self.delegate("architect_agent", f"Design architecture for: {prd}")

        # Step 4: Implementation — build from architecture
        code = self.delegate("dev_agent", f"Implement based on: {arch}")

        # Step 5: Review — validate against requirements
        review = self.delegate("review_agent",
                              f"Review {code} against requirements: {prd}")

        return self.synthesize(task, research, prd, arch, code, review)

    def delegate(self, agent_name: str, sub_task: str) -> str:
        agent = self.specialists[agent_name]
        return agent.run(sub_task)

    def synthesize(self, *results) -> str:
        """Combine all specialist outputs into a coherent response."""
        return llm_call(self.model, [
            {"role": "system", "content": "Synthesize specialist outputs."},
            {"role": "user", "content": format_results(results)},
        ])
```

### When to Use

- Complex tasks that require multiple perspectives or phases
- You need a global view of progress and quality
- Tasks benefit from decomposition (research → plan → execute → review)
- You want centralized cost control and logging

### WRONG: Supervisor that micromanages

```python
# WRONG: Supervisor calls specialists for trivial sub-tasks
supervisor_plan = [
    "Ask format_agent to capitalize the title",
    "Ask grammar_agent to check one sentence",
    "Ask format_agent to add a period",
]
# This should be ONE call to a single agent, not three

# CORRECT: Supervisor delegates meaningful chunks of work
supervisor_plan = [
    "Ask research_agent to gather market data for Q4",
    "Ask analyst_agent to identify trends in the data",
    "Ask writer_agent to draft the executive summary",
]
```

### Trade-offs

| Advantage | Disadvantage |
|-----------|-------------|
| Global oversight and quality control | Supervisor is a single point of failure |
| Clear decomposition of complex tasks | Higher latency (sequential delegation) |
| Centralized cost/token tracking | Supervisor model must be strong (expensive) |
| Easy to audit the full chain | Context loss between supervisor and specialists |

---

## 5. Hierarchical Pattern

Supervisors managing sub-supervisors. For large organizations or complex domains where a single supervisor can't hold all the context.

```
         [CEO Agent]
          /       \
   [VP Sales]   [VP Engineering]
    /     \        /      \
 [SDR]  [AE]  [Backend] [Frontend]
```

### When to Use

- More than ~8 specialist agents
- Clear organizational hierarchy in the domain
- Different sub-domains need different orchestration strategies
- Enterprise-scale systems with dozens of agents

### Implementation

```python
class HierarchicalOrchestrator:
    def __init__(self, name: str, sub_agents: dict, model: str):
        self.name = name
        self.sub_agents = sub_agents  # can be agents or other orchestrators
        self.model = model

    def run(self, task: str) -> str:
        plan = self.plan(task)
        results = {}
        for step in plan:
            agent = self.sub_agents[step.agent_name]
            results[step.agent_name] = agent.run(step.sub_task)
        return self.synthesize(results)

# Build the hierarchy bottom-up
backend_team = HierarchicalOrchestrator(
    name="backend_lead",
    sub_agents={"db_agent": db_agent, "api_agent": api_agent},
    model="claude-sonnet",
)
frontend_team = HierarchicalOrchestrator(
    name="frontend_lead",
    sub_agents={"ui_agent": ui_agent, "perf_agent": perf_agent},
    model="claude-sonnet",
)
cto = HierarchicalOrchestrator(
    name="cto",
    sub_agents={"backend": backend_team, "frontend": frontend_team},
    model="claude-opus",
)
```

### WRONG: Too many levels of hierarchy

```python
# WRONG: 5 levels deep — each level adds latency and loses context
CEO → VP → Director → Manager → Team Lead → Agent
# By the time the task reaches the agent, context is severely degraded

# CORRECT: Maximum 3 levels — CEO, team lead, specialist
CEO → Team Lead → Specialist
# Fewer hops = less context loss, lower latency, easier debugging
```

### Trade-offs

| Advantage | Disadvantage |
|-----------|-------------|
| Scales to dozens of agents | High complexity |
| Mirrors organizational structure | Deep hierarchies lose context |
| Each level has scoped oversight | Expensive (many LLM calls) |
| Sub-teams can be developed independently | Hard to debug across levels |

---

## 6. Router Pattern

Classify the user's intent, then route to the appropriate agent. No orchestration — just dispatch.

```
User → [Router] → classify intent
                    ├── "sales" → [Sales Agent] → Response
                    ├── "support" → [Support Agent] → Response
                    └── "analytics" → [Analytics Agent] → Response
```

### Real-World: Aurelia OS (LLM-Based Routing)

Aurelia OS uses an agent registry where each agent declares its capabilities. The router uses an LLM to match the user's request to the best agent:

```python
# Agent registry — each agent declares what it handles
AGENT_REGISTRY = [
    {
        "name": "code_review_agent",
        "description": "Reviews code for bugs, style, and performance issues",
        "triggers": ["review", "code quality", "pull request", "PR"],
        "model_tier": "sonnet",
    },
    {
        "name": "deploy_agent",
        "description": "Manages deployments to staging and production",
        "triggers": ["deploy", "release", "ship", "staging", "production"],
        "model_tier": "sonnet",
    },
    {
        "name": "research_agent",
        "description": "Researches topics, reads documentation, summarizes findings",
        "triggers": ["research", "find out", "look up", "what is"],
        "model_tier": "flash",
    },
]

class Router:
    def route(self, user_message: str) -> str:
        # Step 1: Try keyword match first (cheap, fast)
        for agent_def in AGENT_REGISTRY:
            if any(kw in user_message.lower() for kw in agent_def["triggers"]):
                return agent_def["name"]

        # Step 2: Fall back to LLM classification (more accurate, costs money)
        agent_descriptions = "\n".join(
            f"- {a['name']}: {a['description']}" for a in AGENT_REGISTRY
        )
        response = llm_call(
            model="gemini-flash",  # Cheapest model for routing
            messages=[{
                "role": "user",
                "content": f"Which agent should handle this request?\n\n"
                           f"Request: {user_message}\n\n"
                           f"Agents:\n{agent_descriptions}\n\n"
                           f"Reply with ONLY the agent name.",
            }],
        )
        return response.content.strip()
```

### Two-Tier Routing Strategy

```
User message
  │
  ├── Keyword/regex match? → Route directly (cost: $0, latency: <1ms)
  │
  ├── No match → LLM classification with cheapest model
  │              (cost: ~$0.001, latency: ~200ms)
  │
  └── Low confidence? → Ask user to clarify
```

### WRONG: Using an expensive model for routing

```python
# WRONG: Using Opus to decide which agent to call
route = llm_call("claude-opus", "Which agent handles: " + message)
# Cost: $0.10 per route decision. At 1000 requests/day = $100/day just for routing

# CORRECT: Use the cheapest model or no model at all
route = keyword_match(message) or llm_call("gemini-flash", classify_prompt)
# Cost: $0.001 per route decision (when LLM needed). $1/day at 1000 requests
```

### Trade-offs

| Advantage | Disadvantage |
|-----------|-------------|
| Very fast (one classification + one agent call) | Can't handle tasks that span multiple agents |
| Simple to add new agents (just register) | Misrouting sends user to wrong agent |
| Cheapest multi-agent pattern | No task decomposition |
| Easy to log and audit routing decisions | Router becomes a bottleneck |

---

## 7. Pipeline Pattern

Sequential stages where the output of one stage feeds the next. Each stage may be an agent or a deterministic function. Hybrid of pipeline and agent thinking.

```
Input → [Stage 1: Research] → [Stage 2: PRD] → [Stage 3: Architecture]
      → [Stage 4: Prototype] → [Stage 5: Review] → Output
```

### Real-World: BHEN CEO 5-Step Pipeline

```python
class AgentPipeline:
    """Sequential pipeline where each stage can be an agent or a function."""

    def __init__(self, stages: list):
        self.stages = stages

    def run(self, initial_input: str) -> dict:
        context = {"input": initial_input}
        results = {}

        for stage in self.stages:
            stage_input = stage.prepare_input(context, results)
            stage_output = stage.execute(stage_input)
            results[stage.name] = stage_output
            context["latest"] = stage_output

            # Gate: check if we should continue or abort
            if stage.gate and not stage.gate(stage_output):
                return {"status": "aborted", "stage": stage.name,
                        "reason": "Gate check failed", "results": results}

        return {"status": "complete", "results": results}

# Define the pipeline
pipeline = AgentPipeline(stages=[
    AgentStage(
        name="research",
        agent=research_agent,
        prepare_input=lambda ctx, res: f"Research: {ctx['input']}",
        gate=lambda output: len(output) > 100,  # Must produce real research
    ),
    AgentStage(
        name="prd",
        agent=prd_agent,
        prepare_input=lambda ctx, res: f"Write PRD based on:\n{res['research']}",
        gate=lambda output: "Requirements" in output,  # Must have requirements
    ),
    AgentStage(
        name="architecture",
        agent=architect_agent,
        prepare_input=lambda ctx, res: f"Design for:\n{res['prd']}",
    ),
    AgentStage(
        name="prototype",
        agent=dev_agent,
        prepare_input=lambda ctx, res:
            f"Implement:\n{res['architecture']}\nRequirements:\n{res['prd']}",
    ),
    AgentStage(
        name="review",
        agent=review_agent,
        prepare_input=lambda ctx, res:
            f"Review:\n{res['prototype']}\nAgainst:\n{res['prd']}",
    ),
])
```

### Gates Between Stages

Gates are checkpoints that decide whether to continue, retry, or abort:

```python
class Gate:
    @staticmethod
    def min_length(n: int):
        """Output must be at least n characters."""
        return lambda output: len(output) >= n

    @staticmethod
    def contains_keywords(keywords: list):
        """Output must contain all specified keywords."""
        return lambda output: all(kw in output for kw in keywords)

    @staticmethod
    def llm_quality_check(threshold: float = 0.7):
        """Use a cheap LLM to score output quality."""
        def check(output):
            score = llm_call("gemini-flash", [{
                "role": "user",
                "content": f"Rate this output 0-1 for completeness: {output[:500]}",
            }])
            return float(score.content) >= threshold
        return check
```

### Trade-offs

| Advantage | Disadvantage |
|-----------|-------------|
| Predictable execution order | Rigid — can't skip stages dynamically |
| Easy to add gates between stages | Sequential = high latency |
| Each stage is independently testable | Context grows with each stage |
| Clear audit trail | One bad stage poisons downstream |

---

## 8. Agent-as-Microservice Pattern

Each agent runs as a separate service with its own API, database, and deployment lifecycle. Communication via HTTP, gRPC, or message queues.

```
[API Gateway]
    ├── POST /agents/sales    → [Sales Agent Service]   → DB
    ├── POST /agents/support  → [Support Agent Service]  → DB
    └── POST /agents/analytics → [Analytics Agent Service] → DB
```

### Real-World: Aurelia OS (Go-Based Agent OS)

Aurelia OS runs each agent as a long-lived subprocess, communicating via NDJSON over stdio:

```python
# Pseudocode — Aurelia uses Go, but the pattern is language-agnostic

class AgentProcess:
    """Each agent runs as a separate OS process."""

    def __init__(self, agent_id: str, binary_path: str):
        self.agent_id = agent_id
        self.process = subprocess.Popen(
            [binary_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def send(self, message: dict) -> dict:
        """NDJSON multiplexing — one JSON object per line."""
        line = json.dumps(message) + "\n"
        self.process.stdin.write(line.encode())
        self.process.stdin.flush()
        response_line = self.process.stdout.readline()
        return json.loads(response_line)

# Agent registry manages long-lived processes
class AgentRegistry:
    def __init__(self):
        self.agents = {}

    def register(self, agent_id: str, binary_path: str):
        self.agents[agent_id] = AgentProcess(agent_id, binary_path)

    def dispatch(self, agent_id: str, task: dict) -> dict:
        return self.agents[agent_id].send(task)
```

### When to Use

- Agents need independent scaling (one is called 100x more than others)
- Different agents need different runtimes (Python for ML, Go for speed)
- Teams own different agents and deploy independently
- You need fault isolation (one agent crashing shouldn't kill others)

### WRONG: Microservices for 3 agents

```python
# WRONG: 3 agents, each with its own Docker container, database, CI/CD pipeline
# Operational overhead: 3 Dockerfiles, 3 databases, 3 deployments, 3 log streams
# For 3 agents, this is overkill

# CORRECT: Start monolithic, extract when you have a reason
# Put all agents in one process, share one database
# Extract to microservices when: one agent needs different scaling,
# teams need independent deployment, or fault isolation is required
```

### Trade-offs

| Advantage | Disadvantage |
|-----------|-------------|
| Independent scaling per agent | High operational complexity |
| Fault isolation | Network latency between agents |
| Polyglot (each agent in best language) | Distributed tracing needed |
| Independent deployment | More infrastructure to manage |

---

## 9. Pattern Comparison Table

| Pattern | Agents | Complexity | Latency | Cost/Request | Best For |
|---------|--------|-----------|---------|-------------|----------|
| **Single Agent** | 1 | Low | Low | $ | Prototypes, focused tasks |
| **Specialist Swarm** | 3-20 | Medium | Low-Med | $$ | Multi-domain with handoffs |
| **Supervisor/CEO** | 3-10 | Medium | High | $$$ | Complex decomposition tasks |
| **Hierarchical** | 10-50+ | High | Very High | $$$$ | Enterprise-scale systems |
| **Router** | 2-20 | Low | Low | $ | Intent-based dispatch |
| **Pipeline** | 3-8 | Low-Med | High | $$ | Sequential multi-phase tasks |
| **Microservice** | 3-50+ | Very High | Medium | $$ | Independent scaling/deployment |

### Decision Guide

```
How many distinct task types?
  ├── 1 → Single Agent
  ├── 2-5 → Do tasks span multiple types?
  │           ├── NO → Router
  │           └── YES → Supervisor/CEO
  ├── 5-15 → Are tasks sequential phases?
  │            ├── YES → Pipeline
  │            └── NO → Specialist Swarm
  └── 15+ → Do teams deploy independently?
              ├── YES → Microservice
              └── NO → Hierarchical
```

---

## 10. Agent Definition Format

Every agent — regardless of pattern — needs a consistent definition. This is the contract between the orchestration layer and the agent.

```python
@dataclass
class AgentDefinition:
    """Standard format for defining an agent."""

    # Identity
    name: str                          # Unique identifier (e.g., "sales_agent")
    description: str                   # What this agent does (for routing)
    version: str                       # Semver (e.g., "1.2.0")

    # Instructions
    system_prompt: str                 # The agent's core instructions
    constraints: list[str]             # Hard rules the agent must follow

    # Tools
    tools: list[ToolDefinition]        # What the agent can do
    max_tool_calls: int = 20           # Safety limit per invocation

    # Model
    model: str                         # Which LLM to use
    temperature: float = 0.0           # Determinism (0 = most deterministic)
    max_tokens: int = 4096             # Output limit

    # Cost controls
    max_input_tokens: int = 50_000     # Context limit
    max_cost_per_run: float = 0.50     # Dollar limit per invocation

    # Behavior
    can_handoff_to: list[str] = None   # Other agents this one can transfer to
    escalation_rules: list[str] = None # When to escalate to human
    retry_policy: RetryPolicy = None   # How to handle failures

# Example: BHEN sales agent definition
sales_agent = AgentDefinition(
    name="sales_agent",
    description="Handles sales inquiries, quotes, and product information",
    version="2.1.0",
    system_prompt="""You are a sales specialist. Help customers find products,
    check availability, and generate quotes. Be helpful but never invent
    product features or prices — always use the tools to look up real data.""",
    constraints=[
        "Never discuss competitor products",
        "Never offer discounts above 15% without escalation",
        "Never access customer financial data",
    ],
    tools=[search_products, check_stock, calculate_price, generate_quote],
    max_tool_calls=15,
    model="claude-sonnet",
    can_handoff_to=["support_agent", "billing_agent"],
    escalation_rules=[
        "Customer requests discount > 15%",
        "Customer threatens legal action",
        "Customer requests data deletion",
    ],
)
```

### Declarative Agent Registry (YAML/JSON)

For systems like Aurelia OS where agents are registered declaratively:

```yaml
# agents.yaml — agent registry
agents:
  - name: code_review_agent
    description: "Reviews code for bugs, style issues, and performance"
    model: claude-sonnet
    temperature: 0.0
    max_tool_calls: 10
    tools:
      - read_file
      - search_codebase
      - run_linter
      - run_tests
    constraints:
      - "Never modify files — read-only analysis only"
      - "Never execute arbitrary commands"
    triggers:
      - "review"
      - "code quality"
      - "pull request"
    schedule: null  # on-demand only

  - name: daily_report_agent
    description: "Generates daily project status reports"
    model: gemini-flash
    temperature: 0.3
    max_tool_calls: 5
    tools:
      - query_jira
      - query_github
      - send_slack
    schedule: "0 9 * * 1-5"  # Weekdays at 9am
```

---

## 11. Agent Lifecycle

Every agent invocation follows this lifecycle. Understanding it helps you instrument, debug, and optimize.

```
┌─────────────────────────────────────────────────────┐
│ 1. INIT                                             │
│    - Load agent definition                          │
│    - Initialize session (ID, cost tracker, logger)  │
│    - Load memory/context (RAG, conversation history)│
├─────────────────────────────────────────────────────┤
│ 2. PROMPT CONSTRUCTION                              │
│    - System prompt (agent instructions)             │
│    - Context injection (RAG results, memory)        │
│    - Conversation history (sliding window)          │
│    - User message                                   │
│    - Tool definitions                               │
├─────────────────────────────────────────────────────┤
│ 3. TOOL LOOP                                        │
│    ┌──────────────────────────────────────────┐     │
│    │ LLM generates response                   │     │
│    │   ├── Text only → EXIT LOOP              │     │
│    │   └── Tool call(s) →                     │     │
│    │       ├── Validate inputs                │     │
│    │       ├── Check permissions              │     │
│    │       ├── Execute tool                   │     │
│    │       ├── Log result                     │     │
│    │       ├── Check budget (tokens, cost)    │     │
│    │       └── Append result → LOOP           │     │
│    └──────────────────────────────────────────┘     │
├─────────────────────────────────────────────────────┤
│ 4. RESPONSE                                         │
│    - Final text from LLM                            │
│    - Post-processing (format, sanitize)             │
│    - Output validation (guardrails)                 │
├─────────────────────────────────────────────────────┤
│ 5. CLEANUP                                          │
│    - Save to memory (conversation, facts learned)   │
│    - Update cost tracker                            │
│    - Emit metrics (latency, tokens, tool calls)     │
│    - Close session                                  │
└─────────────────────────────────────────────────────┘
```

### Implementing the Tool Loop with Safety Limits

```python
class AgentRunner:
    def run(self, agent: AgentDefinition, messages: list) -> str:
        session = Session(agent)

        for iteration in range(agent.max_tool_calls + 1):
            response = llm_call(
                model=agent.model,
                messages=messages,
                tools=agent.tools,
                max_tokens=agent.max_tokens,
            )
            session.track_tokens(response.usage)

            # Exit condition: LLM returned text, no tool calls
            if not response.has_tool_calls:
                session.finalize()
                return response.content

            # Process tool calls
            for call in response.tool_calls:
                session.check_budget()  # Raises if exceeded
                result = self.safe_execute(agent, call)
                messages.append(tool_result(call.id, result))
                session.log_tool_call(call, result)

        # Safety: hit max iterations without completing
        session.finalize(status="max_iterations")
        return "I wasn't able to complete the task within the allowed steps."

    def safe_execute(self, agent: AgentDefinition, call) -> str:
        tool = find_tool(agent.tools, call.name)
        if tool is None:
            return f"Error: unknown tool '{call.name}'"
        try:
            validated = tool.validate_input(call.arguments)
            result = tool.execute(**validated)
            return tool.format_output(result)
        except ToolError as e:
            return f"Tool error: {e}"  # Returned to LLM for self-correction
        except Exception as e:
            log.error(f"Unexpected tool error: {e}", tool=call.name)
            return "Internal error executing tool. Try a different approach."
```

---

## 12. Anti-Patterns

### 12.1 God Agent

One agent with 30+ tools, 5000-token instructions, covering every domain.

```python
# WRONG: One agent to rule them all
god_agent = Agent(
    instructions="You handle sales, support, billing, analytics, marketing, "
                 "HR, legal, compliance, and infrastructure...",
    tools=[tool_1, tool_2, ..., tool_35],
    model="claude-opus",  # Needs the best model because the task is too broad
)
# Problems: tool confusion, high cost, impossible to test, no blast radius control

# CORRECT: Split by domain
sales_agent = Agent(instructions="...", tools=[...], model="claude-sonnet")
support_agent = Agent(instructions="...", tools=[...], model="claude-sonnet")
```

### 12.2 Chatty Agents

Agents that call each other excessively, ping-ponging back and forth.

```python
# WRONG: Agent A asks B, B asks A, A asks B... infinite loop
# A: "What's the customer's name?"
# B: "I don't know, let me ask A."
# A: "I asked you because I don't know."
# B: "Let me ask A again..."

# CORRECT: Pass sufficient context at handoff time
agent_a.transfer_to(agent_b, context={
    "customer_id": "C123",
    "customer_name": "João Silva",  # Include what you already know
    "issue": "Refund request for order #456",
    "attempted_solutions": ["Checked order status — delivered"],
})
```

### 12.3 No Exit Condition

Agents that loop forever because there's no stop signal.

```python
# WRONG: Agent will retry forever
while True:
    result = agent.run(task)
    if is_satisfactory(result):
        break
    # What if it's never satisfactory? Infinite loop, infinite cost.

# CORRECT: Bounded retries with escalation
MAX_RETRIES = 3
for attempt in range(MAX_RETRIES):
    result = agent.run(task)
    if is_satisfactory(result):
        return result
    task = f"Previous attempt was unsatisfactory. Issues: {evaluate(result)}. Retry."
return escalate_to_human(task, attempts=MAX_RETRIES)
```

### 12.4 Recursive Agent Calls Without Depth Limit

```python
# WRONG: Agent A calls Agent B which calls Agent A which calls...
def agent_a_run(task):
    result = agent_b.run(f"Help with: {task}")  # B might call A again
    return result

# CORRECT: Track and limit depth
def agent_run(task: str, depth: int = 0, max_depth: int = 3):
    if depth >= max_depth:
        return "Maximum delegation depth reached. Completing with available info."
    # ... agent logic ...
    sub_result = agent_run(sub_task, depth=depth + 1, max_depth=max_depth)
```

### 12.5 Ignoring Cost

```python
# WRONG: Every sub-task uses Opus
for sub_task in decomposed_tasks:
    result = llm_call("claude-opus", sub_task)  # $0.10 each
# 20 sub-tasks = $2.00 per user request

# CORRECT: Use the cheapest model that works for each sub-task
for sub_task in decomposed_tasks:
    model = select_model(sub_task.complexity)  # Flash: $0.001, Sonnet: $0.01
    result = llm_call(model, sub_task)
# 20 sub-tasks = ~$0.10 per user request
```

### 12.6 No Observability

```python
# WRONG: Agent runs as a black box
result = agent.run(task)
# If result is wrong: WHY? Which tool failed? What did the LLM decide?
# You'll never know.

# CORRECT: Log every decision and tool call
result = agent.run(task)
# Logs show:
# [13:45:01] Agent 'sales' started, task: "Find product X"
# [13:45:02] Tool call: search_products(query="X") → 3 results
# [13:45:03] Tool call: check_stock(product_id="P1") → in_stock=True
# [13:45:04] Agent 'sales' completed, 2 tool calls, 1,247 tokens, $0.012
```

### 12.7 Agents Without Constraints

```python
# WRONG: Agent with no boundaries
agent = Agent(
    instructions="Help the user with anything they need.",
    tools=[execute_sql, delete_file, send_email, run_command],
)
# This agent can drop tables, delete files, send spam, and run rm -rf /

# CORRECT: Explicit constraints and limited tools
agent = Agent(
    instructions="Help the user check order status. You can only read "
                 "order data — you cannot modify anything.",
    tools=[query_orders_readonly],
    constraints=[
        "SELECT queries only",
        "Only access 'orders' and 'order_items' tables",
        "Never reveal customer payment details",
    ],
)
```

---

## Summary: Start Simple, Grow Deliberately

1. **Start with a Single Agent.** Get it working, test it, understand its limits.
2. **Add a Router** when you have 2-3 distinct task types.
3. **Split into Specialists** when one agent's instructions get too long or it confuses tools.
4. **Add a Supervisor** when tasks require decomposition and multi-step planning.
5. **Go Hierarchical** only when you have 10+ agents and clear organizational structure.
6. **Extract to Microservices** only when you need independent scaling or deployment.

Every architectural upgrade adds complexity. Don't jump to a Hierarchical Microservice Swarm because it sounds impressive. The best architecture is the simplest one that meets your current requirements — with a clear path to evolve when those requirements change.
