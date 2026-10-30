# State & Data Management

Production patterns for state management and data fetching in modern frontend applications. Covers TanStack Query, Zustand, Pinia, form state, URL state, derived state, and common anti-patterns. Each section includes WRONG and CORRECT examples. Framework-agnostic where possible; React and Vue specifics are labeled.

---

## Table of Contents

1. [Server State vs Client State](#1-server-state-vs-client-state)
2. [TanStack Query Patterns](#2-tanstack-query-patterns)
3. [Zustand Patterns (React)](#3-zustand-patterns-react)
4. [Pinia Patterns (Vue)](#4-pinia-patterns-vue)
5. [Form State](#5-form-state)
6. [URL State](#6-url-state)
7. [Local Component State](#7-local-component-state)
8. [Global State Anti-Patterns](#8-global-state-anti-patterns)
9. [Derived State](#9-derived-state)
10. [Optimistic Updates](#10-optimistic-updates)
11. [Offline-First Patterns](#11-offline-first-patterns)

---

## 1. Server State vs Client State

Server state and client state have fundamentally different characteristics. Treating them the same leads to bugs, stale data, and unnecessary complexity.

| | Server State | Client State |
|---|---|---|
| **Source of truth** | Remote server / database | Browser / user session |
| **Ownership** | Shared — other users/systems can modify | Local — only this user |
| **Freshness** | Can become stale at any time | Always current |
| **Examples** | Users, products, orders, comments | Theme, sidebar open, form draft, selected tab |
| **Tool** | TanStack Query | Zustand / Pinia / useState / ref |

```tsx
// WRONG: putting API data in Zustand
const useStore = create<AppState>((set) => ({
    users: [],
    loading: false,
    fetchUsers: async () => {
        set({ loading: true });
        const users = await api.get('/users');
        set({ users, loading: false });
    },
}));
// Problems: no caching, no deduplication, no background refresh,
// no stale-while-revalidate, no retry, manual loading/error state

// CORRECT: TanStack Query for server state
function useUsers() {
    return useQuery({
        queryKey: ['users'],
        queryFn: () => api.get<User[]>('/users'),
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
}

// CORRECT: Zustand for client-only state
const useUIStore = create<UIState>((set) => ({
    sidebarOpen: true,
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
```

---

## 2. TanStack Query Patterns

### 2.1 Query Key Conventions

Structure query keys hierarchically for precise invalidation.

```typescript
// WRONG: flat, inconsistent keys
useQuery({ queryKey: ['users'], queryFn: fetchUsers });
useQuery({ queryKey: ['user-detail', id], queryFn: () => fetchUser(id) });
useQuery({ queryKey: ['userPosts', userId], queryFn: () => fetchUserPosts(userId) });

// CORRECT: query key factory
export const userKeys = {
    all: ['users'] as const,
    lists: () => [...userKeys.all, 'list'] as const,
    list: (filters: UserFilters) => [...userKeys.lists(), filters] as const,
    details: () => [...userKeys.all, 'detail'] as const,
    detail: (id: string) => [...userKeys.details(), id] as const,
    posts: (id: string) => [...userKeys.detail(id), 'posts'] as const,
};

// Invalidation — hierarchical
queryClient.invalidateQueries({ queryKey: userKeys.all });          // everything
queryClient.invalidateQueries({ queryKey: userKeys.lists() });      // all lists
queryClient.invalidateQueries({ queryKey: userKeys.detail(id) });   // one user + their posts
```

### 2.2 Mutations with Invalidation

```typescript
// CORRECT: mutation + invalidation
export function useUpdateUser() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: { id: string; payload: UpdateUserPayload }) =>
            api.patch<User>(`/users/${data.id}`, data.payload),
        onSuccess: (_result, variables) => {
            // Invalidate the list and the specific user detail
            queryClient.invalidateQueries({ queryKey: userKeys.lists() });
            queryClient.invalidateQueries({ queryKey: userKeys.detail(variables.id) });
        },
    });
}
```

### 2.3 Optimistic Updates with Mutations

```typescript
// CORRECT: optimistic update with rollback
export function useToggleTodo() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (todo: Todo) =>
            api.patch<Todo>(`/todos/${todo.id}`, { done: !todo.done }),

        onMutate: async (todo) => {
            // Cancel outgoing queries to avoid overwriting optimistic update
            await queryClient.cancelQueries({ queryKey: todoKeys.lists() });

            // Snapshot previous state for rollback
            const previousTodos = queryClient.getQueryData<Todo[]>(todoKeys.list('all'));

            // Optimistically update
            queryClient.setQueryData<Todo[]>(todoKeys.list('all'), (old) =>
                old?.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)),
            );

            return { previousTodos };
        },

        onError: (_err, _todo, context) => {
            // Rollback on error
            if (context?.previousTodos) {
                queryClient.setQueryData(todoKeys.list('all'), context.previousTodos);
            }
        },

        onSettled: () => {
            // Always refetch to ensure consistency
            queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
        },
    });
}
```

### 2.4 Infinite Queries

```typescript
// CORRECT: infinite scroll with cursor-based pagination
interface PageResponse<T> {
    data: T[];
    nextCursor: string | null;
}

export function useInfiniteProducts(category: string) {
    return useInfiniteQuery({
        queryKey: ['products', 'infinite', category],
        queryFn: ({ pageParam }) =>
            api.get<PageResponse<Product>>('/products', {
                params: { category, cursor: pageParam, limit: 20 },
            }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}

// React usage
function ProductGrid({ category }: { category: string }) {
    const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
        useInfiniteProducts(category);

    const allProducts = data?.pages.flatMap((page) => page.data) ?? [];

    return (
        <div>
            {allProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
            ))}
            {hasNextPage && (
                <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                    {isFetchingNextPage ? 'Loading...' : 'Load More'}
                </button>
            )}
        </div>
    );
}
```

### 2.5 Prefetching

```typescript
// CORRECT: prefetch on hover for instant navigation
function UserListItem({ user }: { user: UserSummary }) {
    const queryClient = useQueryClient();

    const prefetchUser = () => {
        queryClient.prefetchQuery({
            queryKey: userKeys.detail(user.id),
            queryFn: () => fetchUser(user.id),
            staleTime: 60 * 1000, // don't re-prefetch if fresh
        });
    };

    return (
        <Link
            to={`/users/${user.id}`}
            onMouseEnter={prefetchUser}
            onFocus={prefetchUser}
        >
            {user.name}
        </Link>
    );
}
```

### 2.6 Dependent Queries

```typescript
// CORRECT: query that depends on another query's result
function useUserProjects(userId: string) {
    const userQuery = useQuery({
        queryKey: userKeys.detail(userId),
        queryFn: () => fetchUser(userId),
    });

    return useQuery({
        queryKey: ['projects', { ownerId: userId }],
        queryFn: () => fetchProjects(userQuery.data!.organizationId),
        enabled: !!userQuery.data, // only run when user is loaded
    });
}
```

### 2.7 Suspense Integration

```tsx
// CORRECT: useSuspenseQuery for Suspense-first data fetching (React)
function UserProfile({ userId }: { userId: string }) {
    // Throws promise to Suspense boundary — no isLoading check needed
    const { data: user } = useSuspenseQuery({
        queryKey: userKeys.detail(userId),
        queryFn: () => fetchUser(userId),
    });

    return <ProfileCard user={user} />;
}

// Parent
<ErrorBoundary FallbackComponent={ErrorFallback}>
    <Suspense fallback={<ProfileSkeleton />}>
        <UserProfile userId={id} />
    </Suspense>
</ErrorBoundary>
```

```vue
<!-- CORRECT: useSuspenseQuery in Vue with <Suspense> -->
<!-- UserProfile.vue -->
<script setup lang="ts">
const props = defineProps<{ userId: string }>();

// Top-level await works because <script setup> supports async
const { data: user } = useSuspenseQuery({
    queryKey: userKeys.detail(props.userId),
    queryFn: () => fetchUser(props.userId),
});
</script>

<template>
    <ProfileCard :user="user" />
</template>

<!-- Parent.vue -->
<template>
    <Suspense>
        <UserProfile :user-id="id" />
        <template #fallback>
            <ProfileSkeleton />
        </template>
    </Suspense>
</template>
```

---

## 3. Zustand Patterns (React)

### 3.1 Basic Store with Slices

```typescript
// WRONG: one giant store with everything
const useStore = create<AppState>((set) => ({
    user: null,
    theme: 'light',
    sidebarOpen: true,
    cart: [],
    // 200 lines of unrelated state...
}));

// CORRECT: separate stores by domain
// stores/ui.ts
interface UIState {
    sidebarOpen: boolean;
    toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
    sidebarOpen: true,
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));

// stores/preferences.ts
interface PreferencesState {
    theme: 'light' | 'dark' | 'system';
    locale: string;
    setTheme: (theme: PreferencesState['theme']) => void;
    setLocale: (locale: string) => void;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
    theme: 'system',
    locale: 'en',
    setTheme: (theme) => set({ theme }),
    setLocale: (locale) => set({ locale }),
}));
```

### 3.2 Selectors to Prevent Unnecessary Re-renders

```tsx
// WRONG: subscribing to entire store — any change re-renders
function Header() {
    const store = useUIStore(); // re-renders on sidebarOpen, theme, locale changes
    return <h1>{store.theme}</h1>;
}

// CORRECT: select only what you need
function Header() {
    const theme = usePreferencesStore((s) => s.theme);
    // Only re-renders when theme changes
    return <h1>{theme}</h1>;
}

// CORRECT: multiple selectors with shallow equality
import { useShallow } from 'zustand/react/shallow';

function Toolbar() {
    const { theme, locale } = usePreferencesStore(
        useShallow((s) => ({ theme: s.theme, locale: s.locale })),
    );
    return <div>{theme} / {locale}</div>;
}
```

### 3.3 Persist Middleware

```typescript
import { persist } from 'zustand/middleware';

export const usePreferencesStore = create<PreferencesState>()(
    persist(
        (set) => ({
            theme: 'system',
            locale: 'en',
            setTheme: (theme) => set({ theme }),
            setLocale: (locale) => set({ locale }),
        }),
        {
            name: 'preferences',
            // Only persist specific fields
            partialize: (state) => ({
                theme: state.theme,
                locale: state.locale,
            }),
        },
    ),
);
```

### 3.4 Immer Middleware for Complex Updates

```typescript
import { immer } from 'zustand/middleware/immer';

interface CartState {
    items: CartItem[];
    addItem: (item: CartItem) => void;
    updateQuantity: (id: string, qty: number) => void;
    removeItem: (id: string) => void;
}

// WRONG: spread gymnastics for nested updates
export const useCartStore = create<CartState>((set) => ({
    items: [],
    updateQuantity: (id, qty) =>
        set((s) => ({
            items: s.items.map((item) =>
                item.id === id ? { ...item, qty } : item,
            ),
        })),
}));

// CORRECT: Immer for readable mutations
export const useCartStore = create<CartState>()(
    immer((set) => ({
        items: [],
        addItem: (item) =>
            set((state) => {
                const existing = state.items.find((i) => i.id === item.id);
                if (existing) {
                    existing.qty += item.qty;
                } else {
                    state.items.push(item);
                }
            }),
        updateQuantity: (id, qty) =>
            set((state) => {
                const item = state.items.find((i) => i.id === id);
                if (item) item.qty = qty;
            }),
        removeItem: (id) =>
            set((state) => {
                state.items = state.items.filter((i) => i.id !== id);
            }),
    })),
);
```

### 3.5 Actions Outside the Store

```typescript
// CORRECT: call store actions from anywhere (not just components)
// api/auth.ts
export async function logout() {
    await api.post('/auth/logout');
    useAuthStore.getState().clearSession();
    useCartStore.getState().reset();
    // No need to be inside a React component
}
```

---

## 4. Pinia Patterns (Vue)

### 4.1 Setup Stores (Recommended)

```typescript
// CORRECT: setup syntax — full Composition API power
export const useAuthStore = defineStore('auth', () => {
    const user = ref<User | null>(null);
    const token = ref<string | null>(null);

    const isAuthenticated = computed(() => !!token.value);
    const isAdmin = computed(() => user.value?.role === 'admin');

    async function login(credentials: LoginPayload) {
        const response = await api.post<AuthResponse>('/auth/login', credentials);
        token.value = response.token;
        user.value = response.user;
    }

    function logout() {
        token.value = null;
        user.value = null;
    }

    return { user, token, isAuthenticated, isAdmin, login, logout };
});
```

### 4.2 Pinia Plugins

```typescript
// CORRECT: plugin for persistence
import { watch } from 'vue';
import type { PiniaPlugin } from 'pinia';

export const piniaLocalStorage: PiniaPlugin = ({ store }) => {
    const saved = localStorage.getItem(store.$id);
    if (saved) {
        store.$patch(JSON.parse(saved));
    }

    watch(
        () => store.$state,
        (state) => {
            localStorage.setItem(store.$id, JSON.stringify(state));
        },
        { deep: true },
    );
};

// Register
const pinia = createPinia();
pinia.use(piniaLocalStorage);
```

### 4.3 Store Subscriptions

```typescript
// CORRECT: react to state changes from outside
const authStore = useAuthStore();

authStore.$subscribe((mutation, state) => {
    if (mutation.type === 'direct' && !state.token) {
        router.push('/login');
    }
});

// Subscribe to actions
authStore.$onAction(({ name, after, onError }) => {
    if (name === 'login') {
        after(() => {
            router.push('/dashboard');
        });
        onError((err) => {
            toast.error(`Login failed: ${err.message}`);
        });
    }
});
```

### 4.4 storeToRefs for Destructuring

```vue
<script setup lang="ts">
import { storeToRefs } from 'pinia';

const authStore = useAuthStore();

// WRONG: destructured values lose reactivity
const { user, isAuthenticated } = authStore;

// CORRECT: storeToRefs preserves reactivity for state + getters
const { user, isAuthenticated } = storeToRefs(authStore);

// Actions are plain functions — destructure directly
const { login, logout } = authStore;
</script>
```

---

## 5. Form State

### 5.1 Form State Stays in the Form Library

```tsx
// WRONG: duplicating form state in Zustand
const useFormStore = create((set) => ({
    name: '',
    email: '',
    setName: (name: string) => set({ name }),
    setEmail: (email: string) => set({ email }),
}));

// CORRECT: React Hook Form owns form state, Zod validates
const schema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
});

function MyForm() {
    const { register, handleSubmit, formState: { errors } } = useForm({
        resolver: zodResolver(schema),
    });
    // Form state lives in React Hook Form — not global state
}
```

### 5.2 Shared Zod Schema Between Client and Server

```typescript
// schemas/user.ts — shared between frontend and backend
import { z } from 'zod';

export const createUserSchema = z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    role: z.enum(['admin', 'editor', 'viewer']),
    bio: z.string().max(500).optional(),
});

export const updateUserSchema = createUserSchema.partial().extend({
    id: z.string().uuid(),
});

export type CreateUserPayload = z.infer<typeof createUserSchema>;
export type UpdateUserPayload = z.infer<typeof updateUserSchema>;

// Frontend: React Hook Form
const form = useForm<CreateUserPayload>({ resolver: zodResolver(createUserSchema) });

// Frontend: VeeValidate
const { handleSubmit } = useForm({ validationSchema: toTypedSchema(createUserSchema) });

// Backend (Node): validate incoming request
const result = createUserSchema.safeParse(req.body);
if (!result.success) return res.status(400).json(result.error.flatten());
```

### 5.3 Multi-Step Form State

```tsx
// CORRECT: React — persist step data as you go
const stepOneSchema = z.object({ name: z.string().min(1), email: z.string().email() });
const stepTwoSchema = z.object({ plan: z.enum(['free', 'pro', 'enterprise']) });
const fullSchema = stepOneSchema.merge(stepTwoSchema);

type WizardData = z.infer<typeof fullSchema>;

function Wizard() {
    const [step, setStep] = useState(0);
    const [data, setData] = useState<Partial<WizardData>>({});

    function handleStepComplete(stepData: Partial<WizardData>) {
        const merged = { ...data, ...stepData };
        setData(merged);
        if (step < 1) {
            setStep(step + 1);
        } else {
            const parsed = fullSchema.parse(merged);
            submitWizard(parsed);
        }
    }

    return step === 0
        ? <StepOne defaults={data} onComplete={handleStepComplete} />
        : <StepTwo defaults={data} onComplete={handleStepComplete} />;
}
```

---

## 6. URL State

### 6.1 Search Params as State

URL search params are state that survives page refresh, back/forward, and sharing. Use them for filters, pagination, and views.

```tsx
// WRONG (React): storing filterable/shareable state in useState
function ProductList() {
    const [category, setCategory] = useState('all');
    const [sort, setSort] = useState('price');
    const [page, setPage] = useState(1);
    // Lost on refresh, not shareable, back button doesn't work
}

// CORRECT (React + React Router): sync with URL search params
import { useSearchParams } from 'react-router-dom';

function ProductList() {
    const [searchParams, setSearchParams] = useSearchParams();
    const category = searchParams.get('category') ?? 'all';
    const sort = searchParams.get('sort') ?? 'price';
    const page = Number(searchParams.get('page') ?? '1');

    const { data } = useQuery({
        queryKey: ['products', { category, sort, page }],
        queryFn: () => fetchProducts({ category, sort, page }),
    });

    function setFilter(key: string, value: string) {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set(key, value);
            next.set('page', '1'); // reset page on filter change
            return next;
        });
    }

    return (
        <div>
            <CategoryFilter value={category} onChange={(v) => setFilter('category', v)} />
            <SortSelector value={sort} onChange={(v) => setFilter('sort', v)} />
            <ProductGrid products={data?.items ?? []} />
            <Pagination page={page} total={data?.totalPages ?? 0}
                onChange={(p) => setFilter('page', String(p))} />
        </div>
    );
}
```

```vue
<!-- CORRECT (Vue + Vue Router): URL state for filters -->
<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

const category = computed(() => (route.query.category as string) ?? 'all');
const sort = computed(() => (route.query.sort as string) ?? 'price');
const page = computed(() => Number(route.query.page ?? '1'));

const { data } = useQuery({
    queryKey: computed(() => ['products', { category: category.value, sort: sort.value, page: page.value }]),
    queryFn: () => fetchProducts({ category: category.value, sort: sort.value, page: page.value }),
});

function setFilter(key: string, value: string) {
    router.push({
        query: { ...route.query, [key]: value, page: key === 'page' ? value : '1' },
    });
}
</script>
```

### 6.2 When to Use URL State vs Component State

| Use URL state for | Use component state for |
|---|---|
| Filters, search queries, sort | Form input drafts |
| Pagination | Modal open/close |
| Selected tab/view | Hover/focus state |
| Anything the user expects to survive refresh | Transient UI state |

---

## 7. Local Component State

### 7.1 When useState/ref Is Enough

Not everything needs global state or a library.

```tsx
// WRONG: global store for a modal's open state
const useModalStore = create((set) => ({
    isConfirmOpen: false,
    openConfirm: () => set({ isConfirmOpen: true }),
    closeConfirm: () => set({ isConfirmOpen: false }),
}));

// CORRECT: local state for local concerns (React)
function DeleteButton({ onDelete }: { onDelete: () => void }) {
    const [showConfirm, setShowConfirm] = useState(false);
    return (
        <>
            <button onClick={() => setShowConfirm(true)}>Delete</button>
            {showConfirm && (
                <ConfirmDialog
                    onConfirm={() => { onDelete(); setShowConfirm(false); }}
                    onCancel={() => setShowConfirm(false)}
                />
            )}
        </>
    );
}
```

```vue
<!-- CORRECT: local state for local concerns (Vue) -->
<script setup lang="ts">
const showConfirm = ref(false);
</script>
<template>
    <button @click="showConfirm = true">Delete</button>
    <ConfirmDialog
        v-if="showConfirm"
        @confirm="emit('delete'); showConfirm = false"
        @cancel="showConfirm = false"
    />
</template>
```

### 7.2 Lifting State vs Globalizing

```tsx
// WRONG: using Zustand because two siblings need the same state
// stores/selection.ts — overkill

// CORRECT: lift state to the nearest common parent
function ItemListPage() {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    return (
        <div className="flex">
            <ItemList selectedId={selectedId} onSelect={setSelectedId} />
            <ItemDetail itemId={selectedId} />
        </div>
    );
}
```

---

## 8. Global State Anti-Patterns

### 8.1 Storing Server Data in Global State

```typescript
// WRONG: server data in Zustand/Pinia
const useUsersStore = create((set) => ({
    users: [],
    fetchUsers: async () => {
        const users = await api.get('/users');
        set({ users });
    },
}));
// Problems:
// - No cache invalidation
// - No stale-while-revalidate
// - No deduplication (two components trigger two fetches)
// - No background refresh
// - No retry on failure
// - Manual loading/error state

// CORRECT: TanStack Query handles ALL of this
const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<User[]>('/users'),
    staleTime: 5 * 60 * 1000,
    retry: 3,
});
```

### 8.2 Over-Globalizing State

```typescript
// WRONG: everything in one global store
const useAppStore = create((set) => ({
    // Auth — OK to be global
    user: null,
    // UI preferences — OK to be global
    theme: 'light',
    // THIS SHOULD NOT BE HERE:
    searchQuery: '',           // local to search component
    isModalOpen: false,        // local to the modal trigger
    selectedTableRows: [],     // local to the table
    formDraft: {},             // local to the form
    tooltipVisible: false,     // local to the tooltip
}));

// CORRECT: global only for truly app-wide state
// Global: auth, theme, locale, feature flags
// Local: form state, modal state, selection, tooltips
// TanStack Query: all API data
```

### 8.3 Redundant State (Synchronization Traps)

```typescript
// WRONG: storing the same data in multiple places
const useStore = create((set) => ({
    users: [],
    filteredUsers: [],  // derived from users — redundant
    userCount: 0,       // derived from users.length — redundant
    setUsers: (users) =>
        set({
            users,
            filteredUsers: users.filter(/* ... */), // must remember to sync
            userCount: users.length,                // must remember to sync
        }),
}));

// CORRECT: compute derived values, don't store them
const useStore = create((set) => ({
    users: [] as User[],
    filter: '',
    setUsers: (users: User[]) => set({ users }),
    setFilter: (filter: string) => set({ filter }),
}));

// Derive in the component or with a selector
function UserList() {
    const users = useStore((s) => s.users);
    const filter = useStore((s) => s.filter);
    const filtered = users.filter((u) => u.name.includes(filter));
    const count = filtered.length;
}
```

---

## 9. Derived State

### 9.1 Compute, Don't Store

```tsx
// WRONG (React): useEffect to derive state
function Cart({ items }: { items: CartItem[] }) {
    const [total, setTotal] = useState(0);
    const [hasDiscount, setHasDiscount] = useState(false);

    useEffect(() => {
        const t = items.reduce((sum, i) => sum + i.price * i.qty, 0);
        setTotal(t);
        setHasDiscount(t > 100);
    }, [items]);
}

// CORRECT (React): compute during render
function Cart({ items }: { items: CartItem[] }) {
    const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const hasDiscount = total > 100;
    const discountedTotal = hasDiscount ? total * 0.9 : total;
}
```

```vue
<!-- WRONG (Vue): watch to derive state -->
<script setup lang="ts">
const total = ref(0);
watch(items, (newItems) => {
    total.value = newItems.reduce((sum, i) => sum + i.price * i.qty, 0);
}, { deep: true, immediate: true });
</script>

<!-- CORRECT (Vue): computed -->
<script setup lang="ts">
const total = computed(() =>
    items.value.reduce((sum, i) => sum + i.price * i.qty, 0),
);
const hasDiscount = computed(() => total.value > 100);
const discountedTotal = computed(() => hasDiscount.value ? total.value * 0.9 : total.value);
</script>
```

### 9.2 Derived State in Stores

```typescript
// CORRECT (Zustand): use selectors for derived state
const useCartStore = create<CartState>((set) => ({
    items: [],
    addItem: (item) => set((s) => ({ items: [...s.items, item] })),
}));

// Derive outside the store — selectors
const useCartTotal = () =>
    useCartStore((s) => s.items.reduce((sum, i) => sum + i.price * i.qty, 0));
const useCartCount = () =>
    useCartStore((s) => s.items.reduce((sum, i) => sum + i.qty, 0));
```

```typescript
// CORRECT (Pinia): computed in setup store
export const useCartStore = defineStore('cart', () => {
    const items = ref<CartItem[]>([]);

    // Derived as computed — reactive, cached
    const total = computed(() =>
        items.value.reduce((sum, i) => sum + i.price * i.qty, 0),
    );
    const count = computed(() =>
        items.value.reduce((sum, i) => sum + i.qty, 0),
    );

    return { items, total, count };
});
```

---

## 10. Optimistic Updates

### 10.1 Pattern: Update UI Immediately, Reconcile After

The core pattern: update the UI before the server responds, revert on failure, and always reconcile with the real server state after.

```typescript
// CORRECT: full optimistic update lifecycle with TanStack Query
function useLikePost() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (postId: string) => api.post(`/posts/${postId}/like`),

        onMutate: async (postId) => {
            // 1. Cancel outgoing fetches to avoid overwriting
            await queryClient.cancelQueries({ queryKey: ['posts', postId] });

            // 2. Snapshot for rollback
            const previousPost = queryClient.getQueryData<Post>(['posts', postId]);

            // 3. Optimistically update
            queryClient.setQueryData<Post>(['posts', postId], (old) =>
                old ? { ...old, likes: old.likes + 1, likedByMe: true } : old,
            );

            return { previousPost };
        },

        onError: (_err, postId, context) => {
            // 4. Rollback on failure
            if (context?.previousPost) {
                queryClient.setQueryData(['posts', postId], context.previousPost);
            }
        },

        onSettled: (_data, _err, postId) => {
            // 5. Always refetch to reconcile with server
            queryClient.invalidateQueries({ queryKey: ['posts', postId] });
        },
    });
}
```

### 10.2 useOptimistic (React 19)

For simpler cases where you don't need TanStack Query's full mutation lifecycle.

```tsx
// CORRECT: React 19 useOptimistic for simple cases
function CommentList({ comments }: { comments: Comment[] }) {
    const [optimisticComments, addOptimistic] = useOptimistic(
        comments,
        (current, newComment: { text: string }) => [
            ...current,
            {
                id: `temp-${Date.now()}`,
                text: newComment.text,
                author: 'You',
                pending: true,
            },
        ],
    );

    async function postComment(formData: FormData) {
        const text = formData.get('text') as string;
        addOptimistic({ text });
        await createComment(text); // on completion, parent refreshes comments prop
    }

    return (
        <div>
            {optimisticComments.map((c) => (
                <Comment key={c.id} comment={c} isPending={'pending' in c} />
            ))}
            <form action={postComment}>
                <input name="text" required />
                <button type="submit">Post</button>
            </form>
        </div>
    );
}
```

---

## 11. Offline-First Patterns

### 11.1 TanStack Query Offline Support

```typescript
// CORRECT: configure for offline resilience
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Keep showing stale data when offline
            staleTime: 5 * 60 * 1000,
            gcTime: 24 * 60 * 60 * 1000, // keep cache for 24h
            retry: (failureCount, error) => {
                // Don't retry on 4xx errors — they won't succeed
                if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
                    return false;
                }
                return failureCount < 3;
            },
            networkMode: 'offlineFirst', // return cache immediately, refetch in background
        },
        mutations: {
            networkMode: 'offlineFirst',
        },
    },
});
```

### 11.2 Persisting Cache to Storage

```typescript
import { persistQueryClient } from '@tanstack/query-persist-client-core';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

const persister = createSyncStoragePersister({
    storage: window.localStorage,
    // Optionally use sessionStorage or IndexedDB via async persister
});

persistQueryClient({
    queryClient,
    persister,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    dehydrateOptions: {
        shouldDehydrateQuery: (query) => {
            // Only persist successful queries
            return query.state.status === 'success';
        },
    },
});
```

### 11.3 Mutation Queue for Offline Actions

```typescript
// CORRECT: mutations that queue when offline and replay when online
import { onlineManager } from '@tanstack/react-query';

// TanStack Query v5 pauses mutations when offline by default
// with networkMode: 'offlineFirst'. They auto-resume when connectivity returns.

// For custom offline detection:
onlineManager.setEventListener((setOnline) => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    return () => {
        window.removeEventListener('online', onlineHandler);
        window.removeEventListener('offline', offlineHandler);
    };
});

// Show offline indicator
function OfflineBanner() {
    const isOnline = useSyncExternalStore(
        (cb) => {
            window.addEventListener('online', cb);
            window.addEventListener('offline', cb);
            return () => {
                window.removeEventListener('online', cb);
                window.removeEventListener('offline', cb);
            };
        },
        () => navigator.onLine,
    );

    if (isOnline) return null;
    return (
        <div role="alert" className="bg-amber-500 text-white p-2 text-center">
            You are offline. Changes will be saved when you reconnect.
        </div>
    );
}
```
