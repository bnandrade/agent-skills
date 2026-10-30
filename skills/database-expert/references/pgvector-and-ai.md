# pgvector & AI

Storing and searching vector embeddings in PostgreSQL with pgvector. Hybrid search, RAG pipelines, index tuning, and integration patterns.

---

## Table of Contents

1. [pgvector Setup](#1-pgvector-setup)
2. [Storing Embeddings](#2-storing-embeddings)
3. [Similarity Search](#3-similarity-search)
4. [Index Types (IVFFlat vs HNSW)](#4-index-types-ivfflat-vs-hnsw)
5. [Index Tuning](#5-index-tuning)
6. [Hybrid Search](#6-hybrid-search)
7. [Filtering with Vector Search](#7-filtering-with-vector-search)
8. [Embedding Dimensions and Models](#8-embedding-dimensions-and-models)
9. [Performance and Scaling](#9-performance-and-scaling)
10. [Integration with Laravel](#10-integration-with-laravel)
11. [RAG Pipeline](#11-rag-pipeline)
12. [Maintenance](#12-maintenance)
13. [Migration from/to Qdrant](#13-migration-fromto-qdrant)

---

## 1. pgvector Setup

### Install Extension

```sql
-- PostgreSQL 13+ required
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### Create Table with Vector Column

```sql
CREATE TABLE documents (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),  -- OpenAI text-embedding-3-small (1536 dimensions)
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

```sql
-- WRONG: no dimension specified
CREATE TABLE docs (
    id SERIAL PRIMARY KEY,
    embedding vector  -- no dimensions = any size, but no index possible
);

-- CORRECT: always specify dimensions to enable indexing
CREATE TABLE docs (
    id SERIAL PRIMARY KEY,
    embedding vector(1536)
);
```

---

## 2. Storing Embeddings

### Single Insert

```sql
INSERT INTO documents (title, content, embedding, metadata)
VALUES (
    'PostgreSQL Optimization',
    'PostgreSQL query optimization involves analyzing execution plans...',
    '[0.0012, -0.0234, 0.0567, ...]'::vector,  -- 1536 float values
    '{"source": "blog", "author": "bruno"}'
);
```

### Batch Insert (Efficient)

```sql
-- Use COPY for large batches (fastest)
COPY documents (title, content, embedding, metadata)
FROM STDIN WITH (FORMAT csv);

-- Or multi-value INSERT
INSERT INTO documents (title, content, embedding, metadata) VALUES
    ('Doc 1', 'Content 1', '[0.01, -0.02, ...]'::vector, '{}'),
    ('Doc 2', 'Content 2', '[0.03, -0.04, ...]'::vector, '{}'),
    ('Doc 3', 'Content 3', '[0.05, -0.06, ...]'::vector, '{}');
```

### Update Embeddings

```sql
-- Re-embed after content change
UPDATE documents
SET embedding = '[0.01, 0.02, ...]'::vector,
    content = 'Updated content...'
WHERE id = 42;
```

---

## 3. Similarity Search

### Distance Operators

```sql
-- Cosine distance (most common for text embeddings)
-- Range: 0 (identical) to 2 (opposite)
SELECT id, title, embedding <=> query_embedding AS distance
FROM documents
ORDER BY embedding <=> query_embedding
LIMIT 10;

-- L2 (Euclidean) distance
-- Range: 0 (identical) to infinity
SELECT id, title, embedding <-> query_embedding AS distance
FROM documents
ORDER BY embedding <-> query_embedding
LIMIT 10;

-- Inner product (negative, for max inner product search)
-- More negative = more similar
SELECT id, title, (embedding <#> query_embedding) * -1 AS similarity
FROM documents
ORDER BY embedding <#> query_embedding
LIMIT 10;
```

### When to Use Each

```sql
-- Cosine distance (<=>):
--   Best for: text embeddings (OpenAI, Cohere, Voyage)
--   Why: normalized, direction-based, magnitude-independent
--   Most common choice for RAG and semantic search

-- L2 / Euclidean distance (<->):
--   Best for: image embeddings, spatial data
--   Why: considers magnitude, good for raw feature vectors

-- Inner product (<#>):
--   Best for: embeddings that are already normalized (unit vectors)
--   Why: fastest computation, equivalent to cosine for unit vectors
--   Note: pgvector uses NEGATIVE inner product (sort ASC, not DESC)
```

### Similarity Search with Threshold

```sql
-- Only return results above a similarity threshold
SELECT id, title, 1 - (embedding <=> query_embedding) AS similarity
FROM documents
WHERE embedding <=> query_embedding < 0.5  -- cosine distance < 0.5
ORDER BY embedding <=> query_embedding
LIMIT 10;
```

---

## 4. Index Types (IVFFlat vs HNSW)

### IVFFlat (Inverted File with Flat Compression)

```sql
-- Partitions vectors into lists, searches nearest lists
CREATE INDEX idx_documents_embedding_ivf ON documents
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Operator classes:
-- vector_cosine_ops   for <=> (cosine distance)
-- vector_l2_ops       for <-> (L2 distance)
-- vector_ip_ops       for <#> (inner product)
```

**IVFFlat characteristics:**
- Build time: fast (single pass)
- Query time: good (searches `probes` lists out of total)
- Recall: depends on `probes` setting
- Must build AFTER data is loaded (empty table = bad index)
- Cheaper to build than HNSW

### HNSW (Hierarchical Navigable Small World)

```sql
-- Graph-based index, better recall, more expensive to build
CREATE INDEX idx_documents_embedding_hnsw ON documents
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

**HNSW characteristics:**
- Build time: slow (graph construction, O(N log N))
- Query time: fast
- Recall: excellent (usually better than IVFFlat)
- Works well even with incremental inserts (no need to rebuild)
- Higher memory usage

### Decision Matrix

| Factor | IVFFlat | HNSW |
|---|---|---|
| Build speed | Fast | Slow (2-10x) |
| Query speed | Good | Better |
| Recall at same speed | Lower | Higher |
| Incremental inserts | Poor (needs rebuild) | Good |
| Memory usage | Lower | Higher |
| Best for | Bulk-loaded, rarely changing data | Live data, frequent inserts |
| **Recommendation** | Batch/ETL workflows | **Default choice for most apps** |

---

## 5. Index Tuning

### IVFFlat Tuning

```sql
-- lists: number of partitions (clusters)
-- Rule of thumb: rows < 1M → lists = rows / 1000
--                rows > 1M → lists = sqrt(rows)
-- 100K rows → lists = 100
-- 1M rows → lists = 1000

-- probes: how many lists to search at query time (higher = better recall, slower)
SET ivfflat.probes = 10;  -- default is 1 (too low!)
-- Start with probes = sqrt(lists), tune from there

-- WRONG: building IVFFlat on empty table
CREATE INDEX idx_embed ON documents USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);  -- with 0 rows, all lists are empty

-- CORRECT: load data FIRST, then create index
-- INSERT all your data...
-- THEN:
CREATE INDEX idx_embed ON documents USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

### HNSW Tuning

```sql
-- m: number of connections per node (higher = better recall, more memory)
-- Default: 16. Range: 2-100. Start with 16, increase to 32-64 for better recall.

-- ef_construction: search depth during build (higher = better recall, slower build)
-- Default: 64. Range: 4-1000. Start with 64, increase to 128-256 for better recall.

CREATE INDEX idx_embed_hnsw ON documents
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);

-- ef_search: search depth at query time
SET hnsw.ef_search = 100;  -- default is 40
-- Higher = better recall, slower queries
-- Rule: ef_search >= k (where k is your LIMIT)
```

### Benchmarking Recall

```sql
-- Compare exact search vs approximate (index) search
-- Step 1: exact search (brute force, no index)
SET enable_indexscan = off;
SELECT id FROM documents
ORDER BY embedding <=> '[...]'::vector
LIMIT 10;

-- Step 2: approximate search (with index)
SET enable_indexscan = on;
SELECT id FROM documents
ORDER BY embedding <=> '[...]'::vector
LIMIT 10;

-- Compare the two result sets. Overlap = recall.
-- If 9 out of 10 match: 90% recall.
```

---

## 6. Hybrid Search

### Vector + Full-Text Search with RRF (Reciprocal Rank Fusion)

```sql
-- Combine semantic search (vector) with keyword search (FTS) for better results

-- Step 1: Get vector search results with rank
WITH vector_results AS (
    SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY embedding <=> query_embedding) AS vector_rank
    FROM documents
    WHERE embedding <=> query_embedding < 1.0
    ORDER BY embedding <=> query_embedding
    LIMIT 20
),
-- Step 2: Get full-text search results with rank
fts_results AS (
    SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY ts_rank(search_vector, query) DESC) AS fts_rank
    FROM documents, to_tsquery('portuguese', 'postgresql & otimizacao') AS query
    WHERE search_vector @@ query
    ORDER BY ts_rank(search_vector, query) DESC
    LIMIT 20
),
-- Step 3: Reciprocal Rank Fusion (RRF)
combined AS (
    SELECT
        COALESCE(v.id, f.id) AS id,
        -- RRF formula: 1/(k+rank) — k=60 is standard
        COALESCE(1.0 / (60 + v.vector_rank), 0) +
        COALESCE(1.0 / (60 + f.fts_rank), 0) AS rrf_score
    FROM vector_results v
    FULL OUTER JOIN fts_results f ON v.id = f.id
)
SELECT d.id, d.title, c.rrf_score
FROM combined c
JOIN documents d ON d.id = c.id
ORDER BY c.rrf_score DESC
LIMIT 10;
```

### Weighted Hybrid

```sql
-- Weight vector vs keyword (e.g., 70% semantic, 30% keyword)
SELECT
    COALESCE(v.id, f.id) AS id,
    0.7 * COALESCE(1.0 / (60 + v.vector_rank), 0) +
    0.3 * COALESCE(1.0 / (60 + f.fts_rank), 0) AS score
FROM vector_results v
FULL OUTER JOIN fts_results f ON v.id = f.id
ORDER BY score DESC
LIMIT 10;
```

---

## 7. Filtering with Vector Search

### Pre-Filtering (WHERE + ORDER BY vector)

```sql
-- Filter first, then sort by vector distance
SELECT id, title, embedding <=> query_embedding AS distance
FROM documents
WHERE metadata->>'source' = 'documentation'
  AND created_at > NOW() - INTERVAL '30 days'
ORDER BY embedding <=> query_embedding
LIMIT 10;
```

```sql
-- PROBLEM: with IVFFlat, pre-filtering can reduce recall
-- The index searches lists, but filtering removes candidates AFTER list search
-- If most rows are filtered out, you might get fewer than LIMIT results

-- Fix: increase probes
SET ivfflat.probes = 20;  -- search more lists to compensate for filtering

-- Or use HNSW (better behavior with filters)
```

### Partial Index for Common Filters

```sql
-- If you always filter by tenant_id, create a partial vector index
-- (Not supported yet as of pgvector 0.7.x)

-- Workaround: partition table by tenant, each partition gets its own index
CREATE TABLE documents (
    id BIGSERIAL,
    tenant_id INTEGER NOT NULL,
    embedding vector(1536),
    content TEXT NOT NULL
) PARTITION BY LIST (tenant_id);

CREATE TABLE documents_tenant_1 PARTITION OF documents FOR VALUES IN (1);
CREATE TABLE documents_tenant_2 PARTITION OF documents FOR VALUES IN (2);

-- Each partition gets its own HNSW index
CREATE INDEX ON documents_tenant_1 USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON documents_tenant_2 USING hnsw (embedding vector_cosine_ops);
```

---

## 8. Embedding Dimensions and Models

### Common Models and Dimensions

```sql
-- Model                              | Dimensions | Use Case
-- -----------------------------------|------------|---------------------------
-- OpenAI text-embedding-3-small      | 1536       | General purpose, cost-effective
-- OpenAI text-embedding-3-large      | 3072       | Higher quality, higher cost
-- OpenAI text-embedding-3-small (dim)| 256-1536   | Matryoshka: reduce dims at query time
-- Cohere embed-v4                    | 1024       | Multilingual, good for search
-- Voyage voyage-3                    | 1024       | Code and technical content
-- BGE / Nomic (open source)          | 384-768    | Self-hosted, free

-- Dimension impact:
-- Fewer dimensions → smaller storage, faster search, slightly lower quality
-- More dimensions → better quality, larger storage, slower search
```

### Matryoshka Embeddings (Dimension Reduction)

```sql
-- OpenAI text-embedding-3 supports dimension reduction
-- Request 1536-dim embedding, store only first 256 dims

-- Store reduced embeddings for fast initial search
CREATE TABLE documents (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding_256 vector(256),    -- reduced: fast initial search
    embedding_1536 vector(1536)   -- full: for reranking
);

-- Two-phase search: fast filter with 256d, rerank with 1536d
WITH candidates AS (
    SELECT id, embedding_1536
    FROM documents
    ORDER BY embedding_256 <=> query_256
    LIMIT 100
)
SELECT id
FROM candidates
ORDER BY embedding_1536 <=> query_1536
LIMIT 10;
```

### Storage Calculations

```sql
-- vector(1536) = 1536 * 4 bytes (float32) + 8 bytes overhead = ~6.1 KB per row
-- 1 million rows * 6.1 KB = ~5.8 GB just for embeddings
-- Plus HNSW index ≈ 1.5-2x data size

-- With vector(256): ~1 KB per row → ~1 GB for 1M rows
-- Significant savings at scale
```

---

## 9. Performance and Scaling

### When pgvector Is Enough

```
Dataset size        | pgvector performance
--------------------|---------------------
< 100K vectors      | Excellent, no issues
100K - 1M vectors   | Good with HNSW, proper tuning
1M - 10M vectors    | Possible, needs careful tuning, partitioning
> 10M vectors       | Consider dedicated vector DB (Qdrant, Pinecone)
```

### Performance Tips

```sql
-- 1. Use HNSW for live data, IVFFlat for bulk-loaded static data

-- 2. Reduce dimensions if possible
-- 1536 → 512 dims: ~3x faster search, minimal recall loss

-- 3. Use shared_buffers large enough to hold the index in memory
-- SHOW shared_buffers;
-- If HNSW index is 4GB, shared_buffers should be at least 6-8GB

-- 4. Increase maintenance_work_mem for index creation
SET maintenance_work_mem = '2GB';
CREATE INDEX ... USING hnsw ...;

-- 5. Parallel index build (PG 11+)
SET max_parallel_maintenance_workers = 4;
CREATE INDEX ... USING hnsw ...;
```

### pgvector vs Dedicated Vector DB

```
Feature             | pgvector           | Qdrant / Pinecone
--------------------|--------------------|--------------------------
Setup complexity    | Low (just an ext)  | Separate service
Transactional       | Yes (ACID)         | No (eventual consistency)
JOIN with other data| Yes (same DB)      | No (separate queries)
Filtering           | SQL WHERE          | Payload filtering
Scale               | ~10M vectors       | Billions
Advanced features   | Basic              | Reranking, quantization, sharding
Cost                | Free (in your PG)  | Pay per usage/hosting
```

**Recommendation:** Start with pgvector. Move to Qdrant only when you need >10M vectors or advanced features (quantization, distributed sharding).

---

## 10. Integration with Laravel

### Using pgvector with Laravel

```php
// Migration: add vector column
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        DB::statement('CREATE EXTENSION IF NOT EXISTS vector');

        Schema::create('documents', function (Blueprint $table) {
            $table->id();
            $table->text('content');
            $table->jsonb('metadata')->default('{}');
            $table->timestamps();
        });

        // Add vector column (not supported natively by Blueprint yet)
        DB::statement('ALTER TABLE documents ADD COLUMN embedding vector(1536)');

        // Add HNSW index
        DB::statement('CREATE INDEX idx_documents_embedding ON documents USING hnsw (embedding vector_cosine_ops)');
    }
};
```

### Vector Search in Laravel

```php
// Raw query for vector similarity search
$results = DB::select("
    SELECT id, title, content,
           embedding <=> ?::vector AS distance
    FROM documents
    WHERE metadata->>'tenant_id' = ?
    ORDER BY embedding <=> ?::vector
    LIMIT ?
", [$queryEmbedding, $tenantId, $queryEmbedding, 10]);

// Using Eloquent with whereRaw
$documents = Document::whereRaw("metadata->>'category' = ?", ['tech'])
    ->orderByRaw("embedding <=> ?::vector", [$queryEmbedding])
    ->limit(10)
    ->get();
```

### Laravel with pgvector Package

```php
// Using pgvector-php/pgvector (community package)
// composer require pgvector/pgvector

use Pgvector\Laravel\Vector;
use Pgvector\Laravel\HasNeighbors;

class Document extends Model
{
    use HasNeighbors;

    protected $casts = [
        'embedding' => Vector::class,
    ];
}

// Search
$embedding = getEmbeddingFromOpenAI($query);  // returns array of floats
$documents = Document::query()
    ->nearestNeighbors('embedding', $embedding, Distance::Cosine)
    ->limit(10)
    ->get();
```

---

## 11. RAG Pipeline

### The Flow

```
User Query
    │
    ▼
1. EMBED ──── Convert query to vector using same model as documents
    │
    ▼
2. SEARCH ─── Vector similarity search (+ keyword hybrid)
    │
    ▼
3. FILTER ─── Post-filter by metadata, deduplicate, threshold
    │
    ▼
4. RERANK ─── (Optional) Rerank with cross-encoder for better ordering
    │
    ▼
5. INJECT ─── Insert top-K chunks into LLM prompt as context
    │
    ▼
6. GENERATE ─ LLM generates answer using the retrieved context
```

### Chunking Strategies

```sql
-- Store chunks, not full documents
CREATE TABLE chunks (
    id BIGSERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,      -- position in document
    content TEXT NOT NULL,              -- the chunk text
    embedding vector(1536),
    token_count INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}',       -- section, page, heading
    UNIQUE (document_id, chunk_index)
);
CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_document ON chunks(document_id);
```

```sql
-- Chunk sizing rules of thumb:
-- 256-512 tokens: good for specific Q&A (precise retrieval)
-- 512-1024 tokens: good for general RAG (more context per chunk)
-- Overlap: 50-100 tokens between chunks (prevent losing context at boundaries)
```

### Search + Rerank Pattern

```sql
-- Step 1: retrieve top-50 candidates (fast, approximate)
WITH candidates AS (
    SELECT id, content, metadata,
           embedding <=> $1::vector AS distance
    FROM chunks
    WHERE document_id = ANY($2)  -- filter by allowed documents
    ORDER BY embedding <=> $1::vector
    LIMIT 50
)
-- Step 2: return to application for reranking
SELECT * FROM candidates;

-- In application code:
-- $reranked = $reranker->rerank($query, $candidates);  // Cohere rerank, cross-encoder
-- $top10 = array_slice($reranked, 0, 10);
-- $context = implode("\n\n", array_column($top10, 'content'));
-- $response = $llm->chat("Answer based on this context: $context\n\nQuestion: $query");
```

### Context Window Assembly

```sql
-- Get chunks with surrounding context (prev/next chunks)
SELECT
    c.content,
    prev.content AS prev_context,
    next.content AS next_context
FROM chunks c
LEFT JOIN chunks prev ON prev.document_id = c.document_id
    AND prev.chunk_index = c.chunk_index - 1
LEFT JOIN chunks next ON next.document_id = c.document_id
    AND next.chunk_index = c.chunk_index + 1
WHERE c.id = ANY($1)
ORDER BY c.document_id, c.chunk_index;
```

---

## 12. Maintenance

### Reindex After Large Inserts

```sql
-- IVFFlat: rebuild after significant data changes (>20% growth)
REINDEX INDEX idx_documents_embedding_ivf;

-- Or drop and recreate (can use CONCURRENTLY for HNSW in pg17+)
DROP INDEX idx_documents_embedding_ivf;
CREATE INDEX idx_documents_embedding_ivf ON documents
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 200);  -- adjust lists for new data size
```

### VACUUM for Vector Tables

```sql
-- Vector tables need VACUUM like any other table
-- Especially important after bulk deletes/updates

VACUUM ANALYZE documents;

-- Aggressive autovacuum settings for high-churn vector tables
ALTER TABLE chunks SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);
```

### Monitoring Index Health

```sql
-- Check index size
SELECT pg_size_pretty(pg_relation_size('idx_documents_embedding_hnsw')) AS index_size;

-- Check if index is being used
SELECT
    indexrelname,
    idx_scan,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE indexrelname LIKE '%embedding%';
```

---

## 13. Migration from/to Qdrant

### Export from pgvector to Qdrant

```sql
-- Export embeddings as JSON
COPY (
    SELECT
        id,
        embedding::text AS vector,
        jsonb_build_object(
            'title', title,
            'content', LEFT(content, 500),
            'created_at', created_at
        ) AS payload
    FROM documents
) TO '/tmp/documents_export.jsonl';
```

```python
# Python script to import into Qdrant
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance, PointStruct
import json

client = QdrantClient(host="localhost", port=6333)

client.create_collection(
    collection_name="documents",
    vectors_config=VectorParams(size=1536, distance=Distance.COSINE)
)

# Batch upload
points = []
with open("/tmp/documents_export.jsonl") as f:
    for line in f:
        row = json.loads(line)
        points.append(PointStruct(
            id=row["id"],
            vector=json.loads(row["vector"]),
            payload=row["payload"]
        ))
        if len(points) >= 100:
            client.upsert(collection_name="documents", points=points)
            points = []
```

### Import from Qdrant to pgvector

```python
# Export from Qdrant
from qdrant_client import QdrantClient
import psycopg2
import numpy as np

qdrant = QdrantClient(host="localhost", port=6333)
pg = psycopg2.connect("postgresql://user:pass@localhost/mydb")
cur = pg.cursor()

# Scroll through all points
offset = None
while True:
    results, offset = qdrant.scroll(
        collection_name="documents",
        limit=100,
        offset=offset,
        with_vectors=True
    )
    if not results:
        break

    for point in results:
        cur.execute(
            "INSERT INTO documents (id, embedding, metadata) VALUES (%s, %s::vector, %s)",
            [point.id, str(point.vector), json.dumps(point.payload)]
        )

    pg.commit()
    if offset is None:
        break
```

### When to Migrate

```
Stay with pgvector when:
- < 5M vectors
- Need ACID transactions
- Need JOINs with relational data
- Simple deployment (one database)
- Budget-conscious (no extra service)

Move to Qdrant when:
- > 10M vectors
- Need advanced features (quantization, sharding, multi-vector)
- Need sub-10ms latency at scale
- Can afford operational complexity of a separate service
- Need payload indexing with complex filters
```
