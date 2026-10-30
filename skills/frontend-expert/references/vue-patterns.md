# Vue Patterns

Production patterns for Vue 3.5+ with TypeScript strict mode and `<script setup>`. Covers Composition API, composables, component patterns, routing, Pinia stores, forms, and common anti-patterns. Each section includes WRONG and CORRECT examples.

---

## Table of Contents

1. [Composition API Fundamentals](#1-composition-api-fundamentals)
2. [Script Setup Syntax](#2-script-setup-syntax)
3. [Composables](#3-composables)
4. [Vue 3.5+ Features](#4-vue-35-features)
5. [Provide / Inject](#5-provide--inject)
6. [Component v-model](#6-component-v-model)
7. [Slots](#7-slots)
8. [Async Components & Suspense](#8-async-components--suspense)
9. [Vue Router 4 Patterns](#9-vue-router-4-patterns)
10. [Pinia Store Patterns](#10-pinia-store-patterns)
11. [Forms with VeeValidate + Zod](#11-forms-with-veevalidate--zod)
12. [Template Refs & DOM Access](#12-template-refs--dom-access)
13. [Common Mistakes & Anti-Patterns](#13-common-mistakes--anti-patterns)

---

## 1. Composition API Fundamentals

### 1.1 ref vs reactive

Use `ref()` for primitives and single values. Use `reactive()` for objects where you need to destructure or pass around properties — but prefer `ref()` in most cases for consistency.

```vue
<script setup lang="ts">
// WRONG: reactive for a primitive — does not work
const count = reactive(0); // ERROR: argument must be object

// WRONG: destructuring reactive loses reactivity
const state = reactive({ count: 0, name: 'Vue' });
const { count } = state; // NOT reactive anymore

// CORRECT: ref for primitives
const count = ref(0);
count.value++; // .value in script, auto-unwrapped in template

// CORRECT: ref for objects (consistent, relocatable)
const user = ref<User | null>(null);
user.value = await fetchUser(id);

// ACCEPTABLE: reactive when you need to pass a chunk of state
// and never destructure it
const form = reactive({
    name: '',
    email: '',
    role: 'viewer' as 'admin' | 'editor' | 'viewer',
});
</script>
```

### 1.2 computed

Computed values are read-only by default. Use writable computed for two-way binding scenarios.

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';

const items = ref<CartItem[]>([]);

// WRONG: watching to derive state
const total = ref(0);
watch(items, (newItems) => {
    total.value = newItems.reduce((sum, i) => sum + i.price * i.qty, 0);
}, { deep: true, immediate: true });

// CORRECT: computed derives value automatically
const total = computed(() =>
    items.value.reduce((sum, i) => sum + i.price * i.qty, 0),
);

// Writable computed
const firstName = ref('John');
const lastName = ref('Doe');
const fullName = computed({
    get: () => `${firstName.value} ${lastName.value}`,
    set: (val: string) => {
        const [first, ...rest] = val.split(' ');
        firstName.value = first;
        lastName.value = rest.join(' ');
    },
});
</script>
```

### 1.3 watch vs watchEffect

```vue
<script setup lang="ts">
// watch: explicit sources, access old/new values, lazy by default
watch(
    () => props.userId,
    async (newId, oldId) => {
        if (newId !== oldId) {
            user.value = await fetchUser(newId);
        }
    },
);

// watchEffect: auto-tracks dependencies, runs immediately
// Best for side effects that depend on reactive state
watchEffect(() => {
    document.title = `${userName.value} - Dashboard`;
});

// WRONG: using watchEffect when you need old value or explicit control
watchEffect(() => {
    // No access to previous value, runs immediately, tracks everything read
    sendAnalytics(route.path); // fires on mount AND every route change
});

// CORRECT: watch when you need control
watch(
    () => route.path,
    (newPath) => {
        sendAnalytics(newPath);
    },
    // { immediate: true } only if you want it to run on mount too
);
</script>
```

### 1.4 watch with Cleanup (onCleanup)

```vue
<script setup lang="ts">
watch(
    () => props.searchQuery,
    (query, _oldQuery, onCleanup) => {
        const controller = new AbortController();
        onCleanup(() => controller.abort());

        fetchResults(query, { signal: controller.signal })
            .then((data) => {
                results.value = data;
            })
            .catch(() => {}); // ignore aborted
    },
);
</script>
```

---

## 2. Script Setup Syntax

### 2.1 defineProps with TypeScript

```vue
<script setup lang="ts">
// WRONG: runtime declaration style without types
const props = defineProps({
    title: String,
    count: { type: Number, default: 0 },
});

// CORRECT: type-only declaration (TS-first)
interface Props {
    title: string;
    count?: number;
    variant?: 'primary' | 'secondary';
    items: readonly Item[];
}

const props = withDefaults(defineProps<Props>(), {
    count: 0,
    variant: 'primary',
});
</script>
```

### 2.2 defineEmits with TypeScript

```vue
<script setup lang="ts">
// WRONG: no type safety on emitted events
const emit = defineEmits(['update', 'delete']);

// CORRECT: typed events
const emit = defineEmits<{
    update: [id: string, data: Partial<User>];
    delete: [id: string];
    'status-change': [status: 'active' | 'inactive'];
}>();

// Usage — type-checked
emit('update', user.id, { name: 'New Name' });
emit('delete', user.id);
</script>
```

### 2.3 defineExpose

Only expose what the parent actually needs to call imperatively.

```vue
<!-- ChildForm.vue -->
<script setup lang="ts">
const formData = ref({ name: '', email: '' });
const internalState = ref(0); // private

function validate(): boolean {
    // validation logic
    return true;
}

function reset(): void {
    formData.value = { name: '', email: '' };
}

// WRONG: exposing everything
// (script setup exposes nothing by default — that's good)

// CORRECT: expose only the public API
defineExpose({ validate, reset });
</script>

<!-- Parent.vue -->
<script setup lang="ts">
const formRef = useTemplateRef<{ validate: () => boolean; reset: () => void }>('form');

function handleSubmit() {
    if (formRef.value?.validate()) {
        // submit
    }
}
</script>

<template>
    <ChildForm ref="form" />
    <button @click="handleSubmit">Submit</button>
</template>
```

---

## 3. Composables

### 3.1 Naming and Structure

Composables are the Vue equivalent of React custom hooks. Name them with `use` prefix and return reactive refs.

```typescript
// WRONG: not returning refs, side effects without cleanup
function getMousePosition() {
    let x = 0;
    let y = 0;
    window.addEventListener('mousemove', (e) => {
        x = e.clientX;
        y = e.clientY;
    });
    return { x, y }; // not reactive, no cleanup
}

// CORRECT: composable with reactive returns and cleanup
export function useMouse() {
    const x = ref(0);
    const y = ref(0);

    function handler(event: MouseEvent) {
        x.value = event.clientX;
        y.value = event.clientY;
    }

    onMounted(() => window.addEventListener('mousemove', handler));
    onUnmounted(() => window.removeEventListener('mousemove', handler));

    return { x: readonly(x), y: readonly(y) };
}

// Usage in component
const { x, y } = useMouse();
```

### 3.2 Composable Accepting Refs as Arguments

```typescript
// CORRECT: accept both raw values and refs using MaybeRefOrGetter
import { toValue, type MaybeRefOrGetter } from 'vue';

export function useFetch<T>(url: MaybeRefOrGetter<string>) {
    const data = ref<T | null>(null);
    const error = ref<Error | null>(null);
    const isLoading = ref(false);

    async function execute() {
        isLoading.value = true;
        error.value = null;
        try {
            const response = await fetch(toValue(url));
            data.value = await response.json();
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            isLoading.value = false;
        }
    }

    // Re-fetch when url changes
    watchEffect(() => {
        toValue(url); // track the dependency
        execute();
    });

    return { data: readonly(data), error: readonly(error), isLoading: readonly(isLoading), execute };
}

// Usage: works with string, ref, or getter
const { data } = useFetch<User[]>('/api/users');
const { data } = useFetch<User>(() => `/api/users/${userId.value}`);
```

### 3.3 Composing Composables

```typescript
// CORRECT: build complex composables from simpler ones
export function useSearch(endpoint: string) {
    const query = ref('');
    const debouncedQuery = useDebouncedRef(query, 300);

    const { data, isLoading, error } = useFetch<SearchResult[]>(
        () => debouncedQuery.value.length > 2
            ? `${endpoint}?q=${encodeURIComponent(debouncedQuery.value)}`
            : '',
    );

    return {
        query,
        results: data,
        isLoading,
        error,
    };
}
```

---

## 4. Vue 3.5+ Features

### 4.1 defineModel (Vue 3.4+)

Two-way binding for custom components. Replaces the old `modelValue` + `update:modelValue` pattern.

```vue
<!-- WRONG: manual v-model implementation -->
<script setup lang="ts">
const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
function handleInput(event: Event) {
    emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>
<template>
    <input :value="modelValue" @input="handleInput" />
</template>

<!-- CORRECT: defineModel (Vue 3.4+) -->
<script setup lang="ts">
const model = defineModel<string>({ required: true });
</script>
<template>
    <input v-model="model" />
</template>

<!-- Multiple v-models -->
<script setup lang="ts">
const firstName = defineModel<string>('firstName', { required: true });
const lastName = defineModel<string>('lastName', { required: true });
</script>
<template>
    <input v-model="firstName" />
    <input v-model="lastName" />
</template>

<!-- Parent usage -->
<template>
    <NameInput v-model:firstName="first" v-model:lastName="last" />
</template>
```

### 4.2 useTemplateRef (Vue 3.5+)

Type-safe template refs without string matching.

```vue
<!-- WRONG (pre-3.5): ref name must match template string -->
<script setup lang="ts">
const inputEl = ref<HTMLInputElement | null>(null);
// Must hope "inputEl" matches ref="inputEl" in template
</script>
<template>
    <input ref="inputEl" />
</template>

<!-- CORRECT (Vue 3.5+): useTemplateRef -->
<script setup lang="ts">
const input = useTemplateRef<HTMLInputElement>('my-input');

onMounted(() => {
    input.value?.focus();
});
</script>
<template>
    <input ref="my-input" />
</template>
```

### 4.3 Teleport

Render content at a different DOM location (useful for modals, tooltips, toasts).

```vue
<script setup lang="ts">
const showModal = ref(false);
</script>

<template>
    <button @click="showModal = true">Open Modal</button>

    <!-- Renders inside #modal-root, not inside current component DOM -->
    <Teleport to="#modal-root">
        <Transition name="fade">
            <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
                <div class="modal-content" role="dialog" aria-modal="true">
                    <h2>Modal Title</h2>
                    <slot />
                    <button @click="showModal = false">Close</button>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>
```

---

## 5. Provide / Inject

### 5.1 Typed Provide/Inject

```typescript
// WRONG: untyped injection key — any type
provide('theme', theme);
const theme = inject('theme'); // type is unknown

// CORRECT: typed InjectionKey
// keys.ts
import type { InjectionKey, Ref } from 'vue';

export interface ThemeConfig {
    mode: 'light' | 'dark';
    primaryColor: string;
}

export const ThemeKey: InjectionKey<Ref<ThemeConfig>> = Symbol('theme');
export const LocaleKey: InjectionKey<Ref<string>> = Symbol('locale');
```

```vue
<!-- Provider component -->
<script setup lang="ts">
import { ThemeKey } from '@/keys';

const theme = ref<ThemeConfig>({ mode: 'light', primaryColor: '#3b82f6' });
provide(ThemeKey, theme);
</script>

<!-- Consumer component -->
<script setup lang="ts">
import { ThemeKey } from '@/keys';

// WRONG: no default — may be undefined at runtime
const theme = inject(ThemeKey);

// CORRECT: provide a default or throw
const theme = inject(ThemeKey);
if (!theme) throw new Error('ThemeKey not provided — wrap component in ThemeProvider');

// OR: provide a default value
const theme = inject(ThemeKey, ref({ mode: 'light' as const, primaryColor: '#3b82f6' }));
</script>
```

### 5.2 Read-Only Provide

```vue
<!-- Provider: expose read-only to prevent child mutations -->
<script setup lang="ts">
const user = ref<User | null>(null);
const updateUser = async (data: Partial<User>) => {
    user.value = await api.patch<User>(`/users/${user.value!.id}`, data);
};

provide(UserKey, readonly(user));
provide(UpdateUserKey, updateUser);
</script>
```

---

## 6. Component v-model

### 6.1 Single v-model

```vue
<!-- CORRECT: defineModel for single v-model -->
<!-- RangeSlider.vue -->
<script setup lang="ts">
const value = defineModel<number>({ required: true });
</script>
<template>
    <input type="range" v-model.number="value" :min="0" :max="100" />
    <span>{{ value }}</span>
</template>

<!-- Parent -->
<template>
    <RangeSlider v-model="brightness" />
</template>
```

### 6.2 Multiple v-models

```vue
<!-- CORRECT: named models -->
<!-- DateRangePicker.vue -->
<script setup lang="ts">
const startDate = defineModel<string>('start', { required: true });
const endDate = defineModel<string>('end', { required: true });
</script>
<template>
    <input type="date" v-model="startDate" />
    <input type="date" v-model="endDate" />
</template>

<!-- Parent -->
<template>
    <DateRangePicker v-model:start="from" v-model:end="to" />
</template>
```

### 6.3 v-model with Modifiers

```vue
<!-- Custom modifier -->
<script setup lang="ts">
const [model, modifiers] = defineModel<string>({
    set(value) {
        if (modifiers.capitalize) {
            return value.charAt(0).toUpperCase() + value.slice(1);
        }
        return value;
    },
});
</script>

<!-- Parent: <MyInput v-model.capitalize="name" /> -->
```

---

## 7. Slots

### 7.1 Default and Named Slots

```vue
<!-- Card.vue -->
<template>
    <div class="card">
        <header v-if="$slots.header" class="card-header">
            <slot name="header" />
        </header>
        <div class="card-body">
            <slot /> <!-- default slot -->
        </div>
        <footer v-if="$slots.footer" class="card-footer">
            <slot name="footer" />
        </footer>
    </div>
</template>

<!-- Usage -->
<Card>
    <template #header>
        <h2>Title</h2>
    </template>

    <p>Card body content goes in the default slot.</p>

    <template #footer>
        <button>Save</button>
    </template>
</Card>
```

### 7.2 Scoped Slots

Pass data from child to parent slot content.

```vue
<!-- DataTable.vue -->
<script setup lang="ts" generic="T">
interface Props {
    items: T[];
    columns: { key: keyof T; label: string }[];
}
const props = defineProps<Props>();
</script>

<template>
    <table>
        <thead>
            <tr>
                <th v-for="col in columns" :key="String(col.key)">{{ col.label }}</th>
            </tr>
        </thead>
        <tbody>
            <tr v-for="(item, index) in items" :key="index">
                <td v-for="col in columns" :key="String(col.key)">
                    <!-- Scoped slot: parent decides how to render each cell -->
                    <slot :name="String(col.key)" :item="item" :value="item[col.key]">
                        {{ item[col.key] }}
                    </slot>
                </td>
            </tr>
        </tbody>
    </table>
</template>

<!-- Usage -->
<DataTable :items="users" :columns="[{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }]">
    <template #role="{ item }">
        <RoleBadge :role="item.role" />
    </template>
</DataTable>
```

### 7.3 Renderless Components (Slots as Logic)

```vue
<!-- Toggle.vue — renderless component -->
<script setup lang="ts">
const isOpen = ref(false);
const toggle = () => { isOpen.value = !isOpen.value; };
</script>

<template>
    <slot :is-open="isOpen" :toggle="toggle" />
</template>

<!-- Usage -->
<Toggle v-slot="{ isOpen, toggle }">
    <button @click="toggle">{{ isOpen ? 'Hide' : 'Show' }}</button>
    <p v-if="isOpen">Toggled content</p>
</Toggle>
```

---

## 8. Async Components & Suspense

### 8.1 defineAsyncComponent

```typescript
// WRONG: importing heavy component synchronously
import HeavyChart from './HeavyChart.vue';

// CORRECT: lazy load
const HeavyChart = defineAsyncComponent(() => import('./HeavyChart.vue'));

// With loading and error states
const HeavyChart = defineAsyncComponent({
    loader: () => import('./HeavyChart.vue'),
    loadingComponent: ChartSkeleton,
    errorComponent: ChartError,
    delay: 200, // show loading after 200ms
    timeout: 10000,
});
```

### 8.2 Suspense (Experimental, Stable Enough for Production)

```vue
<!-- CORRECT: Suspense with async setup -->
<!-- AsyncDashboard.vue -->
<script setup lang="ts">
// Top-level await in <script setup> makes the component async
const stats = await fetchDashboardStats();
const charts = await fetchChartData();
</script>

<template>
    <div>
        <StatsGrid :stats="stats" />
        <ChartPanel :data="charts" />
    </div>
</template>

<!-- Parent wraps in Suspense -->
<template>
    <Suspense>
        <template #default>
            <AsyncDashboard />
        </template>
        <template #fallback>
            <DashboardSkeleton />
        </template>
    </Suspense>
</template>
```

---

## 9. Vue Router 4 Patterns

### 9.1 Typed Route Definitions with Lazy Loading

```typescript
// WRONG: no lazy loading, no types
const routes = [
    { path: '/users', component: UserList },
    { path: '/users/:id', component: UserDetail },
];

// CORRECT: lazy load + typed meta
declare module 'vue-router' {
    interface RouteMeta {
        requiresAuth: boolean;
        roles?: ('admin' | 'editor' | 'viewer')[];
        title?: string;
    }
}

const routes: RouteRecordRaw[] = [
    {
        path: '/users',
        component: () => import('@/pages/UserList.vue'),
        meta: { requiresAuth: true, title: 'Users' },
    },
    {
        path: '/users/:id',
        component: () => import('@/pages/UserDetail.vue'),
        meta: { requiresAuth: true, roles: ['admin', 'editor'] },
        props: true, // pass route params as props
    },
];
```

### 9.2 Navigation Guards

```typescript
// CORRECT: global auth guard
router.beforeEach(async (to) => {
    const auth = useAuthStore();

    if (to.meta.requiresAuth && !auth.isAuthenticated) {
        return { name: 'login', query: { redirect: to.fullPath } };
    }

    if (to.meta.roles && !to.meta.roles.includes(auth.user!.role)) {
        return { name: 'forbidden' };
    }

    // Update document title
    if (to.meta.title) {
        document.title = `${to.meta.title} | My App`;
    }
});
```

### 9.3 Route Props for Decoupling

```typescript
// WRONG: accessing $route inside component
function setup() {
    const route = useRoute();
    const id = computed(() => route.params.id as string);
    // Component is tightly coupled to the router
}

// CORRECT: use props: true — component receives params as props
// Route config
{ path: '/users/:id', component: UserDetail, props: true }

// Component — no router dependency
<script setup lang="ts">
const props = defineProps<{ id: string }>();
// Easier to test, reusable outside routing context
</script>
```

---

## 10. Pinia Store Patterns

### 10.1 Setup Syntax (Recommended)

```typescript
// WRONG: Options API store style (verbose, less flexible)
export const useCounterStore = defineStore('counter', {
    state: () => ({ count: 0 }),
    getters: { doubled: (state) => state.count * 2 },
    actions: { increment() { this.count++; } },
});

// CORRECT: Setup syntax (Composition API)
export const useCounterStore = defineStore('counter', () => {
    const count = ref(0);
    const doubled = computed(() => count.value * 2);
    function increment() {
        count.value++;
    }

    return { count, doubled, increment };
});
```

### 10.2 Store Composition

```typescript
// CORRECT: stores can use other stores
export const useCartStore = defineStore('cart', () => {
    const authStore = useAuthStore();
    const items = ref<CartItem[]>([]);

    const total = computed(() =>
        items.value.reduce((sum, item) => sum + item.price * item.qty, 0),
    );

    async function checkout() {
        if (!authStore.isAuthenticated) {
            throw new Error('Must be logged in to checkout');
        }
        await api.post('/orders', { items: items.value, userId: authStore.user!.id });
        items.value = [];
    }

    return { items, total, checkout };
});
```

### 10.3 Store with TanStack Query (Vue Query)

```typescript
// WRONG: duplicating server state in Pinia
export const useUserStore = defineStore('users', () => {
    const users = ref<User[]>([]);
    const loading = ref(false);
    async function fetchUsers() {
        loading.value = true;
        users.value = await api.get('/users');
        loading.value = false;
    }
    return { users, loading, fetchUsers };
});

// CORRECT: server state in TanStack Query, client state in Pinia
// composables/useUsers.ts — server state
export function useUsers() {
    return useQuery({
        queryKey: ['users'],
        queryFn: () => api.get<User[]>('/users'),
    });
}

// stores/ui.ts — client-only state
export const useUIStore = defineStore('ui', () => {
    const sidebarOpen = ref(true);
    const locale = ref('en');
    return { sidebarOpen, locale };
});
```

---

## 11. Forms with VeeValidate + Zod

### 11.1 Basic Form

```vue
<script setup lang="ts">
import { useForm } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { z } from 'zod';

const schema = toTypedSchema(
    z.object({
        name: z.string().min(1, 'Name is required').max(100),
        email: z.string().email('Invalid email'),
        role: z.enum(['admin', 'editor', 'viewer']),
    }),
);

const { handleSubmit, defineField, errors, isSubmitting } = useForm({
    validationSchema: schema,
    initialValues: { name: '', email: '', role: 'viewer' as const },
});

const [name, nameAttrs] = defineField('name');
const [email, emailAttrs] = defineField('email');
const [role, roleAttrs] = defineField('role');

const onSubmit = handleSubmit(async (values) => {
    await createUser(values);
});
</script>

<template>
    <form @submit="onSubmit" novalidate>
        <div>
            <label for="name">Name</label>
            <input id="name" v-model="name" v-bind="nameAttrs" />
            <span v-if="errors.name" role="alert">{{ errors.name }}</span>
        </div>
        <div>
            <label for="email">Email</label>
            <input id="email" type="email" v-model="email" v-bind="emailAttrs" />
            <span v-if="errors.email" role="alert">{{ errors.email }}</span>
        </div>
        <div>
            <label for="role">Role</label>
            <select id="role" v-model="role" v-bind="roleAttrs">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
            </select>
        </div>
        <button type="submit" :disabled="isSubmitting">
            {{ isSubmitting ? 'Creating...' : 'Create User' }}
        </button>
    </form>
</template>
```

### 11.2 Dynamic Fields with FieldArray

```vue
<script setup lang="ts">
import { useForm, useFieldArray } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { z } from 'zod';

const schema = toTypedSchema(
    z.object({
        items: z
            .array(
                z.object({
                    productId: z.string().min(1, 'Product required'),
                    quantity: z.number().min(1).max(999),
                }),
            )
            .min(1, 'At least one item required'),
    }),
);

const { handleSubmit } = useForm({
    validationSchema: schema,
    initialValues: { items: [{ productId: '', quantity: 1 }] },
});

const { fields, push, remove } = useFieldArray('items');

const onSubmit = handleSubmit(async (values) => {
    await placeOrder(values);
});
</script>

<template>
    <form @submit="onSubmit">
        <div v-for="(field, idx) in fields" :key="field.key">
            <input :name="`items[${idx}].productId`" v-model="field.value.productId" />
            <input :name="`items[${idx}].quantity`" type="number" v-model.number="field.value.quantity" />
            <button type="button" @click="remove(idx)">Remove</button>
        </div>
        <button type="button" @click="push({ productId: '', quantity: 1 })">Add Item</button>
        <button type="submit">Place Order</button>
    </form>
</template>
```

---

## 12. Template Refs & DOM Access

### 12.1 useTemplateRef (Vue 3.5+)

```vue
<script setup lang="ts">
const canvas = useTemplateRef<HTMLCanvasElement>('my-canvas');

onMounted(() => {
    const ctx = canvas.value?.getContext('2d');
    if (ctx) {
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(0, 0, 200, 100);
    }
});
</script>

<template>
    <canvas ref="my-canvas" width="200" height="100" />
</template>
```

### 12.2 Refs on v-for Items

```vue
<script setup lang="ts">
const itemRefs = ref<HTMLLIElement[]>([]);

function scrollToItem(index: number) {
    itemRefs.value[index]?.scrollIntoView({ behavior: 'smooth' });
}
</script>

<template>
    <ul>
        <li
            v-for="(item, i) in items"
            :key="item.id"
            :ref="(el) => { if (el) itemRefs[i] = el as HTMLLIElement }"
        >
            {{ item.name }}
        </li>
    </ul>
</template>
```

### 12.3 Component Refs and defineExpose

```vue
<!-- Parent -->
<script setup lang="ts">
interface FormExposed {
    validate: () => Promise<boolean>;
    reset: () => void;
}

const formRef = useTemplateRef<FormExposed>('registration-form');

async function handleSubmit() {
    const isValid = await formRef.value?.validate();
    if (isValid) {
        // proceed
    }
}
</script>

<template>
    <RegistrationForm ref="registration-form" />
    <button @click="handleSubmit">Submit</button>
</template>
```

---

## 13. Common Mistakes & Anti-Patterns

### 13.1 Mutating Props

```vue
<script setup lang="ts">
// WRONG: mutating a prop directly
const props = defineProps<{ items: Item[] }>();
function addItem(item: Item) {
    props.items.push(item); // Vue will warn — props are read-only
}

// CORRECT: emit an event to let the parent update
const emit = defineEmits<{ add: [item: Item] }>();
function addItem(item: Item) {
    emit('add', item);
}
</script>
```

### 13.2 Losing Reactivity with Destructuring

```vue
<script setup lang="ts">
// WRONG: destructured refs lose reactivity
const store = useCounterStore();
const { count } = store; // plain number, NOT reactive

// CORRECT: use storeToRefs for reactive destructuring
const store = useCounterStore();
const { count } = storeToRefs(store);
// count is now Ref<number> — reactive

// Actions don't need storeToRefs (they are plain functions)
const { increment } = store;
</script>
```

### 13.3 Overusing reactive() When ref() Is Simpler

```vue
<script setup lang="ts">
// WRONG: reactive for a single value
const state = reactive({ loading: false });
state.loading = true;

// CORRECT: ref is simpler for single values
const loading = ref(false);
loading.value = true;
</script>
```

### 13.4 Watching the Wrong Way

```vue
<script setup lang="ts">
// WRONG: watching a ref's .value directly — loses reactivity
const user = ref<User | null>(null);
watch(user.value, () => { /* never fires */ });

// CORRECT: watch the ref, not its value
watch(user, (newUser) => {
    console.log('User changed:', newUser);
});

// CORRECT: use a getter for derived values
watch(
    () => user.value?.name,
    (name) => console.log('Name changed:', name),
);
</script>
```

### 13.5 Not Using Shallow Ref for Large Collections

```vue
<script setup lang="ts">
// WRONG: deep reactive tracking on a list of 10,000 items
const items = ref<Item[]>([]); // Vue deep-watches every property

// CORRECT: shallowRef for large collections you replace, not mutate
const items = shallowRef<Item[]>([]);
// Replace the whole array to trigger reactivity
items.value = [...items.value, newItem];
// items.value.push(newItem) will NOT trigger updates with shallowRef
</script>
```

### 13.6 Options API in New Code

```vue
<!-- WRONG: Options API in a new Vue 3.5+ project -->
<script lang="ts">
export default defineComponent({
    data() { return { count: 0 }; },
    methods: { increment() { this.count++; } },
});
</script>

<!-- CORRECT: Composition API with <script setup> -->
<script setup lang="ts">
const count = ref(0);
const increment = () => { count.value++; };
</script>
```

### 13.7 Missing Key in v-for

```vue
<!-- WRONG: no key or index key on a dynamic list -->
<div v-for="item in items">{{ item.name }}</div>
<div v-for="(item, i) in items" :key="i">{{ item.name }}</div>

<!-- CORRECT: stable unique key -->
<div v-for="item in items" :key="item.id">{{ item.name }}</div>
```

### 13.8 Putting Everything in a Single Store

```typescript
// WRONG: god store
export const useAppStore = defineStore('app', () => {
    const user = ref(null);
    const theme = ref('light');
    const cart = ref([]);
    const notifications = ref([]);
    const sidebarOpen = ref(true);
    // 500 lines of unrelated logic...
});

// CORRECT: separate stores by domain
export const useAuthStore = defineStore('auth', () => { /* ... */ });
export const useUIStore = defineStore('ui', () => { /* ... */ });
export const useCartStore = defineStore('cart', () => { /* ... */ });
// Notifications are likely server state — use TanStack Query
```
