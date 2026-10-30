# React Patterns

Production patterns for React 19 with TypeScript strict mode. Covers React Compiler v1, Server Components, hooks, data fetching, forms, and common anti-patterns. Each section includes WRONG and CORRECT examples.

---

## Table of Contents

1. [React 19 & Compiler](#1-react-19--compiler)
2. [Actions & Form Handling](#2-actions--form-handling)
3. [Server Components vs Client Components](#3-server-components-vs-client-components)
4. [Hooks Patterns](#4-hooks-patterns)
5. [Suspense & Error Boundaries](#5-suspense--error-boundaries)
6. [Ref Patterns](#6-ref-patterns)
7. [Context Patterns](#7-context-patterns)
8. [Component Composition](#8-component-composition)
9. [Forms with React Hook Form + Zod](#9-forms-with-react-hook-form--zod)
10. [Data Fetching with TanStack Query](#10-data-fetching-with-tanstack-query)
11. [Key Patterns for Lists](#11-key-patterns-for-lists)
12. [Common Mistakes & Anti-Patterns](#12-common-mistakes--anti-patterns)

---

## 1. React 19 & Compiler

### 1.1 React Compiler Handles Memoization

React Compiler v1 automatically memoizes components, values, and callbacks. Manual `memo()`, `useMemo()`, `useCallback()` are almost never needed.

```tsx
// WRONG: manual memoization in a React 19 + Compiler project
const MemoizedCard = memo(function Card({ title, onClick }: CardProps) {
    const formatted = useMemo(() => formatTitle(title), [title]);
    const handleClick = useCallback(() => onClick(title), [onClick, title]);
    return <button onClick={handleClick}>{formatted}</button>;
});

// CORRECT: let the Compiler handle it
function Card({ title, onClick }: CardProps) {
    const formatted = formatTitle(title);
    const handleClick = () => onClick(title);
    return <button onClick={handleClick}>{formatted}</button>;
}
```

### 1.2 What the Compiler Does NOT Handle

The Compiler handles referential stability. You still need to:
- Manage side effects properly (useEffect cleanup)
- Handle async state correctly
- Structure component boundaries for Suspense
- Write correct dependency logic for effects that depend on external subscriptions

```tsx
// WRONG: assuming Compiler fixes broken effect logic
function Tracker({ userId }: { userId: string }) {
    const [data, setData] = useState<Metric[]>([]);
    useEffect(() => {
        // No cleanup, no abort — Compiler cannot fix this
        fetchMetrics(userId).then(setData);
    }, [userId]);
    return <Chart data={data} />;
}

// CORRECT: proper cleanup — this is YOUR responsibility
function Tracker({ userId }: { userId: string }) {
    const [data, setData] = useState<Metric[]>([]);
    useEffect(() => {
        const controller = new AbortController();
        fetchMetrics(userId, { signal: controller.signal })
            .then(setData)
            .catch((err) => {
                if (!controller.signal.aborted) console.error(err);
            });
        return () => controller.abort();
    }, [userId]);
    return <Chart data={data} />;
}
```

### 1.3 The `use()` API

`use()` reads promises and context inside render. It works with Suspense for data fetching. Unlike hooks, `use()` can be called conditionally.

```tsx
// WRONG: useEffect + useState for simple data fetch
function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
    const [user, setUser] = useState<User | null>(null);
    useEffect(() => {
        userPromise.then(setUser);
    }, [userPromise]);
    if (!user) return <Spinner />;
    return <Profile user={user} />;
}

// CORRECT: use() with Suspense (React 19)
function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
    const user = use(userPromise);
    return <Profile user={user} />;
}

// Wrap in Suspense at the parent
<Suspense fallback={<Spinner />}>
    <UserProfile userPromise={fetchUser(id)} />
</Suspense>
```

### 1.4 `use()` for Conditional Context

```tsx
// WRONG: you cannot call useContext conditionally
function Panel({ showAdvanced }: { showAdvanced: boolean }) {
    // This violates rules of hooks
    if (showAdvanced) {
        const theme = useContext(ThemeContext); // ERROR
    }
}

// CORRECT: use() can be called conditionally
function Panel({ showAdvanced }: { showAdvanced: boolean }) {
    if (showAdvanced) {
        const theme = use(ThemeContext);
        return <AdvancedPanel theme={theme} />;
    }
    return <BasicPanel />;
}
```

### 1.5 useOptimistic

Optimistic UI updates for async actions.

```tsx
// WRONG: manual optimistic state
function TodoList({ todos }: { todos: Todo[] }) {
    const [optimistic, setOptimistic] = useState(todos);
    const addTodo = async (text: string) => {
        const fake = { id: crypto.randomUUID(), text, done: false };
        setOptimistic((prev) => [...prev, fake]);
        try {
            await createTodo(text);
        } catch {
            setOptimistic(todos); // revert — but what if todos changed?
        }
    };
    // ...
}

// CORRECT: useOptimistic automatically reverts when action completes
function TodoList({ todos }: { todos: Todo[] }) {
    const [optimisticTodos, addOptimistic] = useOptimistic(
        todos,
        (current, newTodo: string) => [
            ...current,
            { id: crypto.randomUUID(), text: newTodo, done: false },
        ],
    );

    async function addAction(formData: FormData) {
        const text = formData.get('text') as string;
        addOptimistic(text);
        await createTodo(text);
    }

    return (
        <div>
            <ul>
                {optimisticTodos.map((t) => (
                    <li key={t.id}>{t.text}</li>
                ))}
            </ul>
            <form action={addAction}>
                <input name="text" />
                <button type="submit">Add</button>
            </form>
        </div>
    );
}
```

---

## 2. Actions & Form Handling

### 2.1 useFormStatus

Read pending state from within a form component. Must be a child of `<form>`.

```tsx
// WRONG: passing isPending as prop through multiple levels
function SubmitButton({ isPending }: { isPending: boolean }) {
    return <button disabled={isPending}>Submit</button>;
}

// CORRECT: useFormStatus reads from the nearest parent <form>
function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <button type="submit" disabled={pending}>
            {pending ? 'Saving...' : 'Save'}
        </button>
    );
}

function CreateForm() {
    async function create(formData: FormData) {
        'use server';
        await db.insert(formData);
    }
    return (
        <form action={create}>
            <input name="title" required />
            <SubmitButton /> {/* reads pending from parent form */}
        </form>
    );
}
```

### 2.2 useActionState

Manage form state with server actions. Replaces the old `useFormState`.

```tsx
// CORRECT: useActionState with error handling
interface FormState {
    error?: string;
    success?: boolean;
}

async function updateProfile(
    prevState: FormState,
    formData: FormData,
): Promise<FormState> {
    'use server';
    const name = formData.get('name') as string;
    if (!name) return { error: 'Name is required' };
    await db.users.update({ name });
    return { success: true };
}

function ProfileForm() {
    const [state, formAction, isPending] = useActionState(updateProfile, {});

    return (
        <form action={formAction}>
            {state.error && <p className="text-red-500">{state.error}</p>}
            {state.success && <p className="text-green-500">Saved!</p>}
            <input name="name" required />
            <button type="submit" disabled={isPending}>
                {isPending ? 'Saving...' : 'Save'}
            </button>
        </form>
    );
}
```

---

## 3. Server Components vs Client Components

### 3.1 Default to Server, Add "use client" Only When Needed

Server Components are the default in Next.js App Router. Mark `"use client"` only for components that use browser APIs, hooks, or event handlers.

```tsx
// WRONG: marking everything as client
'use client'; // WHY? This component has no interactivity
function UserCard({ user }: { user: User }) {
    return (
        <div>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
        </div>
    );
}

// CORRECT: Server Component (default) — no directive needed
function UserCard({ user }: { user: User }) {
    return (
        <div>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
        </div>
    );
}
```

### 3.2 Push "use client" Boundaries Down

Keep the client boundary as small and as deep as possible.

```tsx
// WRONG: entire page is client because of one interactive element
'use client';
export default function DashboardPage() {
    const [tab, setTab] = useState('overview');
    return (
        <div>
            <Header />
            <Stats data={expensiveData} />
            <TabSwitcher tab={tab} onTabChange={setTab} />
            <Footer />
        </div>
    );
}

// CORRECT: only the interactive part is client
// app/dashboard/page.tsx (Server Component)
export default async function DashboardPage() {
    const data = await getStats();
    return (
        <div>
            <Header />
            <Stats data={data} />
            <TabSwitcher /> {/* "use client" only in this file */}
            <Footer />
        </div>
    );
}

// components/TabSwitcher.tsx
'use client';
export function TabSwitcher() {
    const [tab, setTab] = useState('overview');
    return <Tabs value={tab} onChange={setTab} />;
}
```

### 3.3 Serialization Boundary

Props passed from Server to Client must be serializable (no functions, Dates need conversion, no class instances).

```tsx
// WRONG: passing non-serializable props to a client component
// Server Component
export default async function Page() {
    const handleClick = () => console.log('clicked'); // function
    return <ClientButton onClick={handleClick} />; // ERROR
}

// CORRECT: actions or serializable data only
export default async function Page() {
    async function handleSubmit(formData: FormData) {
        'use server';
        // Server action — serializable
    }
    return <ClientForm action={handleSubmit} />;
}
```

---

## 4. Hooks Patterns

### 4.1 Custom Hook Composition

Extract reusable logic into custom hooks. Name them with `use` prefix.

```tsx
// WRONG: duplicated logic across components
function ComponentA() {
    const [width, setWidth] = useState(window.innerWidth);
    useEffect(() => {
        const handle = () => setWidth(window.innerWidth);
        window.addEventListener('resize', handle);
        return () => window.removeEventListener('resize', handle);
    }, []);
}
// Same code repeated in ComponentB, ComponentC...

// CORRECT: extract into a custom hook
function useWindowWidth(): number {
    const [width, setWidth] = useState(
        typeof window !== 'undefined' ? window.innerWidth : 0,
    );
    useEffect(() => {
        const handle = () => setWidth(window.innerWidth);
        window.addEventListener('resize', handle);
        return () => window.removeEventListener('resize', handle);
    }, []);
    return width;
}

// Usage
function ResponsiveLayout() {
    const width = useWindowWidth();
    return width > 768 ? <DesktopLayout /> : <MobileLayout />;
}
```

### 4.2 Hook Composition — Building on Other Hooks

```tsx
// CORRECT: composing hooks for a specific feature
function useDebounce<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

function useSearch(query: string) {
    const debouncedQuery = useDebounce(query, 300);
    return useQuery({
        queryKey: ['search', debouncedQuery],
        queryFn: () => searchApi(debouncedQuery),
        enabled: debouncedQuery.length > 2,
    });
}
```

### 4.3 Rules of Hooks — No Conditional Calls

```tsx
// WRONG: hook called conditionally
function Profile({ userId }: { userId?: string }) {
    if (!userId) return <p>No user</p>;
    const { data } = useQuery({ queryKey: ['user', userId], queryFn: () => fetchUser(userId) });
    return <div>{data?.name}</div>;
}

// CORRECT: always call hooks, handle condition in config
function Profile({ userId }: { userId?: string }) {
    const { data } = useQuery({
        queryKey: ['user', userId],
        queryFn: () => fetchUser(userId!),
        enabled: !!userId,
    });
    if (!userId) return <p>No user</p>;
    return <div>{data?.name}</div>;
}
```

---

## 5. Suspense & Error Boundaries

### 5.1 Suspense for Data Loading

```tsx
// WRONG: manual loading states everywhere
function Dashboard() {
    const { data: stats, isLoading: l1 } = useQuery({ queryKey: ['stats'], queryFn: fetchStats });
    const { data: chart, isLoading: l2 } = useQuery({ queryKey: ['chart'], queryFn: fetchChart });
    if (l1 || l2) return <Spinner />;
    return (
        <div>
            <StatsPanel stats={stats!} />
            <ChartPanel chart={chart!} />
        </div>
    );
}

// CORRECT: Suspense with granular fallbacks
function Dashboard() {
    return (
        <div>
            <Suspense fallback={<StatsSkeleton />}>
                <StatsPanel />
            </Suspense>
            <Suspense fallback={<ChartSkeleton />}>
                <ChartPanel />
            </Suspense>
        </div>
    );
}

// Each component uses useSuspenseQuery from TanStack Query
function StatsPanel() {
    const { data } = useSuspenseQuery({ queryKey: ['stats'], queryFn: fetchStats });
    return <Stats data={data} />;
}
```

### 5.2 Error Boundaries

```tsx
// CORRECT: reusable error boundary with reset
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
    return (
        <div role="alert">
            <p>Something went wrong:</p>
            <pre>{error.message}</pre>
            <button onClick={resetErrorBoundary}>Try again</button>
        </div>
    );
}

// Usage: wrap feature sections, not the whole app
function App() {
    return (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
            <Suspense fallback={<PageSkeleton />}>
                <Dashboard />
            </Suspense>
        </ErrorBoundary>
    );
}
```

### 5.3 Nested Suspense for Progressive Loading

```tsx
// CORRECT: outer shell loads first, inner content streams in
function ProductPage({ id }: { id: string }) {
    return (
        <Suspense fallback={<PageShell />}>
            <ProductHeader id={id} />
            <Suspense fallback={<ReviewsSkeleton />}>
                <ProductReviews id={id} />
            </Suspense>
            <Suspense fallback={<RecommendationsSkeleton />}>
                <Recommendations id={id} />
            </Suspense>
        </Suspense>
    );
}
```

---

## 6. Ref Patterns

### 6.1 Ref Prop (React 19 — No More forwardRef)

React 19 passes `ref` as a regular prop. `forwardRef` is no longer needed for new components.

```tsx
// WRONG (React 19): using forwardRef wrapper
const Input = forwardRef<HTMLInputElement, InputProps>(
    function Input(props, ref) {
        return <input ref={ref} {...props} />;
    },
);

// CORRECT (React 19): ref is a regular prop
function Input({ ref, ...props }: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
    return <input ref={ref} {...props} />;
}
```

### 6.2 useImperativeHandle

Expose a limited API from a child component.

```tsx
// CORRECT: expose only what the parent needs
interface DialogHandle {
    open: () => void;
    close: () => void;
}

function Dialog({ ref, children }: { ref?: React.Ref<DialogHandle>; children: React.ReactNode }) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useImperativeHandle(ref, () => ({
        open: () => dialogRef.current?.showModal(),
        close: () => dialogRef.current?.close(),
    }));

    return <dialog ref={dialogRef}>{children}</dialog>;
}

// Usage
function Parent() {
    const dialogRef = useRef<DialogHandle>(null);
    return (
        <>
            <button onClick={() => dialogRef.current?.open()}>Open</button>
            <Dialog ref={dialogRef}>
                <p>Content</p>
            </Dialog>
        </>
    );
}
```

### 6.3 Callback Refs

Use callback refs when you need to run logic when a DOM element mounts or unmounts.

```tsx
// CORRECT: callback ref for intersection observer
function LazyImage({ src, alt }: { src: string; alt: string }) {
    const setRef = useCallback((node: HTMLImageElement | null) => {
        if (!node) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    node.src = src;
                    observer.disconnect();
                }
            },
            { threshold: 0.1 },
        );
        observer.observe(node);
    }, [src]);

    return <img ref={setRef} alt={alt} />;
}
```

---

## 7. Context Patterns

### 7.1 When to Use Context

Context is for low-frequency, widely-shared values: theme, locale, auth user, feature flags.

```tsx
// WRONG: using context for high-frequency updates
const SearchContext = createContext<{
    query: string;
    results: Result[];
    setQuery: (q: string) => void;
}>({} as never);

// Every keystroke re-renders ALL consumers

// CORRECT: use context for stable values, Zustand/TanStack Query for dynamic data
const AuthContext = createContext<{ user: User | null }>({ user: null });

function AuthProvider({ children }: { children: React.ReactNode }) {
    const { data: user } = useQuery({ queryKey: ['auth'], queryFn: fetchCurrentUser });
    return (
        <AuthContext value={{ user: user ?? null }}>
            {children}
        </AuthContext>
    );
}
```

### 7.2 Context + useReducer for Complex State

```tsx
// CORRECT: context with reducer for complex but low-frequency state
interface WizardState {
    step: number;
    data: Record<string, unknown>;
}

type WizardAction =
    | { type: 'NEXT' }
    | { type: 'PREV' }
    | { type: 'SET_DATA'; payload: Record<string, unknown> };

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
    switch (action.type) {
        case 'NEXT':
            return { ...state, step: state.step + 1 };
        case 'PREV':
            return { ...state, step: Math.max(0, state.step - 1) };
        case 'SET_DATA':
            return { ...state, data: { ...state.data, ...action.payload } };
    }
}

const WizardContext = createContext<{
    state: WizardState;
    dispatch: React.Dispatch<WizardAction>;
} | null>(null);

function useWizard() {
    const ctx = use(WizardContext);
    if (!ctx) throw new Error('useWizard must be used inside WizardProvider');
    return ctx;
}
```

### 7.3 Split Contexts to Avoid Unnecessary Re-renders

```tsx
// WRONG: one giant context
const AppContext = createContext<{
    user: User;
    theme: Theme;
    locale: string;
    notifications: Notification[];
}>({} as never);

// CORRECT: split by update frequency
const UserContext = createContext<User | null>(null);
const ThemeContext = createContext<Theme>({ mode: 'light' });
const LocaleContext = createContext<string>('en');
// Notifications are high-frequency — use Zustand, not context
```

---

## 8. Component Composition

### 8.1 Children Pattern

```tsx
// WRONG: inflexible — component controls ALL rendering
function Card({ title, description, icon }: {
    title: string;
    description: string;
    icon: React.ReactNode;
}) {
    return (
        <div className="card">
            <div className="card-icon">{icon}</div>
            <h3>{title}</h3>
            <p>{description}</p>
        </div>
    );
}

// CORRECT: composable with children/slots
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn('card', className)}>{children}</div>;
}
function CardHeader({ children }: { children: React.ReactNode }) {
    return <div className="card-header">{children}</div>;
}
function CardBody({ children }: { children: React.ReactNode }) {
    return <div className="card-body">{children}</div>;
}

// Usage
<Card>
    <CardHeader>
        <Icon name="user" />
        <h3>Title</h3>
    </CardHeader>
    <CardBody>
        <p>Any content here</p>
    </CardBody>
</Card>
```

### 8.2 Compound Components

```tsx
// CORRECT: compound component with shared context
interface TabsContextType {
    activeTab: string;
    setActiveTab: (tab: string) => void;
}

const TabsContext = createContext<TabsContextType | null>(null);

function Tabs({ defaultTab, children }: { defaultTab: string; children: React.ReactNode }) {
    const [activeTab, setActiveTab] = useState(defaultTab);
    return (
        <TabsContext value={{ activeTab, setActiveTab }}>
            <div role="tablist">{children}</div>
        </TabsContext>
    );
}

function TabTrigger({ value, children }: { value: string; children: React.ReactNode }) {
    const { activeTab, setActiveTab } = use(TabsContext)!;
    return (
        <button
            role="tab"
            aria-selected={activeTab === value}
            onClick={() => setActiveTab(value)}
        >
            {children}
        </button>
    );
}

function TabContent({ value, children }: { value: string; children: React.ReactNode }) {
    const { activeTab } = use(TabsContext)!;
    if (activeTab !== value) return null;
    return <div role="tabpanel">{children}</div>;
}

// Usage
<Tabs defaultTab="general">
    <TabTrigger value="general">General</TabTrigger>
    <TabTrigger value="security">Security</TabTrigger>
    <TabContent value="general"><GeneralSettings /></TabContent>
    <TabContent value="security"><SecuritySettings /></TabContent>
</Tabs>
```

### 8.3 Render Props (Still Useful for Headless Logic)

```tsx
// CORRECT: render prop for reusable toggle logic
function Toggle({
    children,
    defaultOpen = false,
}: {
    children: (props: { isOpen: boolean; toggle: () => void }) => React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return <>{children({ isOpen, toggle: () => setIsOpen((v) => !v) })}</>;
}

// Usage
<Toggle>
    {({ isOpen, toggle }) => (
        <div>
            <button onClick={toggle}>{isOpen ? 'Hide' : 'Show'}</button>
            {isOpen && <p>Revealed content</p>}
        </div>
    )}
</Toggle>
```

---

## 9. Forms with React Hook Form + Zod

### 9.1 Basic Form with Validation

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const createUserSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100),
    email: z.string().email('Invalid email address'),
    role: z.enum(['admin', 'editor', 'viewer']),
    bio: z.string().max(500).optional(),
});

type CreateUserForm = z.infer<typeof createUserSchema>;

function CreateUserForm() {
    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
        reset,
    } = useForm<CreateUserForm>({
        resolver: zodResolver(createUserSchema),
        defaultValues: { role: 'viewer' },
    });

    const onSubmit = async (data: CreateUserForm) => {
        await createUser(data);
        reset();
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div>
                <label htmlFor="name">Name</label>
                <input id="name" {...register('name')} aria-invalid={!!errors.name} />
                {errors.name && <p role="alert">{errors.name.message}</p>}
            </div>
            <div>
                <label htmlFor="email">Email</label>
                <input id="email" type="email" {...register('email')} />
                {errors.email && <p role="alert">{errors.email.message}</p>}
            </div>
            <div>
                <label htmlFor="role">Role</label>
                <select id="role" {...register('role')}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
            <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create User'}
            </button>
        </form>
    );
}
```

### 9.2 Dynamic Fields with useFieldArray

```tsx
// CORRECT: dynamic form fields
const orderSchema = z.object({
    items: z
        .array(
            z.object({
                productId: z.string().min(1),
                quantity: z.number().min(1).max(999),
            }),
        )
        .min(1, 'At least one item required'),
});

type OrderForm = z.infer<typeof orderSchema>;

function OrderForm() {
    const { control, register, handleSubmit } = useForm<OrderForm>({
        resolver: zodResolver(orderSchema),
        defaultValues: { items: [{ productId: '', quantity: 1 }] },
    });

    const { fields, append, remove } = useFieldArray({ control, name: 'items' });

    return (
        <form onSubmit={handleSubmit(onSubmit)}>
            {fields.map((field, index) => (
                <div key={field.id}>
                    <input {...register(`items.${index}.productId`)} />
                    <input type="number" {...register(`items.${index}.quantity`, { valueAsNumber: true })} />
                    <button type="button" onClick={() => remove(index)}>Remove</button>
                </div>
            ))}
            <button type="button" onClick={() => append({ productId: '', quantity: 1 })}>
                Add Item
            </button>
            <button type="submit">Place Order</button>
        </form>
    );
}
```

---

## 10. Data Fetching with TanStack Query

### 10.1 Basic Query Pattern

```tsx
// WRONG: manual fetch in useEffect
function UserList() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        fetchUsers()
            .then(setUsers)
            .catch(setError)
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <Spinner />;
    if (error) return <ErrorMessage error={error} />;
    return <ul>{users.map((u) => <li key={u.id}>{u.name}</li>)}</ul>;
}

// CORRECT: TanStack Query
function UserList() {
    const { data: users, isLoading, error } = useQuery({
        queryKey: ['users'],
        queryFn: fetchUsers,
    });

    if (isLoading) return <Spinner />;
    if (error) return <ErrorMessage error={error} />;
    return <ul>{users.map((u) => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

### 10.2 Mutations with Invalidation

```tsx
// CORRECT: mutation + automatic cache invalidation
function useCreateUser() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: CreateUserPayload) => api.post<User>('/users', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
        },
    });
}

function CreateUserButton() {
    const createUser = useCreateUser();
    return (
        <button
            onClick={() => createUser.mutate({ name: 'New User', email: 'new@example.com' })}
            disabled={createUser.isPending}
        >
            {createUser.isPending ? 'Creating...' : 'Create User'}
        </button>
    );
}
```

### 10.3 Query Key Factory

```tsx
// CORRECT: structured query keys for consistent invalidation
const userKeys = {
    all: ['users'] as const,
    lists: () => [...userKeys.all, 'list'] as const,
    list: (filters: UserFilters) => [...userKeys.lists(), filters] as const,
    details: () => [...userKeys.all, 'detail'] as const,
    detail: (id: string) => [...userKeys.details(), id] as const,
};

// Usage
useQuery({ queryKey: userKeys.detail(userId), queryFn: () => fetchUser(userId) });
useQuery({ queryKey: userKeys.list({ role: 'admin' }), queryFn: () => fetchUsers({ role: 'admin' }) });

// Invalidate all user queries
queryClient.invalidateQueries({ queryKey: userKeys.all });
// Invalidate only lists
queryClient.invalidateQueries({ queryKey: userKeys.lists() });
```

---

## 11. Key Patterns for Lists

### 11.1 Stable Keys

```tsx
// WRONG: using array index as key
{items.map((item, index) => (
    <ListItem key={index} item={item} />
))}
// Problem: reordering, inserting, or deleting items causes wrong state association

// CORRECT: use a stable unique identifier
{items.map((item) => (
    <ListItem key={item.id} item={item} />
))}
```

### 11.2 When Index Keys Are Acceptable

Index keys are ONLY fine when ALL of these are true:
1. The list is static (never reordered, filtered, or sorted)
2. Items have no internal state or controlled inputs
3. Items have no stable unique ID

```tsx
// OK: static list of static elements
const steps = ['Select plan', 'Payment', 'Confirmation'];
{steps.map((step, i) => (
    <li key={i}>{step}</li>
))}
```

### 11.3 Key as Reset Mechanism

Changing a key forces React to unmount and remount the component, resetting all state.

```tsx
// CORRECT: reset form when switching users
function UserEditor({ userId }: { userId: string }) {
    return <UserForm key={userId} userId={userId} />;
}

// The key change causes UserForm to fully remount with fresh state
// This avoids stale state from a previous user leaking into the next
```

---

## 12. Common Mistakes & Anti-Patterns

### 12.1 setState in useEffect Without Cleanup

```tsx
// WRONG: race condition when userId changes rapidly
useEffect(() => {
    fetchUser(userId).then(setUser);
}, [userId]);

// CORRECT: abort stale requests
useEffect(() => {
    const controller = new AbortController();
    fetchUser(userId, { signal: controller.signal })
        .then(setUser)
        .catch(() => {});
    return () => controller.abort();
}, [userId]);

// BEST: use TanStack Query — it handles all of this
const { data: user } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetchUser(userId),
});
```

### 12.2 Objects/Arrays Created in Render

```tsx
// WRONG (pre-Compiler): new object every render causes child re-render
function Parent() {
    return <Child style={{ color: 'red' }} config={{ debug: true }} />;
}
// NOTE: React Compiler handles this automatically in React 19.
// But if you're NOT using the Compiler, extract constants:
const style = { color: 'red' } as const;
const config = { debug: true } as const;
function Parent() {
    return <Child style={style} config={config} />;
}
```

### 12.3 useEffect as Derived State

```tsx
// WRONG: useEffect to compute derived state
function FilteredList({ items, filter }: { items: Item[]; filter: string }) {
    const [filtered, setFiltered] = useState(items);
    useEffect(() => {
        setFiltered(items.filter((i) => i.name.includes(filter)));
    }, [items, filter]);
    return <ul>{filtered.map(/* ... */)}</ul>;
}

// CORRECT: compute during render — no state needed
function FilteredList({ items, filter }: { items: Item[]; filter: string }) {
    const filtered = items.filter((i) => i.name.includes(filter));
    return <ul>{filtered.map(/* ... */)}</ul>;
}
```

### 12.4 Fetching in useEffect When TanStack Query Is Available

```tsx
// WRONG: manual fetch + state + loading + error + race condition handling
// (See section 10.1 for the full anti-pattern)

// CORRECT: one line with TanStack Query
const { data, isLoading, error } = useQuery({
    queryKey: ['resource', id],
    queryFn: () => fetchResource(id),
});
```

### 12.5 Prop Drilling Instead of Composition

```tsx
// WRONG: drilling theme through 5 levels
<App theme={theme}>
  <Layout theme={theme}>
    <Page theme={theme}>
      <Section theme={theme}>
        <Button theme={theme} />

// CORRECT option 1: context
<ThemeProvider theme={theme}>
  <Layout>
    <Page>
      <Section>
        <Button /> {/* reads from context */}

// CORRECT option 2: composition (pass the component, not the data)
<Layout sidebar={<Sidebar />}>
    <Page header={<Header />}>
        {children}
    </Page>
</Layout>
```

### 12.6 Ignoring React Strict Mode Warnings

```tsx
// WRONG: disabling StrictMode to "fix" double-render
// main.tsx
createRoot(document.getElementById('root')!).render(<App />);

// CORRECT: keep StrictMode — fix your effects instead
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
// If effects run twice in dev, you have a cleanup problem — fix it.
```
