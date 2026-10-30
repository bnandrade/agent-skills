# Memory & Context

Arquitetura de memória para agentes autônomos: context window, memória de curto e longo prazo, RAG, embeddings, compactação. Informado por sistemas reais (BHEN: 4 camadas com compactação automática, Aurelia: global/project/team).

---

## Table of Contents

1. [Context Window Management](#1-context-window-management)
2. [Short-Term Memory](#2-short-term-memory)
3. [Long-Term Memory](#3-long-term-memory)
4. [Multi-Layer Memory Architecture](#4-multi-layer-memory-architecture)
5. [Memory Compaction](#5-memory-compaction)
6. [RAG Pipeline Design](#6-rag-pipeline-design)
7. [Embedding Models](#7-embedding-models)
8. [Vector Database Patterns](#8-vector-database-patterns)
9. [Chunking Strategies](#9-chunking-strategies)
10. [Hybrid Search](#10-hybrid-search)
11. [Reranking](#11-reranking)
12. [Context Injection Patterns](#12-context-injection-patterns)
13. [Privacy and Data Retention](#13-privacy-and-data-retention)
14. [Anti-Patterns](#14-anti-patterns)

---

## 1. Context Window Management

O context window é finito. Todo sistema de agentes precisa de um token budget.

### 1.1 Token Budget Template

```
Total context window: 200k tokens (Claude Opus/Sonnet)

Budget allocation:
  System prompt + instructions:   ~2k tokens   (1%)
  Agent persona + tools schema:   ~3k tokens   (1.5%)
  Memory context (long-term):     ~5k tokens   (2.5%)
  RAG results:                    ~10k tokens  (5%)
  Conversation history:           ~30k tokens  (15%)
  Current turn (user + response): ~50k tokens  (25%)
  Safety buffer:                  ~100k tokens (50%)
```

### 1.2 Quando o Context Transborda

```python
# WRONG: enviar tudo e torcer para caber
messages = load_all_conversation_history(user_id)
response = llm.prompt(system_prompt + messages + user_message)

# CORRECT: budget-aware context assembly
def assemble_context(user_id: str, user_message: str, max_tokens: int = 100_000) -> list:
    budget = TokenBudget(max_tokens)

    # 1. Fixos (sempre incluídos)
    budget.reserve("system", system_prompt, priority=0)
    budget.reserve("tools", tools_schema, priority=0)

    # 2. Memória de longo prazo (fatos persistentes)
    facts = memory.get_facts(user_id, limit=20)
    budget.add("memory", format_facts(facts), priority=1)

    # 3. RAG (se relevante)
    if needs_rag(user_message):
        docs = rag.search(user_message, limit=5)
        budget.add("rag", format_docs(docs), priority=2)

    # 4. Histórico (mais recente primeiro, corta do mais antigo)
    history = conversation.get_recent(user_id, limit=50)
    budget.add_sliding("history", history, priority=3)

    # 5. Mensagem atual
    budget.add("current", user_message, priority=0)

    return budget.build()
```

### 1.3 Estratégias Quando Não Cabe

| Estratégia | Quando Usar | Trade-off |
|---|---|---|
| **Truncar histórico antigo** | Conversas longas | Perde contexto inicial |
| **Sumarizar histórico** | Sessões com muitas mensagens | Perde detalhes, custo de sumarização |
| **RAG em vez de contexto** | Conhecimento grande e estável | Latência de busca, relevância imprecisa |
| **Reset de sessão** | Mudança de tópico | Perda total do contexto prévio |
| **Compactação de memória** | Fatos recorrentes | Perde nuance temporal |

---

## 2. Short-Term Memory

Memória dentro de uma sessão/conversa — o histórico de mensagens.

### 2.1 Sliding Window

```python
class ConversationHistory:
    def __init__(self, max_messages: int = 50, max_tokens: int = 30_000):
        self.messages: list[Message] = []
        self.max_messages = max_messages
        self.max_tokens = max_tokens

    def add(self, role: str, content: str):
        self.messages.append(Message(role=role, content=content))
        self._trim()

    def _trim(self):
        # Remove mensagens mais antigas até caber
        while len(self.messages) > self.max_messages:
            self.messages.pop(0)

        while self._total_tokens() > self.max_tokens and len(self.messages) > 2:
            self.messages.pop(0)  # preserva pelo menos a última troca

    def get_messages(self) -> list[Message]:
        return self.messages.copy()
```

### 2.2 Sumarização de Histórico

Quando o histórico é longo demais, sumarize as mensagens antigas:

```python
async def summarize_and_compact(history: list[Message], keep_recent: int = 10) -> list[Message]:
    if len(history) <= keep_recent:
        return history

    old_messages = history[:-keep_recent]
    recent_messages = history[-keep_recent:]

    summary = await llm.prompt(
        model=LLMTier.ROUTING,  # use modelo barato para sumarização
        prompt=f"Summarize this conversation concisely, keeping key facts and decisions:\n\n"
               + format_messages(old_messages),
    )

    return [
        Message(role="system", content=f"[Previous conversation summary]\n{summary}"),
        *recent_messages,
    ]
```

---

## 3. Long-Term Memory

Informações que persistem entre sessões — fatos, preferências, decisões.

### 3.1 Tipos de Memória de Longo Prazo

| Tipo | Exemplo | Persistência | Fonte |
|---|---|---|---|
| **Fatos do usuário** | "Bruno é dev Laravel" | Permanente | Extraído de conversas |
| **Preferências** | "Prefere respostas curtas" | Permanente | Feedback do usuário |
| **Decisões** | "Escolheu PostgreSQL para o projeto X" | Longa | Conversa/ADR |
| **Contexto de projeto** | "API tem 15 endpoints" | Média | Código/docs |
| **Episódico** | "Ontem pediu ajuda com deploy" | Curta | Compactado depois |

### 3.2 Modelo de Dados

```python
@dataclass
class MemoryEntry:
    id: str
    user_id: str
    category: str          # "fact", "preference", "decision", "project", "episodic"
    content: str           # o fato/informação
    source: str            # de onde veio ("conversation:123", "extraction")
    confidence: float      # 0.0-1.0
    created_at: datetime
    last_accessed: datetime
    access_count: int
    embedding: list[float] # para busca semântica
    expires_at: datetime | None  # TTL para memória episódica
```

### 3.3 Extração Automática de Fatos

```python
EXTRACTION_PROMPT = """
Analyze this conversation and extract factual information worth remembering.
Return JSON array of facts. Only extract:
- User preferences and expertise
- Project decisions and constraints
- Important names, dates, and relationships
Do NOT extract: opinions, temporary states, small talk.

Conversation:
{conversation}

Return: [{"category": "fact|preference|decision", "content": "...", "confidence": 0.0-1.0}]
"""

async def extract_facts(conversation: list[Message]) -> list[MemoryEntry]:
    result = await llm.prompt(
        model=LLMTier.ROUTING,
        prompt=EXTRACTION_PROMPT.format(conversation=format_messages(conversation)),
        structured_output=True,
    )
    return [MemoryEntry(**fact) for fact in result]
```

---

## 4. Multi-Layer Memory Architecture

### 4.1 BHEN Pattern (4 Camadas)

```
Layer 1: Working Memory (context window)
  → Conversa atual, últimas N mensagens
  → Volátil — descartada ao fim da sessão

Layer 2: Session Notes (episódico)
  → O que aconteceu nesta sessão
  → Compactado automaticamente em fatos após 24h

Layer 3: Facts (permanente)
  → Fatos extraídos e validados
  → Buscáveis por semântica (embeddings)

Layer 4: Knowledge Base (RAG)
  → Documentos, código, referências externas
  → Indexados por chunks com embeddings
```

### 4.2 Aurelia Pattern (3 Camadas por Escopo)

```
Global Memory (~/.aurelia/memory/)
  → Fatos pessoais, preferências, estilo
  → Compartilhado entre todos os projetos

Project Memory (~/.aurelia/projects/<cwd>/memory/)
  → Decisões técnicas, arquitetura, WIP
  → Específico do projeto

Team Memory (~/.aurelia/projects/<cwd>/memory/team/)
  → Convenções, padrões, onboarding
  → Compartilhado entre agentes no mesmo projeto
```

### 4.3 Implementação Prática

```python
class MemorySystem:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.working = WorkingMemory(max_tokens=30_000)
        self.episodic = EpisodicStore(db, ttl=timedelta(days=7))
        self.facts = FactStore(db, embeddings_client)
        self.knowledge = RAGStore(vector_db, embeddings_client)

    async def recall(self, query: str, max_tokens: int = 5_000) -> str:
        """Recall relevant memories for the current query."""
        parts = []

        # 1. Fatos relevantes (sempre rápido, poucos resultados)
        facts = await self.facts.search(
            query=query,
            user_id=self.user_id,
            limit=10,
        )
        if facts:
            parts.append("## Known Facts\n" + "\n".join(f"- {f.content}" for f in facts))

        # 2. RAG se necessário (mais lento, mais contexto)
        docs = await self.knowledge.search(
            query=query,
            limit=3,
            min_score=0.7,
        )
        if docs:
            parts.append("## Relevant Documents\n" + "\n\n".join(d.content for d in docs))

        return "\n\n".join(parts)
```

---

## 5. Memory Compaction

Processo de transformar memória episódica em fatos permanentes.

### 5.1 Pipeline de Compactação

```
Episodic Notes → Extract Facts → Deduplicate → Merge → Store as Facts
     ↓                                                      ↓
  (TTL: 7 days)                                    (permanente, com embedding)
```

### 5.2 Implementação

```python
async def compact_memories(user_id: str):
    """Run periodically (e.g., daily cron)."""
    # 1. Buscar notas episódicas prontas para compactação
    notes = await episodic.get_expired(user_id, older_than=timedelta(days=1))
    if not notes:
        return

    # 2. Extrair fatos
    new_facts = await extract_facts(notes)

    # 3. Deduplicar contra fatos existentes
    existing = await facts.get_all(user_id)
    for fact in new_facts:
        similar = await facts.find_similar(fact.content, threshold=0.9)
        if similar:
            # Merge: atualizar o existente com info nova
            await facts.merge(similar.id, fact)
        else:
            # Novo fato
            await facts.store(fact)

    # 4. Limpar notas compactadas
    await episodic.delete_batch([n.id for n in notes])
```

### 5.3 Merge de Fatos Conflitantes

```python
MERGE_PROMPT = """
Two memory entries seem related. Merge them into one concise fact.
If they conflict, keep the more recent one.

Existing: {existing}
New: {new}

Return the merged fact as a single sentence.
"""

async def merge_facts(existing: MemoryEntry, new: MemoryEntry) -> str:
    if new.created_at > existing.created_at:
        # Mais recente tem prioridade em caso de conflito
        return await llm.prompt(
            model=LLMTier.ROUTING,
            prompt=MERGE_PROMPT.format(existing=existing.content, new=new.content),
        )
    return existing.content
```

---

## 6. RAG Pipeline Design

### 6.1 Pipeline Completo

```
Document → Chunk → Embed → Store in Vector DB
                                    ↓
Query → Embed → Vector Search → Rerank → Inject into Context
```

### 6.2 Implementação

```python
class RAGPipeline:
    def __init__(self, vector_db, embeddings_client, reranker=None):
        self.vector_db = vector_db
        self.embeddings = embeddings_client
        self.reranker = reranker

    async def ingest(self, document: str, metadata: dict):
        """Ingest a document into the knowledge base."""
        # 1. Chunk
        chunks = self.chunk(document, max_tokens=512, overlap=50)

        # 2. Embed
        embeddings = await self.embeddings.create(
            input=[c.text for c in chunks],
            model="text-embedding-3-small",
        )

        # 3. Store
        for chunk, embedding in zip(chunks, embeddings):
            await self.vector_db.upsert(
                id=chunk.id,
                vector=embedding,
                payload={
                    "text": chunk.text,
                    "source": metadata.get("source"),
                    "chunk_index": chunk.index,
                    **metadata,
                },
            )

    async def search(self, query: str, limit: int = 5, min_score: float = 0.7) -> list[Document]:
        """Search for relevant documents."""
        # 1. Embed query
        query_embedding = await self.embeddings.create(
            input=[query],
            model="text-embedding-3-small",
        )

        # 2. Vector search
        results = await self.vector_db.search(
            vector=query_embedding[0],
            limit=limit * 3 if self.reranker else limit,
            score_threshold=min_score,
        )

        # 3. Rerank (optional but recommended)
        if self.reranker and results:
            results = await self.reranker.rerank(
                query=query,
                documents=[r.payload["text"] for r in results],
                top_n=limit,
            )

        return results
```

---

## 7. Embedding Models

### 7.1 Comparação

| Modelo | Provider | Dimensões | Custo | Best For |
|---|---|---|---|---|
| **text-embedding-3-small** | OpenAI | 1536 | $0.02/1M tokens | Uso geral, boa relação custo/qualidade |
| **text-embedding-3-large** | OpenAI | 3072 | $0.13/1M tokens | Máxima qualidade, mais caro |
| **embed-v4.0** | Cohere | 1024 | $0.10/1M tokens | Multilingual, search-otimizado |
| **jina-embeddings-v3** | Jina | 1024 | $0.02/1M tokens | Multilingual, code-aware |
| **voyage-3** | VoyageAI | 1024 | $0.06/1M tokens | Code-aware, retrieval-otimizado |
| **nomic-embed-text** | Ollama (local) | 768 | Grátis | Self-hosted, privacidade |

### 7.2 Recomendação

| Cenário | Modelo |
|---|---|
| MVP, custo baixo | **text-embedding-3-small** |
| Código e documentação técnica | **voyage-3** ou **jina-embeddings-v3** |
| Self-hosted, privacidade | **nomic-embed-text** via Ollama |
| Multilingual | **Cohere embed-v4.0** |

### 7.3 Caching de Embeddings

```python
async def get_or_create_embedding(text: str, model: str) -> list[float]:
    cache_key = f"emb:{model}:{hashlib.md5(text.encode()).hexdigest()}"

    cached = await cache.get(cache_key)
    if cached:
        return cached

    embedding = await embeddings_client.create(input=[text], model=model)
    await cache.set(cache_key, embedding[0], ttl=timedelta(days=30))
    return embedding[0]
```

---

## 8. Vector Database Patterns

### 8.1 Quando Usar Qual

| Vector DB | Best For | Tradeoff |
|---|---|---|
| **pgvector** | Já usa PostgreSQL, volume moderado (< 1M vectors) | Sem infra extra, mais lento em escala |
| **Qdrant** | Volume alto, filtering complexo, dedicated | Infra separada, muito rápido |
| **Chroma** | Prototipagem, local development | Não recomendado para produção |
| **Pinecone** | Managed, zero ops | Vendor lock-in, custo |

### 8.2 pgvector (Padrão Recomendado para Começar)

```sql
-- Setup
CREATE EXTENSION vector;

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    embedding VECTOR(1536),  -- dimensão do modelo
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para busca rápida
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);  -- ajustar conforme volume

-- Busca por similaridade
SELECT id, content, metadata,
       1 - (embedding <=> $1::vector) AS similarity
FROM documents
WHERE 1 - (embedding <=> $1::vector) > 0.7
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

### 8.3 Laravel 13 Native Vector Search

```php
// Laravel 13: busca vetorial nativa com pgvector
$results = DB::table('documents')
    ->whereVectorSimilarTo('embedding', 'How to deploy Laravel?')
    ->limit(5)
    ->get();
```

---

## 9. Chunking Strategies

### 9.1 Comparação

| Estratégia | Como Funciona | Best For |
|---|---|---|
| **Fixed size** | N tokens com overlap | Texto genérico, simples |
| **Paragraph** | Quebra por `\n\n` | Documentos, artigos |
| **Semantic** | Detecta mudança de tópico | Textos longos, livros |
| **Code-aware** | Quebra por função/classe | Código-fonte |
| **Markdown** | Quebra por headers (`##`) | Documentação, READMEs |

### 9.2 Implementação Prática

```python
def chunk_by_paragraphs(text: str, max_tokens: int = 512, overlap: int = 50) -> list[Chunk]:
    paragraphs = text.split("\n\n")
    chunks = []
    current = []
    current_tokens = 0

    for para in paragraphs:
        para_tokens = count_tokens(para)

        if current_tokens + para_tokens > max_tokens and current:
            # Salvar chunk atual
            chunks.append(Chunk(text="\n\n".join(current), index=len(chunks)))

            # Overlap: manter últimos N tokens do chunk anterior
            overlap_paras = []
            overlap_tokens = 0
            for p in reversed(current):
                if overlap_tokens + count_tokens(p) > overlap:
                    break
                overlap_paras.insert(0, p)
                overlap_tokens += count_tokens(p)

            current = overlap_paras
            current_tokens = overlap_tokens

        current.append(para)
        current_tokens += para_tokens

    if current:
        chunks.append(Chunk(text="\n\n".join(current), index=len(chunks)))

    return chunks
```

### 9.3 Chunk Metadata

Sempre armazene metadata com o chunk para filtragem:

```python
{
    "text": "chunk content...",
    "source": "docs/api/authentication.md",
    "section": "Bearer Token",
    "chunk_index": 3,
    "total_chunks": 12,
    "doc_type": "documentation",
    "language": "en",
    "updated_at": "2026-04-11"
}
```

---

## 10. Hybrid Search

Combinar busca vetorial (semântica) com busca por keywords (BM25) para melhores resultados.

### 10.1 Por Que Hybrid

| Query | Vetorial Encontra | Keyword Encontra | Melhor |
|---|---|---|---|
| "como fazer deploy" | docs sobre deployment | docs com "deploy" literal | Vetorial |
| "erro 500 nginx" | docs sobre erros HTTP | docs com "500" e "nginx" | Keyword |
| "API não funciona" | docs sobre troubleshooting | nada específico | Vetorial |
| "BHEN-2024-001" | nada (muito específico) | ticket exato | Keyword |

### 10.2 Implementação com Reciprocal Rank Fusion

```python
async def hybrid_search(query: str, limit: int = 5) -> list[Document]:
    # 1. Busca vetorial
    vector_results = await vector_db.search(query, limit=limit * 2)

    # 2. Busca keyword (BM25 via PostgreSQL full-text)
    keyword_results = await db.execute(
        "SELECT * FROM documents WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1) LIMIT $2",
        query, limit * 2,
    )

    # 3. Reciprocal Rank Fusion
    scores = defaultdict(float)
    k = 60  # constante RRF

    for rank, doc in enumerate(vector_results):
        scores[doc.id] += 1 / (k + rank + 1)

    for rank, doc in enumerate(keyword_results):
        scores[doc.id] += 1 / (k + rank + 1)

    # 4. Ordenar por score combinado
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return [get_document(doc_id) for doc_id, _ in ranked[:limit]]
```

---

## 11. Reranking

Segundo estágio de ranking após busca inicial — melhora significativamente a relevância.

### 11.1 Quando Usar

- Initial retrieval retorna > 10 candidatos
- Qualidade da resposta depende fortemente do contexto
- Custo de reranking é menor que custo de resposta ruim do LLM

### 11.2 Implementação

```python
# Cohere Rerank
async def rerank(query: str, documents: list[str], top_n: int = 5) -> list[Document]:
    response = await cohere.rerank(
        query=query,
        documents=documents,
        model="rerank-v3.5",
        top_n=top_n,
    )
    return [documents[r.index] for r in response.results]
```

### 11.3 Pipeline Completo

```
Query → Embed → Vector Search (top 20)
                      ↓
              Rerank (top 5)
                      ↓
              Inject into Context
```

---

## 12. Context Injection Patterns

### 12.1 Ordem Importa

A posição do conteúdo no prompt afeta a atenção do modelo:

```
SYSTEM PROMPT
├── Agent persona/instructions        (sempre lido, alta atenção)
├── Tool definitions                   (referência, atenção moderada)
├── [MEMORY] Long-term facts           (alta atenção — curto e denso)
├── [RAG] Retrieved documents          (atenção moderada — pode ser longo)
├── [HISTORY] Conversation (oldest)    (baixa atenção — "lost in the middle")
├── [HISTORY] Conversation (recent)    (alta atenção — recente)
└── [USER] Current message             (máxima atenção — é o que pede resposta)
```

### 12.2 Formatação para o LLM

```python
def format_context(memories: list, rag_docs: list) -> str:
    parts = []

    if memories:
        parts.append("## What I Know About You")
        for m in memories:
            parts.append(f"- {m.content}")

    if rag_docs:
        parts.append("\n## Relevant Information")
        for doc in rag_docs:
            parts.append(f"### Source: {doc.source}")
            parts.append(doc.content)
            parts.append("")  # separador

    return "\n".join(parts)
```

---

## 13. Privacy and Data Retention

### 13.1 O Que Armazenar vs O Que Não

| Armazene | Não Armazene |
|---|---|
| Fatos e preferências do usuário | Conversas raw completas |
| Decisões e contexto de projeto | Senhas, tokens, chaves |
| Embeddings de documentos | PII sem necessidade (CPF, endereço) |
| Metadata de interações | Dados financeiros detalhados |

### 13.2 LGPD/GDPR Considerations

```python
# Direito ao esquecimento — precisa conseguir deletar tudo de um usuário
async def forget_user(user_id: str):
    await facts.delete_all(user_id=user_id)
    await episodic.delete_all(user_id=user_id)
    await conversations.delete_all(user_id=user_id)
    await vector_db.delete(filter={"user_id": user_id})
    await audit_log.record("user_data_deleted", user_id=user_id)
```

### 13.3 TTL por Tipo de Dado

| Tipo | TTL | Justificativa |
|---|---|---|
| Conversas raw | 30 dias | Debugging, depois compacta |
| Notas episódicas | 7 dias | Compactado em fatos |
| Fatos | Indefinido (ou até delete) | Valor permanente |
| RAG embeddings | Até documento mudar | Re-index quando atualizar |
| Audit logs | 1 ano | Compliance |

---

## 14. Anti-Patterns

### 14.1 Infinite Context

Tentar colocar tudo no context window.

**Sintoma:** Prompts de 100k+ tokens para cada request. Caro e lento.
**Solução:** Budget tokens por camada. RAG para conhecimento extenso.

### 14.2 RAG Everything

Usar RAG para informações que deveriam estar no system prompt.

**Sintoma:** Agent busca RAG para saber suas próprias instruções.
**Solução:** Instruções fixas no system prompt. RAG só para conhecimento variável.

### 14.3 No Compaction

Nunca compactar memória episódica em fatos.

**Sintoma:** Memória cresce indefinidamente, busca fica lenta, custos sobem.
**Solução:** Cron de compactação diário (como BHEN faz automaticamente).

### 14.4 No Memory Validation

Aceitar qualquer coisa que o LLM extrai como fato.

**Sintoma:** Fatos incorretos ou alucinados persistem e influenciam futuras respostas.
**Solução:** Confidence score + validação periódica + mecanismo para corrigir fatos.

### 14.5 Single Embedding Model For Everything

Usar o mesmo modelo de embedding para código, texto e imagens.

**Sintoma:** Resultados de busca ruins para código quando o modelo é otimizado para texto.
**Solução:** Modelos especializados: voyage-3 para código, text-embedding-3-small para texto.

### 14.6 Ignoring the "Lost in the Middle" Problem

Colocar informação crítica no meio de um contexto longo.

**Sintoma:** Agent "esquece" informações que estão no meio do prompt.
**Solução:** Informações críticas no início ou no final. Fatos curtos e densos.
