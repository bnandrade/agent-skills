# Performance

Frontend performance optimization for production web applications. Core Web Vitals, bundle optimization, image/font loading, virtualization, framework-specific patterns, and caching strategies.

---

## Table of Contents

1. [Core Web Vitals](#1-core-web-vitals)
2. [Bundle Optimization](#2-bundle-optimization)
3. [Vite Optimization](#3-vite-optimization)
4. [Image Optimization](#4-image-optimization)
5. [Font Optimization](#5-font-optimization)
6. [Virtualization for Long Lists](#6-virtualization-for-long-lists)
7. [React Performance](#7-react-performance)
8. [Vue Performance](#8-vue-performance)
9. [SSR vs SSG vs ISR](#9-ssr-vs-ssg-vs-isr)
10. [Caching Strategies](#10-caching-strategies)
11. [Lighthouse Audit Workflow](#11-lighthouse-audit-workflow)
12. [Common Performance Anti-Patterns](#12-common-performance-anti-patterns)
13. [Bundle Analysis Tools](#13-bundle-analysis-tools)

---

## 1. Core Web Vitals

Three metrics that Google uses for ranking and that directly correlate with user experience.

### 1.1 LCP (Largest Contentful Paint)

**What it measures:** Time until the largest visible element (image, heading, text block) finishes rendering.

**Target:** < 2.5 seconds

```tsx
// WRONG: hero image blocks LCP
<img src="/hero.jpg" alt="Hero" />
// Browser discovers image only after HTML parses, then fetches it

// CORRECT: preload the LCP image
// In <head>:
<link rel="preload" as="image" href="/hero.webp" fetchpriority="high" />

// In component — set fetchpriority and avoid lazy loading
<img
  src="/hero.webp"
  alt="Hero"
  fetchPriority="high"
  decoding="async"
  width={1200}
  height={600}
/>
// Never lazy-load the LCP element

// CORRECT: inline critical CSS for above-the-fold content
// Vite does this automatically with the build — ensure critical styles aren't code-split
```

**Common LCP killers:**
- Large unoptimized hero images
- Web fonts blocking text render (FOIT)
- Client-side rendering of above-the-fold content
- Render-blocking CSS/JS in `<head>`
- Redirect chains before the page loads

### 1.2 INP (Interaction to Next Paint)

**What it measures:** Latency from user input (click, tap, key) to the next visual frame update. Replaced FID in March 2024.

**Target:** < 200ms

```tsx
// WRONG: heavy synchronous work in event handler blocks the main thread
function SearchPage() {
  const handleSearch = (query: string) => {
    const results = items.filter((item) => {
      // Expensive: regex match on 10,000 items synchronously
      return new RegExp(query, "i").test(item.title + item.description);
    });
    setResults(results);
  };

  return <input onChange={(e) => handleSearch(e.target.value)} />;
}

// CORRECT: debounce + move work off main thread when needed
function SearchPage() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  // React defers re-render of expensive list, keeping input responsive
  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <SearchResults query={deferredQuery} items={items} />
    </>
  );
}

// For truly heavy computation: Web Worker
const worker = new Worker(new URL("./search.worker.ts", import.meta.url), {
  type: "module",
});
```

**Common INP killers:**
- Long tasks (>50ms) on main thread during interaction
- Synchronous layout recalculation after DOM changes
- Large React/Vue component trees re-rendering on every keystroke
- Third-party scripts (analytics, ads) blocking main thread

### 1.3 CLS (Cumulative Layout Shift)

**What it measures:** Visual stability — how much content shifts unexpectedly during page load.

**Target:** < 0.1

```tsx
// WRONG: image without dimensions causes layout shift
<img src={user.avatar} alt={user.name} />
// Browser doesn't know size until image loads → content jumps

// CORRECT: always set width and height (or aspect-ratio)
<img
  src={user.avatar}
  alt={user.name}
  width={48}
  height={48}
  className="h-12 w-12 rounded-full object-cover"
/>

// CORRECT: aspect-ratio for responsive images
<div className="aspect-video overflow-hidden rounded-lg">
  <img
    src={video.thumbnail}
    alt={video.title}
    className="h-full w-full object-cover"
    loading="lazy"
  />
</div>

// WRONG: dynamically injected content above existing content
function Banner() {
  const { data: banner } = useQuery({ queryKey: ["banner"], queryFn: fetchBanner });
  if (!banner) return null; // null → banner → layout shift
  return <div className="bg-yellow-100 p-4">{banner.text}</div>;
}

// CORRECT: reserve space even while loading
function Banner() {
  const { data: banner, isLoading } = useQuery({ queryKey: ["banner"], queryFn: fetchBanner });
  if (!banner && !isLoading) return null;
  return (
    <div className="min-h-[52px] bg-yellow-100 p-4">
      {isLoading ? <Skeleton className="h-5 w-3/4" /> : banner.text}
    </div>
  );
}
```

**Common CLS killers:**
- Images/iframes without explicit dimensions
- Dynamic content injected above existing content (banners, cookie notices)
- Web fonts causing text size change (FOUT)
- Ads/embeds without reserved space

---

## 2. Bundle Optimization

### 2.1 Code Splitting

```tsx
// WRONG: importing everything eagerly
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { AdminPanel } from "./pages/AdminPanel";
import { AnalyticsChart } from "./components/AnalyticsChart";

// CORRECT: route-level code splitting with lazy
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Settings = lazy(() => import("./pages/Settings"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));

function App() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<AdminPanel />} />
      </Routes>
    </Suspense>
  );
}

// Component-level code splitting for heavy components
const AnalyticsChart = lazy(() => import("./components/AnalyticsChart"));

function DashboardPage() {
  return (
    <div>
      <StatsCards />
      <Suspense fallback={<ChartSkeleton />}>
        <AnalyticsChart />
      </Suspense>
    </div>
  );
}
```

### 2.2 Dynamic Imports

```tsx
// WRONG: importing heavy library at module level
import { format, parseISO, differenceInDays } from "date-fns";
// date-fns is tree-shakeable, but if you use many functions, bundle grows

// CORRECT: dynamic import for features used on interaction
async function exportToCsv(data: Record<string, unknown>[]) {
  const { unparse } = await import("papaparse");
  const csv = unparse(data);
  downloadBlob(csv, "export.csv", "text/csv");
}

// CORRECT: dynamic import for locale data
async function loadDateLocale(locale: string) {
  const localeModule = await import(`date-fns/locale/${locale}`);
  return localeModule.default;
}
```

### 2.3 Tree Shaking

```tsx
// WRONG: barrel exports defeat tree shaking in some bundlers
// utils/index.ts
export * from "./string";     // 50 functions
export * from "./date";       // 30 functions
export * from "./validation"; // 40 functions

// Importing one function may pull in all 120 if bundler can't analyze side effects

// CORRECT: import directly from the module
import { formatCurrency } from "@/utils/string";

// CORRECT: if using barrel exports, ensure all modules are side-effect-free
// package.json
{
  "sideEffects": false
}

// Or mark specific files with side effects
{
  "sideEffects": ["*.css", "src/polyfills.ts"]
}
```

---

## 3. Vite Optimization

### 3.1 Chunk Strategy

```typescript
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Group vendor libraries into logical chunks
          "react-vendor": ["react", "react-dom", "react-router"],
          "query": ["@tanstack/react-query"],
          "ui": ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu",
                 "@radix-ui/react-tooltip"],
        },
      },
    },
    // Target modern browsers — smaller output
    target: "es2022",
    // Generate source maps for production debugging
    sourcemap: true,
    // Warn on large chunks
    chunkSizeWarningLimit: 250,
  },
});
```

### 3.2 Preloading Critical Chunks

```typescript
// Vite automatically generates modulepreload for entry chunks
// For route-level chunks, use router preloading

// React Router: preload on hover/focus
<Link to="/dashboard" unstable_viewTransition prefetch="intent">
  Dashboard
</Link>

// Manual preload hint for known next-page
function preloadDashboard() {
  import("./pages/Dashboard");
}

// Preload on mouse enter (user likely to click)
<button
  onMouseEnter={preloadDashboard}
  onClick={() => navigate("/dashboard")}
>
  Go to Dashboard
</button>
```

### 3.3 Dependency Pre-Bundling

```typescript
// vite.config.ts
export default defineConfig({
  optimizeDeps: {
    // Force include dependencies that Vite might miss
    include: [
      "react",
      "react-dom",
      "@tanstack/react-query",
      "date-fns",
      "zod",
    ],
    // Exclude if causing issues (rarely needed)
    exclude: ["@my-org/local-package"],
  },
});
```

---

## 4. Image Optimization

### 4.1 Format Selection

```
Use case                  | Format    | Notes
--------------------------|-----------|------
Photos                    | AVIF/WebP | AVIF is 20% smaller than WebP, 50% smaller than JPEG
Icons/logos (few colors)  | SVG       | Scalable, tiny file size
Screenshots/text images   | WebP/PNG  | WebP for web, PNG if transparency needed
Animated content          | WebP/AVIF | Replace GIFs (10x smaller)
```

### 4.2 Responsive Images

```tsx
// WRONG: single large image for all devices
<img src="/photos/hero-3000w.jpg" alt="Hero" />

// CORRECT: srcset with multiple sizes
<img
  src="/photos/hero-800w.webp"
  srcSet="
    /photos/hero-400w.webp 400w,
    /photos/hero-800w.webp 800w,
    /photos/hero-1200w.webp 1200w,
    /photos/hero-2400w.webp 2400w
  "
  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 75vw, 50vw"
  alt="Hero image"
  width={1200}
  height={600}
  loading="lazy"
  decoding="async"
/>

// CORRECT: <picture> for format fallbacks
<picture>
  <source srcSet="/photos/hero.avif" type="image/avif" />
  <source srcSet="/photos/hero.webp" type="image/webp" />
  <img src="/photos/hero.jpg" alt="Hero" width={1200} height={600} />
</picture>
```

### 4.3 Next.js Image Component

```tsx
import Image from "next/image";

// WRONG: using regular img in Next.js
<img src="/photo.jpg" alt="Product" />

// CORRECT: next/image handles optimization, formats, lazy loading, sizing
<Image
  src="/photo.jpg"
  alt="Product"
  width={600}
  height={400}
  placeholder="blur"
  blurDataURL={product.blurHash}
  sizes="(max-width: 768px) 100vw, 50vw"
/>

// Fill mode for unknown/dynamic dimensions
<div className="relative aspect-video">
  <Image
    src={post.coverImage}
    alt={post.title}
    fill
    className="object-cover rounded-lg"
    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
  />
</div>

// Priority for LCP images (disables lazy loading)
<Image src="/hero.jpg" alt="Hero" width={1200} height={600} priority />
```

### 4.4 Lazy Loading

```tsx
// WRONG: lazy loading above-the-fold images (hurts LCP)
<img src="/hero.jpg" loading="lazy" alt="Hero" />

// CORRECT: eager for above-fold, lazy for below-fold
// Above fold:
<img src="/hero.jpg" alt="Hero" fetchPriority="high" decoding="async" />

// Below fold (user must scroll to see):
<img src="/product.jpg" alt="Product" loading="lazy" decoding="async" width={400} height={300} />

// Native lazy loading is sufficient in 2026 — no JS library needed
```

---

## 5. Font Optimization

### 5.1 Self-Hosting Fonts

```tsx
// WRONG: loading from Google Fonts CDN (extra DNS lookup, GDPR issues)
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700" rel="stylesheet" />

// CORRECT: self-host with preload
// Download font files, place in /public/fonts/

// In <head>:
<link
  rel="preload"
  href="/fonts/inter-latin-var.woff2"
  as="font"
  type="font/woff2"
  crossOrigin="anonymous"
/>
```

### 5.2 Font Display Strategy

```css
/* WRONG: default behavior (FOIT — invisible text until font loads) */
@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-var.woff2") format("woff2");
}

/* CORRECT: font-display: swap (show fallback immediately, swap when loaded) */
@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-var.woff2") format("woff2");
  font-display: swap;
  font-weight: 100 900;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC;
}

/* BEST for body text: font-display: optional
   Uses font only if already cached — zero layout shift, zero FOIT */
@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-var.woff2") format("woff2");
  font-display: optional;
  font-weight: 100 900;
}
```

### 5.3 Subsetting

```bash
# Subset fonts to only include characters you use
# Install: pip install fonttools brotli
pyftsubset Inter-Regular.ttf \
  --output-file=Inter-Regular-Latin.woff2 \
  --flavor=woff2 \
  --layout-features="kern,liga" \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
# Full Inter: ~300KB → Latin subset: ~30KB
```

### 5.4 Variable Fonts

```css
/* WRONG: loading separate files for each weight */
@font-face { font-family: "Inter"; font-weight: 400; src: url("/fonts/Inter-Regular.woff2"); }
@font-face { font-family: "Inter"; font-weight: 500; src: url("/fonts/Inter-Medium.woff2"); }
@font-face { font-family: "Inter"; font-weight: 600; src: url("/fonts/Inter-SemiBold.woff2"); }
@font-face { font-family: "Inter"; font-weight: 700; src: url("/fonts/Inter-Bold.woff2"); }
/* 4 files × ~25KB = ~100KB */

/* CORRECT: single variable font file */
@font-face {
  font-family: "Inter";
  src: url("/fonts/Inter-Variable-Latin.woff2") format("woff2");
  font-display: swap;
  font-weight: 100 900;
}
/* 1 file ~45KB — covers ALL weights */
```

---

## 6. Virtualization for Long Lists

### 6.1 TanStack Virtual

```tsx
// WRONG: rendering thousands of DOM nodes
function UserList({ users }: { users: User[] }) {
  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}><UserCard user={user} /></li>
      ))}
    </ul>
  );
}
// 5,000 users = 5,000 DOM nodes, massive memory usage, slow scroll

// CORRECT: virtualize — only render visible items
import { useVirtualizer } from "@tanstack/react-virtual";

function VirtualUserList({ users }: { users: User[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: users.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72, // estimated row height in px
    overscan: 5, // render 5 extra items above/below viewport
  });

  return (
    <div ref={parentRef} className="h-[600px] overflow-auto">
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const user = users[virtualItem.index];
          return (
            <div
              key={user.id}
              className="absolute left-0 top-0 w-full"
              style={{
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <UserCard user={user} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
// 5,000 users = ~20 DOM nodes visible at once
```

### 6.2 Variable Size Items

```tsx
function VirtualMessageList({ messages }: { messages: Message[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
    // Enable dynamic measurement for variable-height items
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualItem.start}px)` }}
          >
            <MessageBubble message={messages[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 6.3 Virtual Grid

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

function VirtualProductGrid({ products }: { products: Product[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const columns = 4;
  const rowCount = Math.ceil(products.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 320,
    overscan: 2,
  });

  return (
    <div ref={parentRef} className="h-[800px] overflow-auto">
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            className="absolute left-0 top-0 grid w-full grid-cols-4 gap-4"
            style={{
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {Array.from({ length: columns }).map((_, colIndex) => {
              const product = products[virtualRow.index * columns + colIndex];
              if (!product) return <div key={colIndex} />;
              return <ProductCard key={product.id} product={product} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 7. React Performance

### 7.1 React Compiler (React 19+)

```tsx
// React Compiler v1 is stable in 2026 — handles memoization automatically.
// You generally DO NOT need manual memo(), useMemo(), or useCallback().

// WRONG: unnecessary manual memoization (React Compiler handles this)
const MemoizedCard = memo(function Card({ user }: { user: User }) {
  return <div>{user.name}</div>;
});

const handleClick = useCallback(() => {
  doSomething(id);
}, [id]);

const sorted = useMemo(() => {
  return items.sort((a, b) => a.name.localeCompare(b.name));
}, [items]);

// CORRECT: write plain code — React Compiler optimizes it
function Card({ user }: { user: User }) {
  return <div>{user.name}</div>;
}

function UserList({ items }: { items: User[] }) {
  const handleClick = () => doSomething(id);
  const sorted = items.toSorted((a, b) => a.name.localeCompare(b.name));

  return (
    <ul>
      {sorted.map((user) => (
        <li key={user.id} onClick={handleClick}>
          <Card user={user} />
        </li>
      ))}
    </ul>
  );
}
```

### 7.2 When You Still Need Manual Optimization

```tsx
// 1. Components using refs that React Compiler can't analyze
// 2. Third-party library integration requiring stable references
// 3. Very expensive computation (>10ms) — verify with profiler first

// Expensive computation: use useMemo only when measured as slow
function DataVisualization({ rawData }: { rawData: DataPoint[] }) {
  // Only if this computation is measurably slow (>16ms)
  const processed = useMemo(() => {
    return rawData
      .filter((d) => d.value > 0)
      .map(normalize)
      .reduce(aggregate, initialState);
  }, [rawData]);

  return <Chart data={processed} />;
}
```

### 7.3 Avoiding Unnecessary Re-Renders

```tsx
// WRONG: creating objects/arrays in render — new reference every render
function ParentComponent() {
  return (
    <ChildComponent
      style={{ color: "red", fontSize: 14 }}
      items={["a", "b", "c"]}
      config={{ theme: "dark" }}
    />
  );
}
// React Compiler handles this! But if NOT using React Compiler:

// CORRECT (without React Compiler): hoist constants
const style = { color: "red", fontSize: 14 };
const items = ["a", "b", "c"];
const config = { theme: "dark" };

function ParentComponent() {
  return <ChildComponent style={style} items={items} config={config} />;
}
```

### 7.4 useDeferredValue for Expensive Renders

```tsx
// Keeps UI responsive while expensive component re-renders in background
function SearchableList({ items }: { items: Item[] }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;

  return (
    <div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className={isStale ? "opacity-60" : ""}>
        <FilteredList items={items} query={deferredQuery} />
      </div>
    </div>
  );
}
```

---

## 8. Vue Performance

### 8.1 Vapor Mode (Experimental)

```vue
<!-- Vue Vapor mode compiles templates to direct DOM operations — no virtual DOM.
     Enable per-component for performance-critical views. -->

<!-- vite.config.ts -->
<!-- import { defineConfig } from "vite";
     import vue from "@vitejs/plugin-vue";
     export default defineConfig({
       plugins: [vue({ vapor: true })],  // enable globally
     }); -->

<!-- Or per-component: -->
<script setup lang="ts" vapor>
// This component compiles without virtual DOM overhead
import { ref } from "vue";

const count = ref(0);
const increment = () => count.value++;
</script>

<template>
  <button @click="increment">Count: {{ count }}</button>
</template>
```

### 8.2 v-once and v-memo

```vue
<script setup lang="ts">
import { ref } from "vue";

const items = ref<Item[]>([]);
const selectedId = ref<string | null>(null);
</script>

<template>
  <!-- WRONG: re-renders static content on every update -->
  <header>
    <h1>{{ appTitle }}</h1>
    <p>{{ appDescription }}</p>
    <nav><!-- static nav links --></nav>
  </header>

  <!-- CORRECT: v-once for truly static content -->
  <header v-once>
    <h1>{{ appTitle }}</h1>
    <p>{{ appDescription }}</p>
    <nav><!-- static nav links --></nav>
  </header>

  <!-- CORRECT: v-memo to skip re-render unless dependencies change -->
  <div v-for="item in items" :key="item.id" v-memo="[item.id === selectedId]">
    <ItemCard :item="item" :selected="item.id === selectedId" />
  </div>
  <!-- Only re-renders when selection state changes for that specific item -->
</template>
```

### 8.3 shallowRef and shallowReactive

```vue
<script setup lang="ts">
import { shallowRef, triggerRef } from "vue";

// WRONG: deeply reactive large data set — Vue wraps every nested object in Proxy
const largeDataset = ref<DataPoint[]>(fetchedData); // 10,000 objects, each with nested props

// CORRECT: shallow reactivity for large data — only top-level is reactive
const largeDataset = shallowRef<DataPoint[]>(fetchedData);

// To trigger update after mutation:
function updatePoint(index: number, value: number) {
  largeDataset.value[index].value = value;
  triggerRef(largeDataset); // manually trigger watchers
}

// Or replace the entire array (triggers automatically)
function setData(newData: DataPoint[]) {
  largeDataset.value = newData;
}
</script>
```

### 8.4 Async Components (Vue)

```vue
<script setup lang="ts">
import { defineAsyncComponent } from "vue";

// WRONG: eager import of heavy component
import HeavyChart from "@/components/HeavyChart.vue";

// CORRECT: lazy load with loading/error states
const HeavyChart = defineAsyncComponent({
  loader: () => import("@/components/HeavyChart.vue"),
  loadingComponent: () => import("@/components/ChartSkeleton.vue"),
  errorComponent: () => import("@/components/ChartError.vue"),
  delay: 200, // show loading after 200ms
  timeout: 10000,
});
</script>
```

---

## 9. SSR vs SSG vs ISR

### 9.1 When Each Makes Sense

```
Strategy  | Data freshness | Build time  | Best for
----------|---------------|-------------|----------
SSG       | Build-time    | Scales O(n) | Docs, blogs, marketing pages, portfolios
ISR       | Periodic      | Initial +   | Product pages, listings, content that changes
          | revalidation  | on-demand   | every minutes/hours
SSR       | Every request | N/A         | User-specific pages, real-time data,
          |               |             | dashboards, search results
CSR (SPA) | Client fetch  | N/A         | Authenticated apps, highly interactive UIs,
          |               |             | admin panels
```

### 9.2 Next.js Patterns

```tsx
// SSG — static at build time (default for pages without dynamic data)
export default function AboutPage() {
  return <div>About us</div>;
}

// SSG with data
async function BlogPost({ params }: { params: { slug: string } }) {
  const post = await getPost(params.slug); // runs at build time
  return <article>{post.content}</article>;
}

export async function generateStaticParams() {
  const posts = await getAllPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

// ISR — revalidate periodically
async function ProductPage({ params }: { params: { id: string } }) {
  const product = await getProduct(params.id);
  return <ProductDetail product={product} />;
}

// Revalidate this page every 60 seconds
export const revalidate = 60;

// SSR — fresh data on every request
async function SearchResults({ searchParams }: { searchParams: { q: string } }) {
  const results = await search(searchParams.q);
  return <ResultsList results={results} />;
}

// Force dynamic rendering
export const dynamic = "force-dynamic";
```

### 9.3 Nuxt Patterns

```vue
<!-- SSG: nuxt.config.ts → routeRules -->
<!-- export default defineNuxtConfig({
  routeRules: {
    "/": { prerender: true },
    "/blog/**": { prerender: true },
    "/products/**": { isr: 3600 },  // ISR: revalidate every hour
    "/dashboard/**": { ssr: true },  // SSR: fresh every request
    "/admin/**": { ssr: false },     // SPA: client-only
  },
}); -->

<!-- SSR with data (default in Nuxt) -->
<script setup lang="ts">
const { data: products } = await useFetch("/api/products");
</script>

<template>
  <div v-for="product in products" :key="product.id">
    {{ product.name }}
  </div>
</template>
```

---

## 10. Caching Strategies

### 10.1 TanStack Query Cache Configuration

```tsx
// WRONG: no cache configuration — refetches on every mount
const queryClient = new QueryClient();

// CORRECT: configure sensible defaults
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes before data is considered stale
      gcTime: 1000 * 60 * 30,   // 30 minutes before unused data is garbage collected
      refetchOnWindowFocus: true,
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    },
  },
});

// Per-query overrides
const { data: user } = useQuery({
  queryKey: ["user", "me"],
  queryFn: fetchCurrentUser,
  staleTime: 1000 * 60 * 15, // current user rarely changes — 15min
});

const { data: notifications } = useQuery({
  queryKey: ["notifications"],
  queryFn: fetchNotifications,
  staleTime: 1000 * 30, // check for new notifications every 30s
  refetchInterval: 1000 * 30,
});
```

### 10.2 HTTP Cache Headers

```
Resource type          | Cache-Control                          | Notes
-----------------------|----------------------------------------|------
Static assets (hashed) | max-age=31536000, immutable           | Vite adds hash to filenames
HTML pages             | no-cache                               | Always revalidate
API responses          | max-age=0, stale-while-revalidate=60  | Fresh + SWR
Images (CDN)           | max-age=86400, stale-while-revalidate=604800 | 1 day + 7 day SWR
```

### 10.3 Service Workers (Brief)

```typescript
// Use Vite PWA plugin for automatic service worker generation
// vite.config.ts
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\..*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-cache",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
});
```

---

## 11. Lighthouse Audit Workflow

### 11.1 Running Audits

```bash
# CLI audit (good for CI)
npx lighthouse http://localhost:5173 --output=html --output-path=./lighthouse-report.html

# Chrome DevTools: Lighthouse tab → analyze

# Programmatic in CI
npx lhci autorun --config=lighthouserc.json
```

### 11.2 Lighthouse CI Config

```json
{
  "ci": {
    "collect": {
      "url": ["http://localhost:5173/", "http://localhost:5173/products"],
      "numberOfRuns": 3,
      "startServerCommand": "npm run preview"
    },
    "assert": {
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.9 }],
        "categories:accessibility": ["error", { "minScore": 0.95 }],
        "categories:best-practices": ["error", { "minScore": 0.9 }],
        "first-contentful-paint": ["warn", { "maxNumericValue": 1500 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }]
      }
    }
  }
}
```

---

## 12. Common Performance Anti-Patterns

### 12.1 Layout Thrashing

```typescript
// WRONG: reading and writing layout properties alternately
function resizeCards(cards: HTMLElement[]) {
  cards.forEach((card) => {
    const height = card.offsetHeight;     // triggers layout read
    card.style.height = `${height + 20}px`; // triggers layout write
    // Next iteration: another read + write = thrashing
  });
}

// CORRECT: batch reads, then batch writes
function resizeCards(cards: HTMLElement[]) {
  // Read phase
  const heights = cards.map((card) => card.offsetHeight);

  // Write phase
  cards.forEach((card, i) => {
    card.style.height = `${heights[i] + 20}px`;
  });
}

// BEST: use CSS for this (no JS layout at all)
// .card { height: calc(var(--base-height) + 20px); }
```

### 12.2 Excessive Re-Renders

```tsx
// WRONG: new context value on every render
function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  // This object is recreated every render → all consumers re-render
  return (
    <AppContext.Provider value={{ user, setUser, isAdmin: user?.role === "admin" }}>
      {children}
    </AppContext.Provider>
  );
}

// CORRECT: split contexts by update frequency
const UserContext = createContext<User | null>(null);
const UserActionsContext = createContext<{ setUser: (u: User | null) => void }>({ setUser: () => {} });

function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const actions = useMemo(() => ({ setUser }), []);

  return (
    <UserActionsContext.Provider value={actions}>
      <UserContext.Provider value={user}>
        {children}
      </UserContext.Provider>
    </UserActionsContext.Provider>
  );
}
```

### 12.3 Unoptimized Third-Party Scripts

```tsx
// WRONG: loading analytics/chat synchronously in head
<script src="https://analytics.example.com/tracker.js"></script>

// CORRECT: defer or async, load after critical content
<script src="https://analytics.example.com/tracker.js" defer></script>

// BEST: load third-party scripts after page is interactive
useEffect(() => {
  // Load analytics after first paint
  const timer = setTimeout(() => {
    const script = document.createElement("script");
    script.src = "https://analytics.example.com/tracker.js";
    script.async = true;
    document.body.appendChild(script);
  }, 3000);
  return () => clearTimeout(timer);
}, []);

// Next.js: use Script component with strategy
import Script from "next/script";
<Script src="https://analytics.example.com/tracker.js" strategy="lazyOnload" />
```

### 12.4 Unoptimized Images

```tsx
// WRONG: serving original 4000×3000 JPEG from uploads
<img src="/uploads/photo-original.jpg" className="w-48 h-48 object-cover" />
// Downloading 3MB image to display in a 192px thumbnail

// CORRECT: serve appropriately sized, modern format
<img
  src="/uploads/photo-192w.webp"
  srcSet="/uploads/photo-192w.webp 1x, /uploads/photo-384w.webp 2x"
  alt="Thumbnail"
  className="w-48 h-48 object-cover"
  loading="lazy"
  width={192}
  height={192}
/>
// ~15KB instead of 3MB
```

---

## 13. Bundle Analysis Tools

### 13.1 vite-bundle-visualizer

```bash
# Install and run
npm install -D vite-bundle-visualizer
npx vite-bundle-visualizer

# Or add as script
# package.json: "analyze": "vite-bundle-visualizer"
```

Output: interactive treemap showing every module's contribution to bundle size.

### 13.2 source-map-explorer

```bash
npm install -D source-map-explorer

# Build with source maps, then analyze
npm run build
npx source-map-explorer dist/assets/*.js
```

### 13.3 Bundle Size Monitoring in CI

```json
// package.json — use bundlesize for CI checks
{
  "bundlesize": [
    { "path": "dist/assets/index-*.js", "maxSize": "150 kB" },
    { "path": "dist/assets/vendor-*.js", "maxSize": "100 kB" },
    { "path": "dist/assets/index-*.css", "maxSize": "30 kB" }
  ]
}
```

```yaml
# GitHub Actions step
- name: Check bundle size
  run: npx bundlesize
  env:
    BUNDLESIZE_GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 13.4 Import Cost Awareness

```tsx
// Know what you're importing — common offenders:

// moment.js          ~300KB (use date-fns or dayjs instead: ~3-10KB)
// lodash (full)      ~70KB  (use lodash/specific or native: ~1KB per function)
// chart.js           ~60KB  (lazy load if below fold)
// @mui/material      ~80KB+ (tree-shakeable but heavy — prefer Shadcn/ui)
// firebase           ~100KB+(import only what you need: firebase/auth, firebase/firestore)
// three.js           ~150KB (always lazy load)

// Check any package size: https://bundlephobia.com/
// Or use the "Import Cost" VS Code extension for real-time feedback
```
