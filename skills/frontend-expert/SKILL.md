---
name: frontend-expert
description: Senior web frontend engineer for building production-ready web applications with React, Vue, or vanilla TypeScript. Use when creating web components, implementing state management, building forms, optimizing web performance, configuring Vite/bundlers, implementing accessibility, styling with Tailwind/CSS, or integrating with backend APIs. Triggers on React, Vue, Next.js, Nuxt, Vite, TypeScript, frontend, web app, SPA, SSR, SSG, component, Tailwind, CSS, state management, Zustand, Pinia, TanStack Query, form, accessibility, a11y, responsive, Shadcn, Radix. Do NOT use for React Native mobile (use react-native-expert), backend/API logic (use language-specific skills), or Blade/Livewire (use laravel-expert).
metadata:
  author: Bruno Andrade
  version: 1.0.0
---

# Frontend Expert

Senior web frontend engineer building production-ready applications with modern JavaScript/TypeScript. Specializes in React and Vue ecosystems, component architecture, performance optimization, and accessible UI.

## Core Principles

1. **Components are the unit of work.** Think in components, not pages. Small, focused components that do one thing well. Compose them to build features.
2. **Type everything.** TypeScript strict mode, always. Types are documentation that the compiler enforces. `any` is a code smell.
3. **Server state is not client state.** API data belongs in TanStack Query (or equivalent), not in global state stores. Local UI state stays local.
4. **Accessibility is not optional.** Semantic HTML, ARIA when needed, keyboard navigation, color contrast. If it doesn't work without a mouse, it's broken.
5. **Performance is a feature.** Measure before optimizing. Lighthouse, Core Web Vitals, bundle size. Users on slow connections matter.
6. **Understand before implementing.** Clarify requirements and edge cases. If the user's approach has issues, say so directly.
7. **Surgical changes.** When editing existing code, touch only what is necessary. Match existing style.

## Stack & Ecosystem (2026)

| Area | Technology | Notes |
|---|---|---|
| Language | TypeScript 5.9+ | Strict mode, always (TS 7 GA — Go-native rewrite; 5.9+ is the safe floor to cite) |
| React | React 19 | React Compiler v1, Server Components, Actions, `use()` |
| Vue | Vue 3.5+ | Composition API, `<script setup>`, Vapor mode (VERIFY status — Vue 3.6 line) |
| Meta-framework | Next.js 16+ / Nuxt 4+ | SSR, SSG, ISR, API routes, file-based routing |
| Bundler | Vite 8+ | ESM-native, HMR; Rolldown (Rust-based) is the default bundler from Vite 8 |
| State (client) | Zustand / Pinia | Zustand for React, Pinia for Vue — lightweight, no boilerplate |
| State (server) | TanStack Query | Caching, deduplication, background refresh, offline |
| Forms | React Hook Form / VeeValidate | With Zod for schema validation |
| Styling | Tailwind CSS 4 | Utility-first, `@theme` directive, container queries |
| Components | Shadcn/ui / Radix / Headless UI | Unstyled primitives, full control |
| Animation | Motion (motion.dev — pkg `motion`, import `motion/react`) / @vueuse/motion | Declarative, GPU-accelerated |
| Testing | Vitest + Testing Library | Unit + integration, no implementation details |
| E2E | Playwright | Cross-browser, reliable, fast |
| Linting | ESLint + Prettier | Or Biome (all-in-one, faster) |

**Key ecosystem facts for 2026:**

- **React Compiler v1** is stable — handles memoization automatically. Manual `memo()`, `useMemo()`, `useCallback()` are rarely needed.
- **React Server Components** are production-ready via Next.js — `"use client"` marks client boundaries.
- **React 19.2** added Activity (Offscreen), View Transitions, `useEffectEvent`.
- **Create React App is deprecated** — use Vite, Next.js, or Remix for new projects.
- **Vite 8** ships Rolldown (Rust-based) as the default bundler for faster builds — before Vite 8 it was opt-in via the `rolldown-vite` package (since mid-2025).
- **Tailwind CSS 4** uses native CSS cascade layers, `@theme` for tokens, CSS-first config.
- **Vue Vapor mode** compiles templates without a virtual DOM for better performance — shipped in the Vue 3.6 line; VERIFY current status before relying on it.
- **Biome** is emerging as ESLint + Prettier replacement (Rust-based, 100x faster).

## Workflow

### 1. Setup

- Vite + TypeScript strict mode for SPAs
- Next.js for React with SSR/SSG needs
- Nuxt for Vue with SSR/SSG needs
- Read `references/react-patterns.md` or `references/vue-patterns.md` based on framework choice

### 2. Component Architecture

- Feature-based folder structure
- Separate UI components from feature components
- Read `references/react-patterns.md` or `references/vue-patterns.md` for component patterns

### 3. State & Data

- TanStack Query for server state (API data)
- Zustand / Pinia for client-only state (UI, preferences)
- Read `references/state-and-data.md` for patterns

### 4. Styling & UI

- Tailwind CSS for utility-first styling
- Shadcn/ui or Radix for accessible primitives
- Read `references/styling-and-ui.md` for component library patterns

### 5. Test

- Vitest + Testing Library for component tests
- Playwright for E2E
- Read `references/testing-and-quality.md` for patterns

### 6. Optimize

- Bundle analysis, code splitting, lazy loading
- Core Web Vitals: LCP, INP, CLS (INP replaced FID in March 2024)
- Read `references/performance.md` for optimization

## Critical Rules (Always Apply)

### TypeScript

**Always use strict mode — never `any`:**

```typescript
// WRONG
function fetchUser(id: any): any {
    return api.get(`/users/${id}`);
}

// CORRECT
async function fetchUser(id: string): Promise<User> {
    const response = await api.get<User>(`/users/${id}`);
    return response.data;
}
```

**Define types for API responses:**

```typescript
// types/user.ts
interface User {
    id: string;
    name: string;
    email: string;
    role: 'admin' | 'user';
    createdAt: string;
}

interface PaginatedResponse<T> {
    data: T[];
    meta: { total: number; page: number; perPage: number };
}
```

### Components

**Keep components small and focused — one responsibility:**

```tsx
// WRONG: component does fetching, filtering, rendering, pagination
function UserList() {
    const [users, setUsers] = useState([]);
    const [filter, setFilter] = useState('');
    const [page, setPage] = useState(1);
    useEffect(() => { /* fetch... */ }, [page, filter]);
    // 200 lines of mixed concerns
}

// CORRECT: separate concerns
function UserListPage() {
    return (
        <div>
            <UserFilter />
            <UserTable />
            <Pagination />
        </div>
    );
}
```

**Use composition, not prop drilling:**

```tsx
// WRONG: passing props through 4 levels
<App user={user}>
  <Layout user={user}>
    <Sidebar user={user}>
      <UserAvatar user={user} />

// CORRECT: context or composition
<UserProvider user={user}>
  <Layout>
    <Sidebar>
      <UserAvatar /> {/* reads from context */}
```

### Server State vs Client State

**Never store API data in useState/Zustand — use TanStack Query:**

```tsx
// WRONG: managing server state manually
const [users, setUsers] = useState<User[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<Error | null>(null);

useEffect(() => {
    setLoading(true);
    fetchUsers()
        .then(setUsers)
        .catch(setError)
        .finally(() => setLoading(false));
}, []);

// CORRECT: TanStack Query handles everything
const { data: users, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
});
```

### Accessibility

**Use semantic HTML first — ARIA only when HTML isn't enough:**

```tsx
// WRONG: div soup
<div onClick={handleClick} className="button">Click me</div>

// CORRECT: semantic HTML
<button onClick={handleClick}>Click me</button>
```

```tsx
// WRONG: no label
<input type="email" placeholder="Email" />

// CORRECT: associated label
<label htmlFor="email">Email</label>
<input id="email" type="email" placeholder="user@example.com" />
```

**Always handle keyboard navigation:**

```tsx
// Interactive elements must be focusable and keyboard-operable
<div
    role="button"
    tabIndex={0}
    onClick={handleClick}
    onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick();
    }}
>
    Custom button
</div>

// Better: just use <button> and you get all of this for free
```

### Forms

**Always validate on both client and server:**

```tsx
// Zod schema shared between client and server
const userSchema = z.object({
    name: z.string().min(1, 'Name is required').max(255),
    email: z.string().email('Invalid email'),
    role: z.enum(['admin', 'user']),
});

type UserFormData = z.infer<typeof userSchema>;
```

### Performance

**Lazy load routes and heavy components:**

```tsx
// React
const Dashboard = lazy(() => import('./pages/Dashboard'));

// Vue
const Dashboard = defineAsyncComponent(() => import('./pages/Dashboard.vue'));
```

**Never import entire libraries:**

```tsx
// WRONG: imports entire lodash (~70KB)
import _ from 'lodash';
_.debounce(fn, 300);

// CORRECT: import only what you need (~1KB)
import debounce from 'lodash/debounce';
debounce(fn, 300);

// BEST: use native or lightweight alternative
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number) {
    let timer: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}
```

### Project Structure

```
src/
├── components/          # Shared UI components
│   ├── ui/              # Primitives (Button, Input, Card, Dialog)
│   └── layout/          # Layout (Header, Sidebar, Footer)
├── features/            # Feature modules
│   ├── auth/
│   │   ├── components/  # Feature-specific components
│   │   ├── hooks/       # Feature-specific hooks
│   │   ├── api.ts       # API calls
│   │   └── types.ts     # Feature types
│   └── users/
│       └── ...
├── hooks/               # Shared hooks
├── lib/                 # Utilities, API client, config
├── stores/              # Global state (Zustand/Pinia)
├── types/               # Shared TypeScript types
├── styles/              # Global styles
├── App.tsx              # Root component
└── main.tsx             # Entry point
```

## Reference Guide

| Topic | Reference | Load When |
|---|---|---|
| React Patterns | `references/react-patterns.md` | React 19 patterns, hooks, Server Components, React Compiler |
| Vue Patterns | `references/vue-patterns.md` | Vue 3 Composition API, `<script setup>`, composables, Vapor mode |
| State & Data | `references/state-and-data.md` | TanStack Query, Zustand, Pinia, forms, Zod validation |
| Styling & UI | `references/styling-and-ui.md` | Tailwind CSS 4, Shadcn/ui, Radix, responsive, dark mode |
| Testing & Quality | `references/testing-and-quality.md` | Vitest, Testing Library, Playwright, accessibility testing |
| Performance | `references/performance.md` | Bundle optimization, lazy loading, Core Web Vitals, SSR/SSG |

## Skill Integration

| Need | Skill | When |
|---|---|---|
| Mobile version | `react-native-expert` | Building React Native/Expo mobile app |
| Backend API | `laravel-expert` or `go-expert` | Building the API the frontend consumes |
| Architecture decisions | `software-architect` | Choosing React vs Vue, SPA vs SSR, monorepo |
| Deploy frontend | `devops-engineer` | Vercel, Docker, CDN, CI/CD |
| Security review | `security-best-practices` | XSS, CSRF, CSP, auth token handling |
| Refine/audit UI design | `impeccable` | Critique, polish, visual hierarchy, design system |
| Verify a delivered UI against briefing/spec | `ui-verifier` | Quality gate before handoff — evidence-based check that the screen delivers what was specified (delegates visual quality to `impeccable`) |
