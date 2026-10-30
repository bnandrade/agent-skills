# Frontend Integration

Blade, Livewire, Inertia.js, Filament, Vite, Alpine.js, and Tailwind CSS — when to use what and how to do it right in Laravel 13.

---

## Table of Contents

1. [Decision Matrix: Blade vs Livewire vs Inertia](#1-decision-matrix)
2. [Blade Templates](#2-blade-templates)
3. [Livewire 4](#3-livewire-4)
4. [Inertia.js](#4-inertiajs)
5. [Alpine.js Integration](#5-alpinejs-integration)
6. [Filament](#6-filament)
7. [Vite Configuration](#7-vite-configuration)
8. [Tailwind CSS with Laravel](#8-tailwind-css-with-laravel)
9. [Asset Versioning & Cache Busting](#9-asset-versioning--cache-busting)

---

## 1. Decision Matrix

| Criteria | Blade | Blade + Livewire | Inertia (React/Vue) |
|---|---|---|---|
| Team knows PHP only | **Best** | **Best** | Not ideal |
| Team knows React/Vue | OK | OK | **Best** |
| SEO critical (public pages) | **Best** | Good | Needs SSR |
| Highly interactive UI | Limited | Good | **Best** |
| Real-time features | Limited | **Best** (polling, streams) | Good (with Echo) |
| Admin panel / CRUD | OK | Good | OK |
| SPA-like navigation | No | Partial (wire:navigate) | **Best** |
| API already exists | N/A | N/A | **Best** |
| Time to prototype | Fast | Fast | Medium |
| Bundle size | Zero JS | ~30KB | 50-200KB+ |

**Rules of thumb:**

- **Blade alone** — content sites, emails, PDFs, server-rendered pages with minimal JS
- **Blade + Livewire** — interactive forms, dashboards, real-time updates, teams that prefer PHP
- **Inertia.js** — SPA experience, complex client-side state, teams experienced with React/Vue
- **Filament** — admin panels, back-office CRUD, rapid prototyping of internal tools

---

## 2. Blade Templates

### Layouts with Components

```blade
{{-- resources/views/components/layouts/app.blade.php --}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $title ?? config('app.name') }}</title>
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="antialiased">
    <x-navbar />

    <main class="container mx-auto px-4 py-8">
        {{ $slot }}
    </main>

    <x-footer />
</body>
</html>
```

```blade
{{-- resources/views/dashboard.blade.php --}}
<x-layouts.app title="Dashboard">
    <h1>Welcome, {{ auth()->user()->name }}</h1>
    <x-stats-grid :stats="$stats" />
</x-layouts.app>
```

### Components with Props and Slots

```php
// app/View/Components/Alert.php
namespace App\View\Components;

use Illuminate\View\Component;

class Alert extends Component
{
    public function __construct(
        public readonly string $type = 'info',
        public readonly bool $dismissible = false,
    ) {}

    public function colorClasses(): string
    {
        return match ($this->type) {
            'success' => 'bg-green-100 text-green-800 border-green-300',
            'error' => 'bg-red-100 text-red-800 border-red-300',
            'warning' => 'bg-yellow-100 text-yellow-800 border-yellow-300',
            default => 'bg-blue-100 text-blue-800 border-blue-300',
        };
    }

    public function render(): \Illuminate\View\View
    {
        return view('components.alert');
    }
}
```

```blade
{{-- resources/views/components/alert.blade.php --}}
<div {{ $attributes->merge(['class' => 'rounded-lg border p-4 ' . $colorClasses()]) }}
     x-data="{ show: true }"
     x-show="show">
    <div class="flex items-center justify-between">
        <div>{{ $slot }}</div>
        @if($dismissible)
            <button @click="show = false" class="ml-4">&times;</button>
        @endif
    </div>
</div>

{{-- Usage --}}
<x-alert type="success" dismissible>Order placed successfully!</x-alert>
<x-alert type="error">{{ $errorMessage }}</x-alert>
```

### Anonymous Components (No PHP Class)

```blade
{{-- resources/views/components/button.blade.php --}}
@props([
    'variant' => 'primary',
    'size' => 'md',
    'href' => null,
])

@php
$classes = match($variant) {
    'primary' => 'bg-indigo-600 text-white hover:bg-indigo-700',
    'secondary' => 'bg-gray-200 text-gray-800 hover:bg-gray-300',
    'danger' => 'bg-red-600 text-white hover:bg-red-700',
};

$sizes = match($size) {
    'sm' => 'px-3 py-1.5 text-sm',
    'md' => 'px-4 py-2 text-base',
    'lg' => 'px-6 py-3 text-lg',
};
@endphp

@if($href)
    <a href="{{ $href }}" {{ $attributes->merge(['class' => "inline-flex items-center rounded-md font-semibold {$classes} {$sizes}"]) }}>
        {{ $slot }}
    </a>
@else
    <button {{ $attributes->merge(['class' => "inline-flex items-center rounded-md font-semibold {$classes} {$sizes}"]) }}>
        {{ $slot }}
    </button>
@endif

{{-- Usage --}}
<x-button>Save</x-button>
<x-button variant="danger" size="sm" @click="confirmDelete">Delete</x-button>
<x-button variant="secondary" href="{{ route('dashboard') }}">Back</x-button>
```

### Key Directives

```blade
{{-- Conditional rendering --}}
@auth
    <p>Welcome, {{ auth()->user()->name }}</p>
@endauth

@guest
    <a href="{{ route('login') }}">Login</a>
@endguest

{{-- Enum matching --}}
@switch($order->status)
    @case(OrderStatus::Pending)
        <x-badge color="yellow">Pending</x-badge>
        @break
    @case(OrderStatus::Shipped)
        <x-badge color="blue">Shipped</x-badge>
        @break
@endswitch

{{-- Loops --}}
@forelse($posts as $post)
    <x-post-card :post="$post" />
@empty
    <p>No posts found.</p>
@endforelse

{{-- Feature flags --}}
@feature('new-dashboard')
    <x-new-dashboard />
@else
    <x-legacy-dashboard />
@endfeature

{{-- Error display --}}
@error('email')
    <p class="text-red-500 text-sm mt-1">{{ $message }}</p>
@enderror
```

### WRONG/CORRECT: Blade Patterns

```blade
{{-- WRONG: logic in templates --}}
@php
    $users = App\Models\User::where('active', true)->get();
@endphp
@foreach($users as $user)
    {{ $user->name }}
@endforeach

{{-- CORRECT: pass data from controller --}}
{{-- Controller: return view('users.index', ['users' => User::active()->get()]) --}}
@foreach($users as $user)
    {{ $user->name }}
@endforeach
```

```blade
{{-- WRONG: unescaped output without reason --}}
{!! $user->bio !!}

{{-- CORRECT: escape by default, unescaped only for trusted HTML --}}
{{ $user->bio }}
{!! $user->rendered_markdown !!} {{-- only when you sanitized it --}}
```

---

## 3. Livewire 4

### Basic Component

```bash
php artisan make:livewire SearchUsers
# Creates: app/Livewire/SearchUsers.php
#          resources/views/livewire/search-users.blade.php
```

```php
namespace App\Livewire;

use Livewire\Component;
use Livewire\WithPagination;
use Livewire\Attributes\Url;
use Livewire\Attributes\Computed;

class SearchUsers extends Component
{
    use WithPagination;

    #[Url(as: 'q')]
    public string $search = '';

    public string $role = '';

    // Reset pagination when filters change
    public function updatedSearch(): void
    {
        $this->resetPage();
    }

    #[Computed]
    public function users()
    {
        return User::query()
            ->when($this->search, fn ($q) => $q->where('name', 'like', "%{$this->search}%"))
            ->when($this->role, fn ($q) => $q->where('role', $this->role))
            ->with('department')
            ->paginate(15);
    }

    public function render()
    {
        return view('livewire.search-users');
    }
}
```

```blade
{{-- resources/views/livewire/search-users.blade.php --}}
<div>
    <div class="flex gap-4 mb-6">
        <input wire:model.live.debounce.300ms="search"
               type="text"
               placeholder="Search users..."
               class="rounded-lg border px-4 py-2">

        <select wire:model.live="role" class="rounded-lg border px-4 py-2">
            <option value="">All Roles</option>
            @foreach(RoleEnum::cases() as $r)
                <option value="{{ $r->value }}">{{ $r->label() }}</option>
            @endforeach
        </select>
    </div>

    <div class="space-y-2">
        @foreach($this->users as $user)
            <x-user-card :user="$user" wire:key="{{ $user->id }}" />
        @endforeach
    </div>

    {{ $this->users->links() }}
</div>
```

### Forms & Real-Time Validation

```php
namespace App\Livewire;

use Livewire\Component;
use Livewire\Attributes\Validate;

class CreateUser extends Component
{
    #[Validate('required|string|max:255')]
    public string $name = '';

    #[Validate('required|email|unique:users')]
    public string $email = '';

    #[Validate('required|min:8|confirmed')]
    public string $password = '';

    public string $password_confirmation = '';

    public function save(): void
    {
        $validated = $this->validate();

        $user = User::create([
            ...$validated,
            'password' => Hash::make($validated['password']),
        ]);

        $this->redirect(route('users.show', $user), navigate: true);
        session()->flash('success', 'User created successfully.');
    }

    public function render()
    {
        return view('livewire.create-user');
    }
}
```

```blade
<form wire:submit="save" class="space-y-4">
    <div>
        <label for="name">Name</label>
        <input wire:model.blur="name" id="name" type="text" class="w-full rounded border px-3 py-2">
        @error('name') <span class="text-red-500 text-sm">{{ $message }}</span> @enderror
    </div>

    <div>
        <label for="email">Email</label>
        <input wire:model.blur="email" id="email" type="email" class="w-full rounded border px-3 py-2">
        @error('email') <span class="text-red-500 text-sm">{{ $message }}</span> @enderror
    </div>

    <div>
        <label for="password">Password</label>
        <input wire:model="password" id="password" type="password" class="w-full rounded border px-3 py-2">
        @error('password') <span class="text-red-500 text-sm">{{ $message }}</span> @enderror
    </div>

    <div>
        <label for="password_confirmation">Confirm Password</label>
        <input wire:model="password_confirmation" id="password_confirmation" type="password" class="w-full rounded border px-3 py-2">
    </div>

    <x-button type="submit" wire:loading.attr="disabled">
        <span wire:loading.remove>Create User</span>
        <span wire:loading>Creating...</span>
    </x-button>
</form>
```

### File Uploads

```php
use Livewire\WithFileUploads;
use Livewire\Attributes\Validate;

class UpdateAvatar extends Component
{
    use WithFileUploads;

    #[Validate('image|max:2048')] // 2MB max
    public $photo;

    public function save(): void
    {
        $this->validate();

        $path = $this->photo->store('avatars', 'public');
        auth()->user()->update(['avatar' => $path]);

        $this->dispatch('avatar-updated');
    }
}
```

### Lazy Loading

```blade
{{-- Heavy component loads after page paint --}}
<livewire:heavy-stats-dashboard lazy />

{{-- Inside the component, define a placeholder: --}}
```

```php
class HeavyStatsDashboard extends Component
{
    public function placeholder(): string
    {
        return <<<'HTML'
        <div class="animate-pulse bg-gray-200 rounded-lg h-64"></div>
        HTML;
    }
}
```

### WRONG/CORRECT: Livewire Patterns

```php
// WRONG: querying in render() without #[Computed]
public function render()
{
    return view('livewire.users', [
        'users' => User::where('name', 'like', "%{$this->search}%")->get(),
    ]);
    // This runs the query on EVERY re-render (including every keypress)
}

// CORRECT: use #[Computed] — cached for the component lifecycle
#[Computed]
public function users()
{
    return User::where('name', 'like', "%{$this->search}%")->get();
}

public function render()
{
    return view('livewire.users');
    // Access in Blade: $this->users
}
```

```php
// WRONG: wire:model.live on every field (unnecessary network requests)
<input wire:model.live="address">
<input wire:model.live="city">
<input wire:model.live="zip">

// CORRECT: use .blur for validation, .live only when needed for real-time search
<input wire:model.blur="address">   {{-- validates on blur --}}
<input wire:model.blur="city">
<input wire:model.live.debounce.300ms="search">  {{-- only search is real-time --}}
```

---

## 4. Inertia.js

Inertia connects your Laravel backend to a React/Vue/Svelte frontend without building an API.

### Setup

```bash
composer require inertiajs/inertia-laravel
npm install @inertiajs/react  # or @inertiajs/vue3
```

### How It Works

```php
// Controller — return Inertia response (not a Blade view)
use Inertia\Inertia;

class UserController extends Controller
{
    public function index(): \Inertia\Response
    {
        return Inertia::render('Users/Index', [
            'users' => UserResource::collection(
                User::query()
                    ->with('department')
                    ->paginate(15)
            ),
            'filters' => request()->only(['search', 'role']),
        ]);
    }

    public function show(User $user): \Inertia\Response
    {
        return Inertia::render('Users/Show', [
            'user' => new UserResource($user->load('posts', 'department')),
        ]);
    }
}
```

```tsx
// resources/js/Pages/Users/Index.tsx
import { Head, Link, router } from '@inertiajs/react';
import { useState } from 'react';

interface User {
    id: number;
    name: string;
    email: string;
    department: { name: string };
}

interface Props {
    users: { data: User[]; links: any[] };
    filters: { search?: string; role?: string };
}

export default function UsersIndex({ users, filters }: Props) {
    const [search, setSearch] = useState(filters.search ?? '');

    function handleSearch(value: string) {
        setSearch(value);
        router.get('/users', { search: value }, {
            preserveState: true,
            replace: true,
        });
    }

    return (
        <>
            <Head title="Users" />
            <input
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search users..."
            />
            {users.data.map((user) => (
                <Link key={user.id} href={`/users/${user.id}`}>
                    {user.name} — {user.department.name}
                </Link>
            ))}
        </>
    );
}
```

### Shared Data (Available on Every Page)

```php
// app/Http/Middleware/HandleInertiaRequests.php
public function share(Request $request): array
{
    return [
        ...parent::share($request),
        'auth' => [
            'user' => $request->user()
                ? new AuthUserResource($request->user())
                : null,
        ],
        'flash' => [
            'success' => $request->session()->get('success'),
            'error' => $request->session()->get('error'),
        ],
    ];
}
```

### Forms

```tsx
import { useForm } from '@inertiajs/react';

export default function CreateUser() {
    const { data, setData, post, processing, errors } = useForm({
        name: '',
        email: '',
        password: '',
    });

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        post('/users');
    }

    return (
        <form onSubmit={handleSubmit}>
            <input
                value={data.name}
                onChange={(e) => setData('name', e.target.value)}
            />
            {errors.name && <span className="text-red-500">{errors.name}</span>}

            <input
                value={data.email}
                onChange={(e) => setData('email', e.target.value)}
            />
            {errors.email && <span className="text-red-500">{errors.email}</span>}

            <button type="submit" disabled={processing}>
                {processing ? 'Creating...' : 'Create User'}
            </button>
        </form>
    );
}
```

### SSR (Server-Side Rendering)

```bash
npm install @inertiajs/server
php artisan inertia:start-ssr
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [
        laravel({
            input: 'resources/js/app.tsx',
            ssr: 'resources/js/ssr.tsx',
            refresh: true,
        }),
        react(),
    ],
});
```

### WRONG/CORRECT: Inertia Patterns

```php
// WRONG: passing entire Eloquent model (leaks data, not serializable)
return Inertia::render('Users/Show', [
    'user' => $user,
]);

// CORRECT: use API Resources for controlled serialization
return Inertia::render('Users/Show', [
    'user' => new UserResource($user),
]);
```

```php
// WRONG: eager loading everything even when the page doesn't need it
return Inertia::render('Users/Index', [
    'users' => User::with('posts', 'comments', 'orders', 'invoices')->get(),
]);

// CORRECT: lazy props — only loaded when the frontend needs them
return Inertia::render('Users/Index', [
    'users' => UserResource::collection(User::paginate(15)),
    'stats' => Inertia::lazy(fn () => [
        'totalUsers' => User::count(),
        'activeUsers' => User::active()->count(),
    ]),
]);
```

---

## 5. Alpine.js Integration

Alpine.js ships with Laravel and works seamlessly with Blade and Livewire.

### Common Patterns

```blade
{{-- Dropdown --}}
<div x-data="{ open: false }" class="relative">
    <button @click="open = !open">Menu</button>
    <div x-show="open" @click.away="open = false" x-transition
         class="absolute mt-2 w-48 bg-white shadow-lg rounded-lg">
        <a href="/profile" class="block px-4 py-2">Profile</a>
        <a href="/settings" class="block px-4 py-2">Settings</a>
    </div>
</div>

{{-- Tabs --}}
<div x-data="{ tab: 'overview' }">
    <div class="flex gap-2 border-b">
        <button @click="tab = 'overview'" :class="tab === 'overview' && 'border-b-2 border-indigo-600'">Overview</button>
        <button @click="tab = 'details'" :class="tab === 'details' && 'border-b-2 border-indigo-600'">Details</button>
    </div>
    <div x-show="tab === 'overview'">Overview content</div>
    <div x-show="tab === 'details'">Details content</div>
</div>

{{-- Confirm dialog --}}
<button @click="if (confirm('Are you sure?')) $wire.delete({{ $item->id }})">
    Delete
</button>

{{-- Copy to clipboard --}}
<div x-data="{ copied: false }">
    <code>{{ $apiKey }}</code>
    <button @click="navigator.clipboard.writeText('{{ $apiKey }}'); copied = true; setTimeout(() => copied = false, 2000)">
        <span x-text="copied ? 'Copied!' : 'Copy'"></span>
    </button>
</div>
```

### Alpine + Livewire Interop

```blade
{{-- Listen for Livewire events in Alpine --}}
<div x-data="{ showModal: false }"
     @item-saved.window="showModal = false">

    <button @click="showModal = true">Add Item</button>

    <div x-show="showModal" x-transition>
        <livewire:create-item-form />
        {{-- The Livewire component dispatches: $this->dispatch('item-saved') --}}
    </div>
</div>

{{-- Pass Alpine data to Livewire --}}
<div x-data="{ selectedIds: [] }">
    <template x-for="user in users">
        <label>
            <input type="checkbox" :value="user.id" x-model="selectedIds">
            <span x-text="user.name"></span>
        </label>
    </template>
    <button @click="$wire.bulkDelete(selectedIds)">Delete Selected</button>
</div>
```

---

## 6. Filament

Rapid admin panel development for Laravel. Use for back-office, CRUDs, and dashboards.

### Resource (CRUD)

```bash
php artisan make:filament-resource Product --generate
# Generates: ProductResource, ListProducts, CreateProduct, EditProduct
```

```php
namespace App\Filament\Resources;

use Filament\Resources\Resource;
use Filament\Forms;
use Filament\Tables;

class ProductResource extends Resource
{
    protected static ?string $model = Product::class;
    protected static ?string $navigationIcon = 'heroicon-o-shopping-bag';
    protected static ?string $navigationGroup = 'Shop';

    public static function form(Forms\Form $form): Forms\Form
    {
        return $form->schema([
            Forms\Components\Section::make('Product Info')->schema([
                Forms\Components\TextInput::make('name')
                    ->required()
                    ->maxLength(255)
                    ->live(onBlur: true)
                    ->afterStateUpdated(fn ($set, $state) => $set('slug', Str::slug($state))),

                Forms\Components\TextInput::make('slug')
                    ->required()
                    ->unique(ignoreRecord: true),

                Forms\Components\RichEditor::make('description')
                    ->columnSpanFull(),

                Forms\Components\TextInput::make('price')
                    ->numeric()
                    ->prefix('R$')
                    ->required(),

                Forms\Components\Select::make('category_id')
                    ->relationship('category', 'name')
                    ->searchable()
                    ->preload()
                    ->createOptionForm([
                        Forms\Components\TextInput::make('name')->required(),
                    ]),

                Forms\Components\Select::make('status')
                    ->options(ProductStatus::class)
                    ->required(),
            ])->columns(2),

            Forms\Components\Section::make('Media')->schema([
                Forms\Components\FileUpload::make('images')
                    ->image()
                    ->multiple()
                    ->reorderable()
                    ->maxFiles(5)
                    ->directory('products'),
            ]),
        ]);
    }

    public static function table(Tables\Table $table): Tables\Table
    {
        return $table
            ->columns([
                Tables\Columns\ImageColumn::make('images')
                    ->circular()
                    ->limit(3),
                Tables\Columns\TextColumn::make('name')
                    ->searchable()
                    ->sortable(),
                Tables\Columns\TextColumn::make('price')
                    ->money('BRL')
                    ->sortable(),
                Tables\Columns\TextColumn::make('category.name')
                    ->sortable(),
                Tables\Columns\BadgeColumn::make('status')
                    ->colors([
                        'success' => ProductStatus::Active->value,
                        'warning' => ProductStatus::Draft->value,
                        'danger' => ProductStatus::Archived->value,
                    ]),
            ])
            ->filters([
                Tables\Filters\SelectFilter::make('status')
                    ->options(ProductStatus::class),
                Tables\Filters\SelectFilter::make('category')
                    ->relationship('category', 'name'),
            ])
            ->actions([
                Tables\Actions\EditAction::make(),
                Tables\Actions\DeleteAction::make(),
            ])
            ->bulkActions([
                Tables\Actions\DeleteBulkAction::make(),
            ]);
    }
}
```

### Dashboard Widgets

```php
namespace App\Filament\Widgets;

use Filament\Widgets\StatsOverviewWidget;

class SalesOverview extends StatsOverviewWidget
{
    protected function getStats(): array
    {
        return [
            StatsOverviewWidget\Stat::make('Revenue', 'R$ ' . number_format(Order::sum('total'), 2, ',', '.'))
                ->description('12% increase')
                ->descriptionIcon('heroicon-m-arrow-trending-up')
                ->color('success')
                ->chart([7, 3, 4, 5, 6, 3, 5, 8]),

            StatsOverviewWidget\Stat::make('Orders', Order::count())
                ->description('32 new today')
                ->color('primary'),

            StatsOverviewWidget\Stat::make('Customers', User::count())
                ->description('Active users')
                ->color('info'),
        ];
    }
}
```

---

## 7. Vite Configuration

### Basic Setup

```js
// vite.config.js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';

export default defineConfig({
    plugins: [
        laravel({
            input: [
                'resources/css/app.css',
                'resources/js/app.js',
            ],
            refresh: true, // auto-refresh on Blade/PHP changes
        }),
    ],
});
```

### With React/TypeScript

```js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        laravel({
            input: 'resources/js/app.tsx',
            refresh: true,
        }),
        react(),
        tailwindcss(),
    ],
    resolve: {
        alias: {
            '@': '/resources/js',
        },
    },
});
```

### Multiple Entry Points

```js
// Separate bundles for frontend and admin
laravel({
    input: [
        'resources/css/app.css',
        'resources/js/app.js',
        'resources/css/admin.css',
        'resources/js/admin.js',
    ],
    refresh: true,
}),
```

```blade
{{-- Frontend --}}
@vite(['resources/css/app.css', 'resources/js/app.js'])

{{-- Admin --}}
@vite(['resources/css/admin.css', 'resources/js/admin.js'])
```

### WRONG/CORRECT: Vite Patterns

```blade
{{-- WRONG: hardcoding asset paths (no versioning, breaks in production) --}}
<link rel="stylesheet" href="/css/app.css">
<script src="/js/app.js"></script>

{{-- CORRECT: use @vite directive --}}
@vite(['resources/css/app.css', 'resources/js/app.js'])
```

```js
// WRONG: importing from node_modules with full path
import axios from '../../node_modules/axios/dist/axios.js';

// CORRECT: Vite resolves node_modules automatically
import axios from 'axios';
```

---

## 8. Tailwind CSS with Laravel

### Setup (Tailwind 4 + Vite Plugin)

```bash
npm install tailwindcss @tailwindcss/vite
```

```css
/* resources/css/app.css */
@import "tailwindcss";

/* Custom theme */
@theme {
    --color-brand: #4f46e5;
    --color-brand-light: #818cf8;
    --font-family-sans: 'Inter', sans-serif;
}
```

```js
// vite.config.js
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        laravel({ input: ['resources/css/app.css', 'resources/js/app.js'] }),
        tailwindcss(),
    ],
});
```

### Blade Component with Tailwind

```blade
{{-- Composable utility via @props + merge --}}
@props(['variant' => 'default'])

@php
$variants = [
    'default' => 'bg-white border border-gray-200 shadow-sm',
    'elevated' => 'bg-white shadow-lg',
    'flat' => 'bg-gray-50',
];
@endphp

<div {{ $attributes->merge(['class' => "rounded-xl p-6 {$variants[$variant]}"]) }}>
    @if(isset($header))
        <div class="mb-4 font-semibold text-lg">{{ $header }}</div>
    @endif
    {{ $slot }}
</div>
```

---

## 9. Asset Versioning & Cache Busting

### Vite Handles It Automatically

In production, `@vite()` generates hashed filenames:

```html
<!-- Dev -->
<script src="http://localhost:5173/resources/js/app.js"></script>

<!-- Production (after `npm run build`) -->
<script src="/build/assets/app-4e8f3a2b.js"></script>
```

### Cache Headers for Static Assets

```php
// In nginx config or via middleware
// Vite-built assets already have content hashes — set long cache:
location /build/assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### WRONG/CORRECT: Asset Management

```php
// WRONG: using mix() or asset() for Vite projects
<link rel="stylesheet" href="{{ mix('css/app.css') }}">

// CORRECT: use @vite
@vite(['resources/css/app.css', 'resources/js/app.js'])
```

```php
// WRONG: storing user uploads in public/ (no versioning, no CDN)
$path = $file->move(public_path('uploads'), $filename);

// CORRECT: use Storage with public disk
$path = $request->file('avatar')->store('avatars', 'public');
$url = Storage::disk('public')->url($path);
```

### Production Build

```bash
# Build for production
npm run build

# Laravel caches the manifest automatically
# Output goes to public/build/
```
