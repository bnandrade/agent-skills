# Orchestration Patterns

Patterns for routing requests, managing LLM tiers, coordinating agents, and handling async execution. Informed by BHEN (multi-tier LLM routing, JWT-scoped agents) and Aurelia OS (NDJSON multiplexing, cron scheduler, goroutine-based fire-and-forget).

---

## Table of Contents

1. [Request Routing](#1-request-routing)
2. [LLM Tier Management](#2-llm-tier-management)
3. [Agent Handoff Patterns](#3-agent-handoff-patterns)
4. [Streaming and Async](#4-streaming-and-async)
5. [Session Management](#5-session-management)
6. [Multi-Channel Orchestration](#6-multi-channel-orchestration)
7. [Cron and Scheduled Agents](#7-cron-and-scheduled-agents)
8. [Anti-Patterns](#8-anti-patterns)

---

## 1. Request Routing

The router decides which agent handles each request. Three strategies, from cheapest to most flexible.

### 1.1 Keyword/Prefix Matching (Deterministic)

Zero LLM cost, zero latency. Use when intents map cleanly to keywords. Aurelia uses this as the first routing layer.

```python
from dataclasses import dataclass

@dataclass
class Route:
    agent_id: str
    keywords: list[str]
    prefixes: list[str]

ROUTES = [
    Route(
        agent_id="sales-agent",
        keywords=["pricing", "quote", "discount", "plan"],
        prefixes=["/sales", "/pricing"],
    ),
    Route(
        agent_id="support-agent",
        keywords=["bug", "error", "not working", "help", "broken"],
        prefixes=["/support", "/help"],
    ),
    Route(
        agent_id="analytics-agent",
        keywords=["report", "metrics", "dashboard", "stats"],
        prefixes=["/analytics", "/report"],
    ),
]

def route_by_keyword(message: str) -> str | None:
    """Fast, deterministic routing. Returns agent_id or None."""
    normalized = message.lower().strip()

    # Check prefixes first (explicit intent)
    for route in ROUTES:
        for prefix in route.prefixes:
            if normalized.startswith(prefix):
                return route.agent_id

    # Check keywords (implicit intent)
    for route in ROUTES:
        for keyword in route.keywords:
            if keyword in normalized:
                return route.agent_id

    return None  # no match — fall through to LLM router
```

### 1.2 LLM-Based Classification (Flexible)

Handles ambiguous inputs, new intents, multi-language. More expensive ($0.001-0.01 per routing decision). Use the cheapest model that works.

```python
ROUTER_PROMPT = """You are a request router. Classify the user's message into one agent.

Available agents:
- sales-agent: pricing questions, quotes, plan comparisons, discounts
- support-agent: bug reports, errors, feature requests, account issues
- analytics-agent: reports, metrics, data questions, dashboards
- general-agent: everything else (greetings, casual, off-topic)

Examples:
User: "How much does the pro plan cost?" → sales-agent
User: "My dashboard is showing wrong numbers" → support-agent
User: "Can I get a CSV of last month's revenue?" → analytics-agent
User: "Hello!" → general-agent
User: "The billing page crashed when I tried to upgrade" → support-agent
User: "I need a report on Q3 sales with discount impact" → analytics-agent

User: "{message}"

Respond with ONLY the agent name, nothing else."""

async def route_by_llm(
    message: str,
    llm_client,
    valid_agents: set[str],
) -> str:
    """LLM-based routing. Use a cheap/fast model."""
    response = await llm_client.generate(
        model="gemini-2.5-flash",  # cheapest model for routing
        messages=[{"role": "user", "content": ROUTER_PROMPT.format(message=message)}],
        max_tokens=50,
        temperature=0,  # deterministic
    )
    agent_id = response.text.strip().lower()
    if agent_id not in valid_agents:
        return "general-agent"  # fallback for invalid responses
    return agent_id
```

### 1.3 Hybrid Routing (Keyword First, LLM Fallback)

Best of both worlds. Deterministic when possible, intelligent when needed. This is the recommended pattern.

```python
async def route_request(
    message: str,
    llm_client,
    valid_agents: set[str],
) -> tuple[str, str]:
    """
    Hybrid router: keyword → LLM → default.
    Returns (agent_id, routing_method).
    """
    # Layer 1: keyword match (free, instant)
    agent_id = route_by_keyword(message)
    if agent_id:
        return agent_id, "keyword"

    # Layer 2: LLM classification (~$0.001, ~200ms)
    try:
        agent_id = await route_by_llm(message, llm_client, valid_agents)
        return agent_id, "llm"
    except Exception as e:
        log_routing_error(e)

    # Layer 3: default fallback (free, instant)
    return "general-agent", "default"
```

### 1.4 Router Prompt Design

A good router prompt has: agent descriptions, few-shot examples, structured output, and edge case handling.

```python
# WRONG: vague router prompt
ROUTER_PROMPT = "Route this message to the right agent: {message}"

# WRONG: too many agents without clear boundaries
ROUTER_PROMPT = """Route to one of 15 agents: agent-1, agent-2, ..., agent-15
Message: {message}"""

# CORRECT: clear descriptions, examples, structured output
ROUTER_PROMPT = """Classify the user's intent and route to the correct agent.

## Agents

| Agent | Handles | Does NOT handle |
|-------|---------|-----------------|
| sales-agent | Pricing, quotes, plans, discounts | Bug reports, data requests |
| support-agent | Bugs, errors, account issues, feature requests | Pricing, reports |
| analytics-agent | Reports, metrics, data exports | Account issues, pricing |
| general-agent | Greetings, off-topic, unclear intent | Anything specific above |

## Examples

User: "What's the enterprise pricing?" → {"agent": "sales-agent", "confidence": 0.95}
User: "My login is broken" → {"agent": "support-agent", "confidence": 0.9}
User: "Export Q3 revenue" → {"agent": "analytics-agent", "confidence": 0.85}
User: "Hi there" → {"agent": "general-agent", "confidence": 0.99}
User: "The billing page crashed when I tried to see pricing" → {"agent": "support-agent", "confidence": 0.7}

## Rules
- When in doubt between two agents, choose the one that handles the PRIMARY intent.
- If confidence < 0.5, route to general-agent.
- Respond with JSON only: {"agent": "...", "confidence": N.N}

## User Message
{message}"""
```

---

## 2. LLM Tier Management

Use the cheapest model that can handle the task. Reserve expensive models for complex reasoning. This is the single biggest cost optimization for agent systems.

### 2.1 Model Selection by Task Complexity (BHEN Pattern)

```python
from enum import Enum

class ModelTier(Enum):
    ROUTING = "routing"       # Intent classification, simple yes/no
    EXTRACTION = "extraction"  # Structured data extraction from text
    EXECUTION = "execution"    # Standard agent work, tool calling
    REASONING = "reasoning"    # Complex multi-step, ambiguous tasks

TIER_MODELS = {
    ModelTier.ROUTING: {
        "primary": "gemini-2.5-flash",
        "fallback": "gpt-4o-mini",
        "max_tokens": 100,
        "temperature": 0,
        "approx_cost_per_call": 0.001,
    },
    ModelTier.EXTRACTION: {
        "primary": "gemini-2.5-flash",
        "fallback": "gpt-4o-mini",
        "max_tokens": 500,
        "temperature": 0,
        "approx_cost_per_call": 0.002,
    },
    ModelTier.EXECUTION: {
        "primary": "claude-sonnet-5",
        "fallback": "gpt-4o",
        "max_tokens": 4096,
        "temperature": 0.3,
        "approx_cost_per_call": 0.02,
    },
    ModelTier.REASONING: {
        "primary": "claude-opus-4-8",
        "fallback": "claude-sonnet-5",  # degrade capability, not fail
        "max_tokens": 8192,
        "temperature": 0.5,
        "approx_cost_per_call": 0.15,
    },
}

def select_tier(task_type: str) -> ModelTier:
    """Map task type to model tier."""
    TASK_TIER_MAP = {
        "route_request": ModelTier.ROUTING,
        "classify_intent": ModelTier.ROUTING,
        "extract_entities": ModelTier.EXTRACTION,
        "parse_structured": ModelTier.EXTRACTION,
        "answer_question": ModelTier.EXECUTION,
        "call_tools": ModelTier.EXECUTION,
        "write_code": ModelTier.EXECUTION,
        "multi_step_reasoning": ModelTier.REASONING,
        "complex_analysis": ModelTier.REASONING,
        "ambiguous_decision": ModelTier.REASONING,
    }
    return TASK_TIER_MAP.get(task_type, ModelTier.EXECUTION)
```

### 2.2 Cost Tracking and Budget Enforcement

```python
class TierCostTracker:
    """Track costs by tier to identify optimization opportunities."""

    def __init__(self):
        self.tier_costs: dict[str, float] = {}
        self.tier_calls: dict[str, int] = {}

    def record(self, tier: ModelTier, cost: float):
        tier_name = tier.value
        self.tier_costs[tier_name] = self.tier_costs.get(tier_name, 0) + cost
        self.tier_calls[tier_name] = self.tier_calls.get(tier_name, 0) + 1

    def report(self) -> dict:
        """Cost breakdown by tier — use to find where money goes."""
        return {
            tier: {
                "total_cost": self.tier_costs.get(tier, 0),
                "call_count": self.tier_calls.get(tier, 0),
                "avg_cost": (
                    self.tier_costs.get(tier, 0) / self.tier_calls.get(tier, 1)
                ),
            }
            for tier in ["routing", "extraction", "execution", "reasoning"]
        }
    # Typical healthy distribution:
    #   routing: 60% of calls, 5% of cost
    #   extraction: 15% of calls, 5% of cost
    #   execution: 20% of calls, 40% of cost
    #   reasoning: 5% of calls, 50% of cost
    #
    # Red flag: if execution is >70% of cost, some tasks should be downtiered.
    # Red flag: if reasoning is >10% of calls, classification is too aggressive.
```

### 2.3 Provider Failover

```python
import asyncio
from dataclasses import dataclass

@dataclass
class ProviderConfig:
    name: str
    model: str
    timeout_seconds: float = 30.0
    max_retries: int = 2

class ProviderFailover:
    """Try providers in order. Fall through on failure. Degrade gracefully."""

    def __init__(self, providers: list[ProviderConfig]):
        self.providers = providers

    async def generate(self, messages: list[dict], **kwargs) -> dict:
        last_error = None

        for provider in self.providers:
            for attempt in range(provider.max_retries + 1):
                try:
                    response = await asyncio.wait_for(
                        self._call_provider(provider, messages, **kwargs),
                        timeout=provider.timeout_seconds,
                    )
                    return {
                        "response": response,
                        "provider": provider.name,
                        "model": provider.model,
                        "attempt": attempt + 1,
                    }
                except asyncio.TimeoutError:
                    last_error = f"{provider.name} timed out"
                    log_provider_timeout(provider.name, attempt)
                except Exception as e:
                    last_error = f"{provider.name}: {e}"
                    log_provider_error(provider.name, attempt, e)

        # All providers failed
        raise AllProvidersFailed(
            f"All providers exhausted. Last error: {last_error}"
        )

# Usage: BHEN-style failover chain
failover = ProviderFailover([
    ProviderConfig(name="anthropic", model="claude-sonnet-5", timeout_seconds=30),
    ProviderConfig(name="openai", model="gpt-4o", timeout_seconds=30),
    ProviderConfig(name="openai", model="gpt-4o-mini", timeout_seconds=15),
])
```

### 2.4 Model-Specific Prompt Optimization

Different models have different strengths. Optimize prompts per model.

```python
# WRONG: same prompt for all models
prompt = "Analyze this data and provide recommendations..."

# CORRECT: model-specific prompt variants
PROMPT_VARIANTS = {
    "claude-sonnet-5": {
        # Claude excels with XML-structured prompts and explicit instructions
        "template": """<task>
Analyze the following data and provide actionable recommendations.
</task>

<data>
{data}
</data>

<output-format>
Return a JSON object with:
- "summary": one-paragraph overview
- "recommendations": list of {"action": str, "priority": "high"|"medium"|"low", "reasoning": str}
</output-format>""",
    },
    "gpt-4o": {
        # GPT-4o works well with system/user separation and markdown
        "system": "You are a data analyst. Provide actionable recommendations.",
        "template": """## Data
{data}

## Required Output
JSON with `summary` and `recommendations` (action, priority, reasoning).
""",
    },
    "gemini-2.5-flash": {
        # Gemini Flash: keep it short, structured, and direct
        "template": """Analyze this data. Return JSON.
Data: {data}
Format: {{"summary": "...", "recommendations": [{{"action": "...", "priority": "high|medium|low"}}]}}""",
    },
}

def build_prompt(model: str, data: str) -> list[dict]:
    variant = PROMPT_VARIANTS.get(model, PROMPT_VARIANTS["claude-sonnet-5"])
    messages = []
    if "system" in variant:
        messages.append({"role": "system", "content": variant["system"]})
    messages.append({"role": "user", "content": variant["template"].format(data=data)})
    return messages
```

---

## 3. Agent Handoff Patterns

How agents coordinate: who does what, how results flow, how failures propagate.

### 3.1 Sequential Handoff (Pipeline)

Agent A produces output, Agent B uses it as input, Agent C finalizes.

```python
async def sequential_pipeline(
    user_request: str,
    agents: list,  # [research_agent, analysis_agent, writing_agent]
) -> str:
    """Each agent receives the previous agent's output."""
    context = user_request

    for agent in agents:
        try:
            result = await agent.process(context)
            context = result.output
            log_handoff(
                from_agent=agent.id if agent != agents[0] else "user",
                to_agent=agents[agents.index(agent) + 1].id
                    if agent != agents[-1] else "user",
                context_size=len(context),
            )
        except AgentError as e:
            # Pipeline broken — return partial result
            return f"Pipeline failed at {agent.id}: {e}\nPartial result: {context}"

    return context

# Example: research → analyze → write
result = await sequential_pipeline(
    "What are the latest trends in AI safety?",
    [research_agent, analysis_agent, writing_agent],
)
```

**When to use:** Linear workflows where each step depends on the previous. Data enrichment pipelines. Content generation (research → outline → draft → edit).

### 3.2 Parallel Fan-Out (Map-Reduce)

Multiple agents work simultaneously on different aspects. Results are merged.

```python
import asyncio

async def parallel_fanout(
    user_request: str,
    agents: list,
    merger_agent,
    timeout_seconds: float = 60.0,
) -> str:
    """Fan out to multiple agents, merge results."""
    # Fan out: all agents work in parallel
    tasks = [
        asyncio.create_task(agent.process(user_request))
        for agent in agents
    ]

    # Wait for all (or timeout)
    done, pending = await asyncio.wait(tasks, timeout=timeout_seconds)

    # Cancel timed-out tasks
    for task in pending:
        task.cancel()
        log_agent_timeout(task)

    # Collect results
    results = {}
    for task in done:
        try:
            result = task.result()
            results[result.agent_id] = result.output
        except Exception as e:
            log_agent_error(task, e)

    if not results:
        raise AllAgentsFailed("No agents produced results")

    # Merge: a supervisor agent synthesizes
    merge_prompt = (
        f"Original question: {user_request}\n\n"
        f"Agent results:\n"
        + "\n".join(
            f"--- {agent_id} ---\n{output}"
            for agent_id, output in results.items()
        )
        + "\n\nSynthesize these results into a single coherent answer."
    )
    return await merger_agent.process(merge_prompt)

# Example: multiple research agents each search different sources
result = await parallel_fanout(
    "Compare pricing of AWS, GCP, and Azure for our workload",
    [aws_agent, gcp_agent, azure_agent],
    merger_agent=comparison_agent,
)
```

**When to use:** Tasks that decompose into independent sub-tasks. Multi-source research. Comparative analysis.

### 3.3 Supervisor Delegation (CEO Pattern)

A supervisor agent decides what to delegate, to whom, and when to stop.

```python
SUPERVISOR_PROMPT = """You are a supervisor agent. You delegate tasks to specialized agents.

Available agents:
{agent_descriptions}

For the user's request, decide:
1. Which agent(s) to delegate to
2. What specific task to give each agent
3. Whether to run them sequentially or in parallel

Respond with JSON:
{{
  "plan": [
    {{"agent": "agent-id", "task": "specific task description", "depends_on": null | "step-N"}},
    ...
  ],
  "strategy": "sequential" | "parallel" | "mixed"
}}"""

async def supervisor_delegate(
    user_request: str,
    supervisor_llm,
    available_agents: dict[str, Agent],
) -> str:
    # Step 1: Supervisor creates a plan
    plan = await supervisor_llm.generate(
        SUPERVISOR_PROMPT.format(
            agent_descriptions=format_agent_descriptions(available_agents)
        ),
        user_message=user_request,
    )
    parsed_plan = parse_json(plan)

    # Step 2: Execute the plan
    results = {}
    for step in parsed_plan["plan"]:
        agent = available_agents[step["agent"]]
        task_input = step["task"]

        # Inject previous results if there's a dependency
        if step.get("depends_on"):
            dep_result = results.get(step["depends_on"], "")
            task_input = f"{task_input}\n\nContext from previous step:\n{dep_result}"

        result = await agent.process(task_input)
        results[f"step-{len(results)}"] = result.output

    # Step 3: Supervisor synthesizes
    synthesis_prompt = (
        f"Original request: {user_request}\n\n"
        f"Results:\n"
        + "\n".join(f"[{k}] {v}" for k, v in results.items())
        + "\n\nProvide the final answer."
    )
    return await supervisor_llm.generate(synthesis_prompt)
```

**When to use:** Complex requests that require judgment about decomposition. When the task structure isn't known in advance.

### 3.4 Escalation

Agent detects it cannot handle the request and escalates — to a more capable model, to a different agent, or to a human.

```python
class EscalationChain:
    """Try agent → better agent → human."""

    def __init__(self, chain: list[dict]):
        """
        chain: [
            {"handler": agent_basic, "type": "agent"},
            {"handler": agent_advanced, "type": "agent"},
            {"handler": human_queue, "type": "human"},
        ]
        """
        self.chain = chain

    async def handle(self, request: str, session) -> str:
        for i, level in enumerate(self.chain):
            handler = level["handler"]

            if level["type"] == "human":
                await handler.enqueue(request, session)
                return "This request has been escalated to a human specialist."

            try:
                result = await handler.process(request)

                # Check if the agent wants to escalate
                if result.wants_escalation:
                    log_escalation(
                        from_level=i,
                        to_level=i + 1,
                        reason=result.escalation_reason,
                    )
                    continue  # try next level

                return result.output

            except AgentError:
                log_escalation(from_level=i, to_level=i + 1, reason="error")
                continue

        return "Unable to process your request. A human will follow up."

# Usage
chain = EscalationChain([
    {"handler": basic_agent, "type": "agent"},       # Sonnet — handles 80% of requests
    {"handler": advanced_agent, "type": "agent"},     # Opus — handles complex cases
    {"handler": human_support_queue, "type": "human"},  # last resort
])
```

---

## 4. Streaming and Async

Agents can take seconds or minutes. Users need feedback. Systems need decoupling.

### 4.1 NDJSON Streaming (Aurelia Pattern)

Newline-Delimited JSON: one JSON object per line. Supports multiplexing — multiple concurrent requests over a single connection, routed by `request_id`.

```python
import json
import asyncio
from uuid import uuid4

# Protocol: each line is a complete JSON object
# {"request_id": "abc123", "type": "chunk", "data": "Hello"}
# {"request_id": "abc123", "type": "chunk", "data": " world"}
# {"request_id": "abc123", "type": "done", "data": null}
# {"request_id": "def456", "type": "chunk", "data": "Different request"}

class NDJSONMultiplexer:
    """Multiplex multiple agent requests over a single stream."""

    def __init__(self):
        self.pending: dict[str, asyncio.Queue] = {}

    def new_request(self) -> tuple[str, asyncio.Queue]:
        request_id = str(uuid4())
        queue = asyncio.Queue()
        self.pending[request_id] = queue
        return request_id, queue

    def route_message(self, line: str):
        """Route incoming NDJSON line to the correct request queue."""
        msg = json.loads(line)
        request_id = msg.get("request_id")
        if request_id in self.pending:
            self.pending[request_id].put_nowait(msg)
            if msg.get("type") == "done":
                del self.pending[request_id]

    async def stream_response(self, request_id: str, queue: asyncio.Queue):
        """Yield chunks for a specific request."""
        while True:
            msg = await asyncio.wait_for(queue.get(), timeout=60)
            if msg["type"] == "done":
                return
            if msg["type"] == "error":
                raise AgentStreamError(msg.get("data", "Unknown error"))
            yield msg["data"]

# Server-side: write NDJSON lines
async def handle_agent_stream(writer, agent, message: str, request_id: str):
    async for chunk in agent.stream(message):
        line = json.dumps({
            "request_id": request_id,
            "type": "chunk",
            "data": chunk,
        })
        writer.write((line + "\n").encode())
        await writer.drain()
    # Signal completion
    done_line = json.dumps({"request_id": request_id, "type": "done", "data": None})
    writer.write((done_line + "\n").encode())
    await writer.drain()
```

### 4.2 Server-Sent Events (SSE)

Simpler than WebSockets for one-way streaming. Works through proxies and load balancers.

```python
# FastAPI / Starlette SSE endpoint
from starlette.responses import StreamingResponse

async def sse_agent_endpoint(request):
    message = request.query_params.get("message", "")
    session_id = request.query_params.get("session_id", "")

    async def event_stream():
        async for chunk in agent.stream(message, session_id=session_id):
            # SSE format: data: <json>\n\n
            data = json.dumps({"text": chunk, "type": "chunk"})
            yield f"data: {data}\n\n"

        # Signal completion
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )

# Client-side: JavaScript EventSource
# const source = new EventSource(`/agent/stream?message=${encodeURIComponent(msg)}`);
# source.onmessage = (event) => {
#     const data = JSON.parse(event.data);
#     if (data.type === "done") { source.close(); return; }
#     appendToChat(data.text);
# };
```

### 4.3 WebSocket Bidirectional

Agent sends progress. User can cancel, provide additional context, or approve tool calls mid-stream.

```python
import asyncio
import json

async def websocket_agent_handler(websocket):
    """Bidirectional WebSocket for interactive agent sessions."""
    session = create_session()
    agent_task = None

    async for raw_message in websocket:
        msg = json.loads(raw_message)

        if msg["type"] == "user_message":
            # Start agent processing (cancellable)
            if agent_task and not agent_task.done():
                agent_task.cancel()
                await websocket.send(json.dumps({"type": "cancelled"}))

            agent_task = asyncio.create_task(
                run_agent_with_progress(websocket, session, msg["text"])
            )

        elif msg["type"] == "cancel":
            if agent_task and not agent_task.done():
                agent_task.cancel()
                await websocket.send(json.dumps({"type": "cancelled"}))

        elif msg["type"] == "tool_approval":
            # Human-in-the-loop: user approves or rejects a tool call
            session.approval_queue.put_nowait(msg["approved"])

async def run_agent_with_progress(websocket, session, message: str):
    """Run agent and send progress updates over WebSocket."""
    try:
        async for event in agent.run_streaming(message, session=session):
            if event.type == "text_chunk":
                await websocket.send(json.dumps({
                    "type": "chunk", "text": event.data
                }))
            elif event.type == "tool_call":
                await websocket.send(json.dumps({
                    "type": "tool_call",
                    "tool": event.tool_name,
                    "args": event.args,
                    "needs_approval": event.needs_approval,
                }))
            elif event.type == "thinking":
                await websocket.send(json.dumps({
                    "type": "status", "text": event.data
                }))

        await websocket.send(json.dumps({"type": "done"}))
    except asyncio.CancelledError:
        pass  # cancelled by user
```

### 4.4 Queue-Based Async (Fire and Forget)

Dispatch agent work to a queue. Notify the user when done. Essential for long-running tasks.

```python
import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4

@dataclass
class AgentJob:
    id: str = field(default_factory=lambda: str(uuid4()))
    agent_id: str = ""
    input_message: str = ""
    user_id: str = ""
    callback_channel: str = ""  # "telegram:12345" | "webhook:https://..." | "email:user@x.com"
    status: str = "pending"     # pending | running | completed | failed
    result: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)

class AgentJobQueue:
    """Async job queue for long-running agent tasks."""

    def __init__(self, max_concurrent: int = 5):
        self.queue: asyncio.Queue[AgentJob] = asyncio.Queue()
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.jobs: dict[str, AgentJob] = {}

    async def submit(self, job: AgentJob) -> str:
        self.jobs[job.id] = job
        await self.queue.put(job)
        return job.id

    async def worker(self):
        while True:
            job = await self.queue.get()
            async with self.semaphore:
                await self._process_job(job)

    async def _process_job(self, job: AgentJob):
        job.status = "running"
        try:
            agent = get_agent(job.agent_id)
            result = await agent.process(job.input_message)
            job.status = "completed"
            job.result = result.output
        except Exception as e:
            job.status = "failed"
            job.result = str(e)
        finally:
            await self._notify(job)

    async def _notify(self, job: AgentJob):
        """Deliver result through the callback channel."""
        channel_type, channel_target = job.callback_channel.split(":", 1)
        if channel_type == "telegram":
            await send_telegram(channel_target, job.result)
        elif channel_type == "webhook":
            await post_webhook(channel_target, job)
        elif channel_type == "email":
            await send_email(channel_target, subject="Agent Result", body=job.result)

# Fire-and-forget pattern (Aurelia style — goroutine equivalent in Python)
async def fire_and_forget(agent_id: str, message: str, user_id: str):
    """Submit agent work without waiting for result."""
    job = AgentJob(
        agent_id=agent_id,
        input_message=message,
        user_id=user_id,
        callback_channel=f"telegram:{user_id}",
    )
    job_id = await job_queue.submit(job)
    return {"job_id": job_id, "status": "accepted"}
```

### 4.5 Context Cancellation (Aurelia Pattern)

When a user cancels, propagate cancellation through the entire call chain — LLM calls, tool executions, sub-agents.

```python
import asyncio
from contextvars import ContextVar

# Context-scoped cancellation (similar to Go's context.Context)
cancel_token: ContextVar[asyncio.Event] = ContextVar("cancel_token")

class CancellableAgent:
    async def process(self, message: str) -> str:
        token = cancel_token.get()

        # Check before LLM call
        if token.is_set():
            raise AgentCancelled("Cancelled before LLM call")

        # Race: LLM call vs cancellation
        llm_task = asyncio.create_task(self.llm.generate(message))
        cancel_task = asyncio.create_task(token.wait())

        done, pending = await asyncio.wait(
            [llm_task, cancel_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in pending:
            task.cancel()

        if cancel_task in done:
            raise AgentCancelled("Cancelled during LLM call")

        return llm_task.result()

# Usage: create a cancellable session
async def handle_request(message: str):
    token = asyncio.Event()
    cancel_token.set(token)

    agent_task = asyncio.create_task(agent.process(message))

    # If user cancels (e.g., via WebSocket "cancel" message):
    # token.set()  # propagates through entire call chain

    return await agent_task
```

---

## 5. Session Management

An agent session tracks conversation state, token usage, cost, and configuration across turns.

### 5.1 Session State

```python
from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4

@dataclass
class AgentSession:
    id: str = field(default_factory=lambda: str(uuid4()))
    user_id: str = ""
    agent_id: str = ""
    channel: str = ""          # "telegram" | "web" | "api"
    messages: list[dict] = field(default_factory=list)
    tokens_used: int = 0
    cost_usd: float = 0.0
    tool_calls: int = 0
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_activity: datetime = field(default_factory=datetime.utcnow)
    metadata: dict = field(default_factory=dict)

    # Limits
    max_tokens: int = 100_000
    max_cost_usd: float = 1.0
    max_tool_calls: int = 50
    max_turns: int = 100
    idle_timeout_minutes: int = 30

    @property
    def turn_count(self) -> int:
        return sum(1 for m in self.messages if m["role"] == "user")

    def is_expired(self) -> bool:
        idle = (datetime.utcnow() - self.last_activity).total_seconds() / 60
        return idle > self.idle_timeout_minutes

    def check_limits(self):
        if self.tokens_used > self.max_tokens:
            raise SessionLimitExceeded("Token limit exceeded")
        if self.cost_usd > self.max_cost_usd:
            raise SessionLimitExceeded("Cost limit exceeded")
        if self.tool_calls > self.max_tool_calls:
            raise SessionLimitExceeded("Tool call limit exceeded")
        if self.turn_count > self.max_turns:
            raise SessionLimitExceeded("Turn limit exceeded")
        if self.is_expired():
            raise SessionExpired("Session idle timeout")
```

### 5.2 Auto-Reset on Context Overflow

```python
def manage_context_window(
    session: AgentSession,
    max_context_tokens: int = 128_000,
    reserve_tokens: int = 8_000,
) -> list[dict]:
    """Keep messages within context window. Summarize old messages."""
    available = max_context_tokens - reserve_tokens
    messages = session.messages

    total_tokens = estimate_tokens(messages)
    if total_tokens <= available:
        return messages

    # Strategy: keep system prompt + last N messages, summarize the rest
    system_msgs = [m for m in messages if m["role"] == "system"]
    non_system = [m for m in messages if m["role"] != "system"]

    # Keep the most recent messages that fit
    kept = []
    kept_tokens = estimate_tokens(system_msgs)
    for msg in reversed(non_system):
        msg_tokens = estimate_tokens([msg])
        if kept_tokens + msg_tokens > available * 0.7:
            break
        kept.insert(0, msg)
        kept_tokens += msg_tokens

    # Summarize what was dropped
    dropped = non_system[:len(non_system) - len(kept)]
    if dropped:
        summary = summarize_messages(dropped)  # use cheap model
        summary_msg = {
            "role": "system",
            "content": f"[Earlier conversation summary: {summary}]"
        }
        return system_msgs + [summary_msg] + kept

    return system_msgs + kept
```

### 5.3 Session Resume After Crash

```python
import json
from pathlib import Path

class SessionStore:
    """Persist sessions to survive crashes. SQLite or file-based."""

    def __init__(self, storage_path: str):
        self.path = Path(storage_path)
        self.path.mkdir(parents=True, exist_ok=True)

    def save(self, session: AgentSession):
        """Persist session state after every turn."""
        file_path = self.path / f"{session.id}.json"
        data = {
            "id": session.id,
            "user_id": session.user_id,
            "agent_id": session.agent_id,
            "channel": session.channel,
            "messages": session.messages,
            "tokens_used": session.tokens_used,
            "cost_usd": session.cost_usd,
            "tool_calls": session.tool_calls,
            "created_at": session.created_at.isoformat(),
            "last_activity": session.last_activity.isoformat(),
            "metadata": session.metadata,
        }
        # Atomic write: write to temp file, then rename
        tmp_path = file_path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(data))
        tmp_path.rename(file_path)

    def load(self, session_id: str) -> AgentSession | None:
        file_path = self.path / f"{session_id}.json"
        if not file_path.exists():
            return None
        data = json.loads(file_path.read_text())
        return AgentSession(**data)

    def cleanup_expired(self, max_age_hours: int = 24):
        """Remove old sessions. Run periodically."""
        cutoff = datetime.utcnow() - timedelta(hours=max_age_hours)
        for file_path in self.path.glob("*.json"):
            data = json.loads(file_path.read_text())
            last_activity = datetime.fromisoformat(data["last_activity"])
            if last_activity < cutoff:
                file_path.unlink()
```

---

## 6. Multi-Channel Orchestration

Same agent, different interfaces. The orchestration layer adapts input/output format per channel without changing agent logic.

### 6.1 Channel Adapter Pattern

```python
from abc import ABC, abstractmethod

class ChannelAdapter(ABC):
    """Abstract adapter — one per channel (Telegram, web, API, CLI)."""

    @abstractmethod
    async def receive(self) -> tuple[str, dict]:
        """Receive message. Returns (text, metadata)."""
        ...

    @abstractmethod
    async def send(self, text: str, metadata: dict) -> None:
        """Send response formatted for this channel."""
        ...

    @abstractmethod
    def format_response(self, agent_response: str) -> str:
        """Format agent response for this channel."""
        ...

class TelegramAdapter(ChannelAdapter):
    def format_response(self, agent_response: str) -> str:
        """Telegram: max 4096 chars, MarkdownV2, escape special chars."""
        text = agent_response[:4000]
        # Telegram MarkdownV2 requires escaping these characters
        for char in r"_*[]()~`>#+-=|{}.!":
            text = text.replace(char, f"\\{char}")
        return text

class WebAdapter(ChannelAdapter):
    def format_response(self, agent_response: str) -> str:
        """Web: full Markdown, no length limit, can include HTML."""
        return agent_response  # pass through

class APIAdapter(ChannelAdapter):
    def format_response(self, agent_response: str) -> str:
        """API: return raw JSON, no formatting."""
        return json.dumps({"response": agent_response})

class CLIAdapter(ChannelAdapter):
    def format_response(self, agent_response: str) -> str:
        """CLI: plain text, strip markdown, wrap at 80 chars."""
        import textwrap
        plain = strip_markdown(agent_response)
        return textwrap.fill(plain, width=80)
```

### 6.2 Channel-Specific Rate Limits

```python
# Different channels have different abuse profiles
CHANNEL_RATE_LIMITS = {
    "telegram": {
        "requests_per_minute": 20,   # Telegram users type slowly
        "max_message_length": 4000,
        "max_attachments": 3,
    },
    "web": {
        "requests_per_minute": 30,
        "max_message_length": 10_000,
        "max_attachments": 5,
    },
    "api": {
        "requests_per_minute": 120,  # API clients send bursts
        "max_message_length": 50_000,
        "max_attachments": 10,
    },
    "cli": {
        "requests_per_minute": 60,
        "max_message_length": 50_000,
        "max_attachments": 0,
    },
}
```

### 6.3 Unified Orchestrator

```python
class Orchestrator:
    """Route channel messages to agents, format responses back."""

    def __init__(self, agents: dict[str, Agent], adapters: dict[str, ChannelAdapter]):
        self.agents = agents
        self.adapters = adapters
        self.session_store = SessionStore("./sessions")

    async def handle(
        self,
        channel: str,
        user_id: str,
        message: str,
    ) -> str:
        adapter = self.adapters[channel]
        limits = CHANNEL_RATE_LIMITS[channel]

        # Rate check
        check_rate_limit(f"{channel}:{user_id}", limits["requests_per_minute"])

        # Input limits
        if len(message) > limits["max_message_length"]:
            message = message[:limits["max_message_length"]]

        # Get or create session
        session = self.session_store.load(f"{channel}:{user_id}")
        if not session or session.is_expired():
            session = AgentSession(user_id=user_id, channel=channel)

        # Route to agent
        agent_id, _ = await route_request(message, self.llm, set(self.agents.keys()))
        agent = self.agents[agent_id]

        # Execute
        result = await agent.process(message, session=session)

        # Save session
        self.session_store.save(session)

        # Format for channel
        return adapter.format_response(result.output)
```

---

## 7. Cron and Scheduled Agents

Agents that run on a schedule — reports, monitoring, cleanup. Aurelia pattern: SQLite-backed cron with deduplication.

### 7.1 Scheduled Execution

```python
import asyncio
import sqlite3
from datetime import datetime
from croniter import croniter

class AgentScheduler:
    """SQLite-backed cron scheduler for agents. Survives restarts."""

    def __init__(self, db_path: str = "scheduler.db"):
        self.db = sqlite3.connect(db_path)
        self._init_db()

    def _init_db(self):
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS scheduled_agents (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                cron_expression TEXT NOT NULL,
                input_message TEXT NOT NULL,
                callback_channel TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                last_run_at TEXT,
                next_run_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS execution_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                schedule_id TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                status TEXT,  -- running | completed | failed
                result_summary TEXT,
                cost_usd REAL,
                FOREIGN KEY (schedule_id) REFERENCES scheduled_agents(id)
            )
        """)
        self.db.commit()

    def schedule(
        self,
        schedule_id: str,
        agent_id: str,
        cron_expression: str,  # e.g., "0 9 * * 1" = every Monday 9 AM
        input_message: str,
        callback_channel: str,
    ):
        next_run = croniter(cron_expression, datetime.utcnow()).get_next(datetime)
        self.db.execute(
            """INSERT OR REPLACE INTO scheduled_agents
               (id, agent_id, cron_expression, input_message, callback_channel, next_run_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (schedule_id, agent_id, cron_expression, input_message,
             callback_channel, next_run.isoformat()),
        )
        self.db.commit()

    def get_due_jobs(self) -> list[dict]:
        """Get all jobs that are due to run now."""
        now = datetime.utcnow().isoformat()
        cursor = self.db.execute(
            "SELECT * FROM scheduled_agents WHERE enabled = 1 AND next_run_at <= ?",
            (now,),
        )
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
```

### 7.2 Deduplication of Concurrent Executions

Prevent the same scheduled job from running twice if the previous execution hasn't finished.

```python
class DeduplicatedScheduler(AgentScheduler):
    """Extend scheduler with execution deduplication."""

    def is_already_running(self, schedule_id: str) -> bool:
        cursor = self.db.execute(
            """SELECT COUNT(*) FROM execution_log
               WHERE schedule_id = ? AND status = 'running'""",
            (schedule_id,),
        )
        return cursor.fetchone()[0] > 0

    async def execute_due_jobs(self):
        """Main scheduler loop. Run this periodically."""
        due_jobs = self.get_due_jobs()

        for job in due_jobs:
            # DEDUPLICATION: skip if already running
            if self.is_already_running(job["id"]):
                log_skipped_duplicate(job["id"])
                continue

            # Mark as running
            execution_id = self._start_execution(job["id"])

            # Fire and forget (Aurelia-style goroutine equivalent)
            asyncio.create_task(
                self._run_and_record(job, execution_id)
            )

    def _start_execution(self, schedule_id: str) -> int:
        cursor = self.db.execute(
            """INSERT INTO execution_log (schedule_id, started_at, status)
               VALUES (?, ?, 'running')""",
            (schedule_id, datetime.utcnow().isoformat()),
        )
        self.db.commit()
        return cursor.lastrowid

    async def _run_and_record(self, job: dict, execution_id: int):
        try:
            agent = get_agent(job["agent_id"])
            result = await agent.process(job["input_message"])

            self.db.execute(
                """UPDATE execution_log
                   SET finished_at = ?, status = 'completed', result_summary = ?
                   WHERE id = ?""",
                (datetime.utcnow().isoformat(), result.output[:500], execution_id),
            )

            # Deliver result
            await deliver_to_channel(job["callback_channel"], result.output)

        except Exception as e:
            self.db.execute(
                """UPDATE execution_log
                   SET finished_at = ?, status = 'failed', result_summary = ?
                   WHERE id = ?""",
                (datetime.utcnow().isoformat(), str(e)[:500], execution_id),
            )

        finally:
            # Update next_run_at
            cron = croniter(job["cron_expression"], datetime.utcnow())
            next_run = cron.get_next(datetime)
            self.db.execute(
                """UPDATE scheduled_agents
                   SET last_run_at = ?, next_run_at = ?
                   WHERE id = ?""",
                (datetime.utcnow().isoformat(), next_run.isoformat(), job["id"]),
            )
            self.db.commit()
```

### 7.3 Result Delivery

```python
# Scheduled agents deliver results to configured channels
async def deliver_to_channel(channel_spec: str, content: str):
    """Parse channel spec and deliver. Format: 'type:target'"""
    channel_type, target = channel_spec.split(":", 1)

    if channel_type == "telegram":
        await telegram_bot.send_message(chat_id=target, text=content[:4000])
    elif channel_type == "slack":
        await slack_client.post_message(channel=target, text=content)
    elif channel_type == "webhook":
        await http_client.post(target, json={"result": content})
    elif channel_type == "email":
        await send_email(to=target, subject="Scheduled Agent Report", body=content)
    else:
        log_unknown_channel(channel_type)

# Example: schedule a weekly report agent
scheduler.schedule(
    schedule_id="weekly-sales-report",
    agent_id="analytics-agent",
    cron_expression="0 9 * * 1",  # every Monday 9 AM UTC
    input_message="Generate the weekly sales report with key metrics and trends.",
    callback_channel="slack:#sales-reports",
)
```

---

## 8. Anti-Patterns

### 8.1 Using LLM for Everything

```python
# WRONG: LLM-based routing for every request
agent_id = await llm.classify(message)  # $0.001 * 10,000 requests/day = $10/day just for routing

# CORRECT: keyword matching handles 70-80% of requests for free
agent_id = route_by_keyword(message)
if not agent_id:
    agent_id = await llm.classify(message)  # LLM only for the 20-30% ambiguous cases
```

### 8.2 Single Model for Everything

```python
# WRONG: Opus for all tasks
response = await llm.generate(model="claude-opus-4-8", messages=messages)
# cost: ~$0.15/call * 1000 calls/day = $150/day

# CORRECT: tier by task
# Routing: Flash ($0.001) — 600 calls/day = $0.60
# Execution: Sonnet ($0.02) — 350 calls/day = $7.00
# Reasoning: Opus ($0.15) — 50 calls/day = $7.50
# Total: $15.10/day vs $150/day — 10x cheaper
```

### 8.3 No Session Persistence

```python
# WRONG: session only in memory
sessions = {}  # lost on crash or restart

# CORRECT: persist after every turn
session_store.save(session)  # survives crash, restart, deploy
```

### 8.4 No Context Window Management

```python
# WRONG: append messages forever
session.messages.append(new_message)
# eventually: "Context length exceeded" error, agent crashes

# CORRECT: manage context window proactively
session.messages = manage_context_window(session, max_context_tokens=128_000)
```

### 8.5 Synchronous-Only Design

```python
# WRONG: user waits 3 minutes for agent to finish
result = agent.process(complex_request)  # blocks for 180 seconds
return result

# CORRECT: accept, process in background, notify when done
job_id = await fire_and_forget(agent_id, complex_request, user_id)
return f"Processing your request. I'll notify you when it's ready. (Job: {job_id})"
```

### 8.6 No Provider Failover

```python
# WRONG: single provider, single model
response = await anthropic.generate(model="claude-sonnet-5", messages=messages)
# if Anthropic is down, your entire system is down

# CORRECT: failover chain
failover = ProviderFailover([
    ProviderConfig(name="anthropic", model="claude-sonnet-5"),
    ProviderConfig(name="openai", model="gpt-4o"),
    ProviderConfig(name="openai", model="gpt-4o-mini"),  # degraded but alive
])
```

---

## Quick Reference: Orchestration Checklist

```
ROUTING
[ ] Keyword/prefix matching for common intents
[ ] LLM fallback for ambiguous intents
[ ] Router prompt with examples and structured output
[ ] Unknown intent handling (default agent or clarification)

LLM TIERS
[ ] Routing: cheapest model (Flash, GPT-4o-mini)
[ ] Execution: mid-tier (Sonnet, GPT-4o)
[ ] Reasoning: expensive only when needed (Opus)
[ ] Cost tracking by tier
[ ] Provider failover chain

HANDOFFS
[ ] Clear handoff protocol between agents
[ ] Context passed between agents (not lost)
[ ] Failure handling at each handoff point
[ ] Escalation path to human

STREAMING / ASYNC
[ ] Streaming for interactive use (SSE or WebSocket)
[ ] Queue-based async for long tasks
[ ] Context cancellation propagated
[ ] Timeout on every async operation

SESSIONS
[ ] Session state persisted after every turn
[ ] Context window managed (summarize old messages)
[ ] Session expiry and cleanup
[ ] Resume after crash

CHANNELS
[ ] Channel-specific formatting
[ ] Channel-specific rate limits
[ ] Unified orchestrator behind adapters

SCHEDULING
[ ] Cron scheduler with persistence (SQLite or equivalent)
[ ] Deduplication of concurrent executions
[ ] Result delivery to configured channels
[ ] Execution logging
```
