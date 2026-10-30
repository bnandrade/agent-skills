# Styling & UI

Modern styling, component libraries, and UI patterns for production web applications. Tailwind CSS 4, Shadcn/ui, Radix, responsive design, dark mode, animations, and component architecture.

---

## Table of Contents

1. [Tailwind CSS 4](#1-tailwind-css-4)
2. [Shadcn/ui Patterns](#2-shadcnui-patterns)
3. [Radix UI Primitives](#3-radix-ui-primitives)
4. [Headless UI (Vue)](#4-headless-ui-vue)
5. [Responsive Design](#5-responsive-design)
6. [Dark Mode](#6-dark-mode)
7. [Animation Patterns](#7-animation-patterns)
8. [Component Library Architecture](#8-component-library-architecture)
9. [Icon Systems](#9-icon-systems)
10. [Design Tokens & Theming](#10-design-tokens--theming)
11. [CSS-in-JS Alternatives](#11-css-in-js-alternatives)
12. [Common UI Patterns](#12-common-ui-patterns)

---

## 1. Tailwind CSS 4

Tailwind 4 is CSS-first. Configuration lives in CSS, not `tailwind.config.js`.

### 1.1 The @theme Directive

```css
/* WRONG: old tailwind.config.js approach */
/* tailwind.config.js */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: '#3b82f6',
      },
      fontFamily: {
        display: ['Inter', 'sans-serif'],
      },
    },
  },
};

/* CORRECT: CSS-first config with @theme */
/* app.css */
@import "tailwindcss";

@theme {
  --color-brand: #3b82f6;
  --color-brand-light: #60a5fa;
  --color-brand-dark: #2563eb;
  --font-display: "Inter", sans-serif;
  --breakpoint-3xl: 1920px;
  --ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
}
```

### 1.2 CSS-First Config

```css
/* app.css — single source of truth */
@import "tailwindcss";

/* Source detection (replaces content config) */
@source "../src/**/*.{ts,tsx,vue}";
@source "../node_modules/@mylib/ui/dist/**/*.js";

@theme {
  /* Override default spacing scale */
  --spacing-18: 4.5rem;
  --spacing-22: 5.5rem;

  /* Custom radius tokens */
  --radius-card: 0.75rem;
  --radius-button: 0.5rem;

  /* Animation durations */
  --duration-fast: 150ms;
  --duration-normal: 250ms;
}
```

### 1.3 Container Queries

```tsx
// WRONG: media queries for component-level responsiveness
function Card({ title, description }: CardProps) {
  return (
    <div className="p-4 md:p-6 lg:p-8">
      <h3 className="text-sm md:text-base lg:text-lg">{title}</h3>
      <p className="hidden md:block">{description}</p>
    </div>
  );
}

// CORRECT: container queries — component responds to its own container size
function Card({ title, description }: CardProps) {
  return (
    <div className="@container">
      <div className="p-4 @md:p-6 @lg:p-8">
        <h3 className="text-sm @md:text-base @lg:text-lg">{title}</h3>
        <p className="hidden @md:block">{description}</p>
      </div>
    </div>
  );
}
```

### 1.4 New Color Functions

```css
/* Tailwind 4 supports oklch and modern color functions natively */
@theme {
  --color-primary: oklch(0.6 0.2 260);
  --color-primary-light: oklch(0.75 0.15 260);
  --color-primary-dark: oklch(0.45 0.25 260);

  /* Use color-mix for dynamic variants */
  --color-primary-50: color-mix(in oklch, var(--color-primary) 10%, white);
  --color-primary-950: color-mix(in oklch, var(--color-primary) 10%, black);
}
```

### 1.5 Tailwind 4 Utility Updates

```tsx
// WRONG: deprecated patterns
<div className="bg-opacity-50 text-opacity-75">
<div className="decoration-slice">

// CORRECT: Tailwind 4 uses modern CSS
<div className="bg-blue-500/50 text-white/75">
<div className="box-decoration-slice">

// WRONG: ring utilities without explicit width
<button className="ring ring-blue-500">

// CORRECT: explicit ring width
<button className="ring-2 ring-blue-500">

// NEW: built-in support for has/group-has
<div className="has-[:checked]:bg-blue-100">
<div className="group-has-[:focus]:ring-2">
```

---

## 2. Shadcn/ui Patterns

Shadcn/ui is not a component library — it's a collection of copy-paste components you own.

### 2.1 Installation & Setup

```bash
# Initialize in a Vite + React project
npx shadcn@latest init

# Add specific components
npx shadcn@latest add button dialog dropdown-menu toast
```

Components are installed into `src/components/ui/`. You own the code.

### 2.2 Customizing Components

```tsx
// WRONG: wrapping Shadcn components with extra divs for styling
function PrimaryButton({ children, ...props }: ButtonProps) {
  return (
    <div className="inline-block">
      <Button {...props} className="bg-brand text-white">
        {children}
      </Button>
    </div>
  );
}

// CORRECT: edit the component source directly or extend variants
// src/components/ui/button.tsx — add variant to the cva definition
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent",
        brand: "bg-brand text-white hover:bg-brand-dark",  // your custom variant
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
```

### 2.3 Extending with Composition

```tsx
// Build domain-specific components on top of Shadcn primitives
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel?: () => void;
  trigger: React.ReactNode;
  destructive?: boolean;
}

function ConfirmDialog({
  title,
  description,
  onConfirm,
  onCancel,
  trigger,
  destructive = false,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);

  const handleConfirm = () => {
    onConfirm();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); onCancel?.(); }}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 3. Radix UI Primitives

Radix provides accessible, unstyled primitives. Shadcn/ui is built on top of Radix.

### 3.1 Dialog

```tsx
// WRONG: building a modal from scratch
function Modal({ open, onClose, children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50" onClick={onClose}>
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg"
           onClick={(e) => e.stopPropagation()}>
        {children}
        <button onClick={onClose}>X</button>
      </div>
    </div>
  );
}
// Missing: focus trap, Escape key, scroll lock, screen reader announcements, portal

// CORRECT: Radix Dialog handles all accessibility automatically
import * as Dialog from "@radix-ui/react-dialog";

function Modal({ open, onOpenChange, title, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-in fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg animate-in fade-in zoom-in-95">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground mt-2">
            {children}
          </Dialog.Description>
          <Dialog.Close asChild>
            <button className="absolute top-4 right-4" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
// Gets for free: focus trap, Escape close, scroll lock, screen reader, portal rendering
```

### 3.2 Dropdown Menu

```tsx
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

function UserMenu({ user }: { user: User }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-2 rounded-full p-1 hover:bg-accent">
          <Avatar src={user.avatar} fallback={user.name[0]} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[200px] rounded-md bg-popover p-1 shadow-lg"
          sideOffset={5}
          align="end"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-sm font-semibold">
            {user.name}
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="h-px bg-border my-1" />
          <DropdownMenu.Item className="cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent">
            Profile
          </DropdownMenu.Item>
          <DropdownMenu.Item className="cursor-pointer rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent">
            Settings
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="h-px bg-border my-1" />
          <DropdownMenu.Item className="cursor-pointer rounded-sm px-2 py-1.5 text-sm text-destructive outline-none hover:bg-destructive/10">
            Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
```

### 3.3 Tooltip

```tsx
// WRONG: CSS-only tooltip (no keyboard support, bad positioning)
<div className="group relative">
  <button>Help</button>
  <span className="hidden group-hover:block absolute -top-8 bg-black text-white text-xs p-1 rounded">
    More info
  </span>
</div>

// CORRECT: Radix Tooltip
import * as Tooltip from "@radix-ui/react-tooltip";

function InfoTooltip({ content, children }: { content: string; children: React.ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="rounded-md bg-popover px-3 py-1.5 text-sm shadow-md animate-in fade-in-0 zoom-in-95"
            sideOffset={5}
          >
            {content}
            <Tooltip.Arrow className="fill-popover" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
```

### 3.4 Toast (via Sonner)

```tsx
// Sonner is the recommended toast library for Shadcn/ui ecosystem
import { toast, Toaster } from "sonner";

// In your root layout
function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster richColors position="bottom-right" />
    </>
  );
}

// Usage anywhere
function DeleteButton({ id }: { id: string }) {
  const handleDelete = async () => {
    try {
      await deleteItem(id);
      toast.success("Item deleted successfully");
    } catch {
      toast.error("Failed to delete item", {
        description: "Please try again later.",
        action: { label: "Retry", onClick: () => handleDelete() },
      });
    }
  };

  return <Button variant="destructive" onClick={handleDelete}>Delete</Button>;
}

// Promise toast for async operations
function SaveButton() {
  const handleSave = () => {
    toast.promise(saveData(), {
      loading: "Saving...",
      success: "Changes saved!",
      error: "Failed to save changes",
    });
  };

  return <Button onClick={handleSave}>Save</Button>;
}
```

---

## 4. Headless UI (Vue)

Headless UI provides unstyled, accessible components for Vue 3.

```vue
<!-- WRONG: manual disclosure without accessibility -->
<template>
  <div>
    <button @click="open = !open">Menu</button>
    <div v-if="open">
      <a href="/profile">Profile</a>
      <a href="/settings">Settings</a>
    </div>
  </div>
</template>

<!-- CORRECT: Headless UI Menu with full a11y -->
<script setup lang="ts">
import { Menu, MenuButton, MenuItems, MenuItem } from "@headlessui/vue";
</script>

<template>
  <Menu as="div" class="relative">
    <MenuButton class="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-accent">
      Options
    </MenuButton>

    <MenuItems
      class="absolute right-0 mt-2 w-56 rounded-md bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
    >
      <MenuItem v-slot="{ active }">
        <a
          href="/profile"
          :class="[active ? 'bg-accent' : '', 'block px-4 py-2 text-sm']"
        >
          Profile
        </a>
      </MenuItem>
      <MenuItem v-slot="{ active }">
        <a
          href="/settings"
          :class="[active ? 'bg-accent' : '', 'block px-4 py-2 text-sm']"
        >
          Settings
        </a>
      </MenuItem>
    </MenuItems>
  </Menu>
</template>
```

---

## 5. Responsive Design

### 5.1 Mobile-First Approach

```tsx
// WRONG: desktop-first (overriding down)
<div className="grid grid-cols-4 gap-8 lg:grid-cols-3 md:grid-cols-2 sm:grid-cols-1">

// CORRECT: mobile-first (building up)
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 sm:gap-6 lg:gap-8">
```

### 5.2 Breakpoint Strategy

```css
/* Tailwind 4 default breakpoints (customize via @theme) */
@theme {
  --breakpoint-sm: 640px;   /* Landscape phones */
  --breakpoint-md: 768px;   /* Tablets */
  --breakpoint-lg: 1024px;  /* Laptops */
  --breakpoint-xl: 1280px;  /* Desktops */
  --breakpoint-2xl: 1536px; /* Large desktops */
}
```

### 5.3 Container Queries for Components

```tsx
// Container queries make components responsive to their parent, not viewport
function ProductGrid() {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3 @xl:grid-cols-4 gap-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}

// Named containers for nested queries
function DashboardPanel() {
  return (
    <div className="@container/panel">
      <div className="flex flex-col @md/panel:flex-row gap-4">
        <div className="w-full @md/panel:w-1/3">
          <Stats />
        </div>
        <div className="w-full @md/panel:w-2/3">
          <Chart />
        </div>
      </div>
    </div>
  );
}
```

### 5.4 Responsive Typography

```tsx
// WRONG: hardcoded sizes at every breakpoint
<h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl">

// CORRECT: use clamp for fluid typography
<h1 className="text-[clamp(1.5rem,4vw,3rem)]">

// Or define fluid sizes in @theme
```

```css
@theme {
  --text-fluid-lg: clamp(1.125rem, 1vw + 0.75rem, 1.5rem);
  --text-fluid-xl: clamp(1.5rem, 2vw + 1rem, 2.5rem);
  --text-fluid-display: clamp(2rem, 4vw + 1rem, 4.5rem);
}
```

---

## 6. Dark Mode

### 6.1 Tailwind Dark Mode with CSS Variables

```css
/* app.css */
@import "tailwindcss";

@theme {
  /* Light mode (default) */
  --color-background: #ffffff;
  --color-foreground: #0a0a0a;
  --color-card: #ffffff;
  --color-card-foreground: #0a0a0a;
  --color-muted: #f5f5f5;
  --color-muted-foreground: #737373;
  --color-border: #e5e5e5;
  --color-primary: #171717;
  --color-primary-foreground: #fafafa;
}

/* Dark mode overrides */
.dark {
  --color-background: #0a0a0a;
  --color-foreground: #fafafa;
  --color-card: #171717;
  --color-card-foreground: #fafafa;
  --color-muted: #262626;
  --color-muted-foreground: #a3a3a3;
  --color-border: #262626;
  --color-primary: #fafafa;
  --color-primary-foreground: #171717;
}
```

### 6.2 Theme Provider (React)

```tsx
// WRONG: using state only (loses preference on refresh)
const [dark, setDark] = useState(false);

// CORRECT: persist to localStorage + respect system preference
type Theme = "light" | "dark" | "system";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>({ theme: "system", setTheme: () => {} });

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem("theme") as Theme) ?? "system";
  });

  useEffect(() => {
    const root = document.documentElement;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = theme === "dark" || (theme === "system" && systemDark);

    root.classList.toggle("dark", isDark);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Listen for system preference changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle("dark", e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

const useTheme = () => useContext(ThemeContext);
```

### 6.3 Prevent Flash of Wrong Theme

```html
<!-- Add inline script in <head> BEFORE any CSS loads -->
<script>
  (function () {
    const theme = localStorage.getItem("theme");
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (theme === "dark" || (!theme && systemDark)) {
      document.documentElement.classList.add("dark");
    }
  })();
</script>
```

### 6.4 Using Dark Mode in Components

```tsx
// WRONG: conditional classes everywhere
<div className={dark ? "bg-gray-900 text-white" : "bg-white text-black"}>

// CORRECT: use semantic tokens with dark: variant
<div className="bg-background text-foreground">
  <div className="bg-card text-card-foreground border border-border rounded-lg p-4">
    <p className="text-muted-foreground">Secondary text</p>
  </div>
</div>

// Images that need dark mode variants
<img
  src="/logo-light.svg"
  className="dark:hidden"
  alt="Logo"
/>
<img
  src="/logo-dark.svg"
  className="hidden dark:block"
  alt="Logo"
/>
```

---

## 7. Animation Patterns

### 7.1 Framer Motion Basics

```tsx
import { motion, AnimatePresence } from "framer-motion";

// WRONG: CSS transitions with manual state management
function Notification({ show, message }: NotificationProps) {
  return show ? (
    <div className="transition-all duration-300 opacity-100 translate-y-0">
      {message}
    </div>
  ) : null;
}

// CORRECT: Framer Motion handles mount/unmount animations
function Notification({ show, message }: NotificationProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="rounded-lg bg-card p-4 shadow-lg"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

### 7.2 Layout Animations

```tsx
// Animate layout changes (reordering, resizing)
function FilterableTodoList({ todos }: { todos: Todo[] }) {
  return (
    <motion.ul layout className="space-y-2">
      {todos.map((todo) => (
        <motion.li
          key={todo.id}
          layout
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2, layout: { type: "spring", stiffness: 300, damping: 30 } }}
          className="rounded-md border p-3"
        >
          {todo.title}
        </motion.li>
      ))}
    </motion.ul>
  );
}
```

### 7.3 CSS View Transitions API

```tsx
// Native browser API for page/element transitions (Chrome 111+, Safari 18+)
// CORRECT: use for page transitions in SPAs
function navigateTo(path: string) {
  if (!document.startViewTransition) {
    router.push(path);
    return;
  }

  document.startViewTransition(() => {
    router.push(path);
  });
}

// Named view transitions for specific elements
function ProductCard({ product }: { product: Product }) {
  return (
    <div style={{ viewTransitionName: `product-${product.id}` }}>
      <img src={product.image} alt={product.name} />
      <h3>{product.name}</h3>
    </div>
  );
}
```

```css
/* Control view transition animations in CSS */
::view-transition-old(root) {
  animation: fade-out 0.2s ease;
}
::view-transition-new(root) {
  animation: fade-in 0.2s ease;
}

/* Specific element transitions */
::view-transition-group(product-*) {
  animation-duration: 0.3s;
}
```

### 7.4 CSS Transitions for Simple Cases

```tsx
// For simple hover/focus states, CSS transitions are enough
// WRONG: Framer Motion for a hover effect
<motion.button whileHover={{ scale: 1.05 }}>Click</motion.button>

// CORRECT: CSS transition — simpler, no JS overhead
<button className="transition-transform duration-150 hover:scale-105">Click</button>

// Expandable panel with CSS transitions
function CollapsiblePanel({ title, children }: CollapsibleProps) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2">
        <ChevronRight
          className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-90")}
        />
        {title}
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
```

---

## 8. Component Library Architecture

### 8.1 Compound Components

```tsx
// WRONG: mega-component with dozens of props
<DataTable
  data={users}
  columns={columns}
  sortable
  filterable
  selectable
  paginated
  pageSize={20}
  onSort={handleSort}
  onFilter={handleFilter}
  onSelect={handleSelect}
  onPageChange={handlePageChange}
  emptyMessage="No users found"
  loadingMessage="Loading..."
/>

// CORRECT: compound components — composable, readable, flexible
<DataTable data={users}>
  <DataTable.Toolbar>
    <DataTable.Filter column="name" placeholder="Search users..." />
    <DataTable.ViewOptions />
  </DataTable.Toolbar>
  <DataTable.Content>
    <DataTable.Header />
    <DataTable.Body>
      {(row) => (
        <DataTable.Row key={row.id}>
          <DataTable.Cell>{row.name}</DataTable.Cell>
          <DataTable.Cell>{row.email}</DataTable.Cell>
          <DataTable.Cell>
            <Badge variant={row.active ? "default" : "secondary"}>
              {row.active ? "Active" : "Inactive"}
            </Badge>
          </DataTable.Cell>
        </DataTable.Row>
      )}
    </DataTable.Body>
  </DataTable.Content>
  <DataTable.Pagination pageSize={20} />
</DataTable>
```

### 8.2 Polymorphic Components

```tsx
// "as" prop pattern — render as any HTML element or React component
import { type ElementType, type ComponentPropsWithoutRef } from "react";

type TextProps<T extends ElementType = "span"> = {
  as?: T;
  variant?: "body" | "caption" | "label" | "code";
} & ComponentPropsWithoutRef<T>;

function Text<T extends ElementType = "span">({
  as,
  variant = "body",
  className,
  ...props
}: TextProps<T>) {
  const Component = as ?? "span";

  return (
    <Component
      className={cn(
        {
          body: "text-base text-foreground",
          caption: "text-sm text-muted-foreground",
          label: "text-sm font-medium text-foreground",
          code: "font-mono text-sm bg-muted px-1.5 py-0.5 rounded",
        }[variant],
        className
      )}
      {...props}
    />
  );
}

// Usage
<Text>Default span</Text>
<Text as="p" variant="body">Paragraph</Text>
<Text as="label" variant="label" htmlFor="name">Name</Text>
<Text as="code" variant="code">npm install</Text>
<Text as={Link} variant="body" href="/about">Link text</Text>
```

### 8.3 CVA (Class Variance Authority)

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // Base styles always applied
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        success: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
        warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "border border-border text-foreground",
      },
      size: {
        sm: "px-2 py-0.5 text-[10px]",
        default: "px-2.5 py-0.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

// Usage
<Badge>Default</Badge>
<Badge variant="success">Active</Badge>
<Badge variant="destructive" size="lg">Deleted</Badge>
```

---

## 9. Icon Systems

### 9.1 Lucide Icons (Recommended)

```tsx
// WRONG: importing from barrel export
import { Home, User, Settings, ChevronRight } from "lucide-react";
// This can import the entire icon library depending on bundler config

// CORRECT: Lucide tree-shakes properly with named imports — this IS fine
// Vite + Rolldown handles this correctly in 2026
import { Home, User, Settings, ChevronRight } from "lucide-react";

// Usage with consistent sizing
function NavItem({ icon: Icon, label, href }: NavItemProps) {
  return (
    <a href={href} className="flex items-center gap-2 px-3 py-2 text-sm">
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </a>
  );
}

// Dynamic icon (when icon name comes from data/API)
import { icons } from "lucide-react";

function DynamicIcon({ name, ...props }: { name: keyof typeof icons } & LucideProps) {
  const IconComponent = icons[name];
  if (!IconComponent) return null;
  return <IconComponent {...props} />;
}
```

### 9.2 SVG Sprite Approach

```tsx
// For custom icons or performance-critical scenarios
// Generate sprite from SVGs in build step

// sprite.svg contains all icons as <symbol> elements
function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg className={cn("h-4 w-4", className)} aria-hidden="true">
      <use href={`/sprites/icons.svg#${name}`} />
    </svg>
  );
}

// Usage
<Icon name="dashboard" className="h-5 w-5 text-muted-foreground" />
```

### 9.3 Vue Icon Usage (Lucide Vue)

```vue
<script setup lang="ts">
import { Home, User, Settings } from "lucide-vue-next";
</script>

<template>
  <nav>
    <a href="/" class="flex items-center gap-2">
      <Home class="h-4 w-4" />
      Home
    </a>
  </nav>
</template>
```

---

## 10. Design Tokens & Theming

### 10.1 Token Architecture

```css
/* Layered token system: primitive → semantic → component */
@theme {
  /* Primitive tokens — raw values */
  --color-blue-500: oklch(0.62 0.19 255);
  --color-blue-600: oklch(0.55 0.22 255);
  --color-gray-50: oklch(0.98 0 0);
  --color-gray-900: oklch(0.21 0 0);

  /* Semantic tokens — meaning-based */
  --color-primary: var(--color-blue-500);
  --color-primary-hover: var(--color-blue-600);
  --color-background: var(--color-gray-50);
  --color-foreground: var(--color-gray-900);

  /* Component tokens — specific to components */
  --color-button-primary-bg: var(--color-primary);
  --color-button-primary-bg-hover: var(--color-primary-hover);
  --color-button-primary-fg: white;

  /* Spacing scale */
  --spacing-page-x: 1rem;
  --spacing-page-x-lg: 2rem;
  --spacing-section-gap: 2rem;
  --spacing-card-padding: 1.5rem;

  /* Radius scale */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-full: 9999px;
}
```

### 10.2 Multi-Theme Support

```css
/* Define themes as classes */
.theme-blue {
  --color-primary: oklch(0.62 0.19 255);
  --color-primary-hover: oklch(0.55 0.22 255);
}

.theme-green {
  --color-primary: oklch(0.62 0.19 150);
  --color-primary-hover: oklch(0.55 0.22 150);
}

.theme-purple {
  --color-primary: oklch(0.55 0.22 300);
  --color-primary-hover: oklch(0.48 0.25 300);
}
```

```tsx
// Apply theme class to root
function ThemeSwitcher() {
  const [colorTheme, setColorTheme] = useState<string>("theme-blue");

  useEffect(() => {
    const root = document.documentElement;
    root.className = root.className.replace(/theme-\w+/, "");
    root.classList.add(colorTheme);
  }, [colorTheme]);

  return (
    <select value={colorTheme} onChange={(e) => setColorTheme(e.target.value)}>
      <option value="theme-blue">Blue</option>
      <option value="theme-green">Green</option>
      <option value="theme-purple">Purple</option>
    </select>
  );
}
```

---

## 11. CSS-in-JS Alternatives

### 11.1 When to Avoid CSS-in-JS

```tsx
// WRONG in 2026: runtime CSS-in-JS in new projects
// styled-components and Emotion add ~15-20KB to bundle and have runtime cost
import styled from "styled-components";
const Button = styled.button`
  background: ${(p) => p.variant === "primary" ? "blue" : "gray"};
  padding: 8px 16px;
`;

// CORRECT: use Tailwind + CVA for zero-runtime styling
// Same result, zero bundle cost, faster rendering
const buttonVariants = cva("px-4 py-2 rounded-md font-medium", {
  variants: {
    variant: {
      primary: "bg-primary text-primary-foreground",
      secondary: "bg-secondary text-secondary-foreground",
    },
  },
});
```

### 11.2 When CSS-in-JS Makes Sense

- Existing codebase already using it (migration cost vs benefit)
- Heavy dynamic styling based on runtime values (rare in practice)
- If you must use it, prefer zero-runtime solutions: **Panda CSS**, **vanilla-extract**, **StyleX**

```tsx
// If you need dynamic styles, CSS variables beat CSS-in-JS
// WRONG: runtime CSS-in-JS
const Box = styled.div<{ progress: number }>`
  width: ${(p) => p.progress}%;
`;

// CORRECT: CSS variable — no JS runtime cost
function ProgressBar({ progress }: { progress: number }) {
  return (
    <div
      className="h-2 rounded-full bg-primary transition-all duration-300"
      style={{ width: `${progress}%` } as React.CSSProperties}
    />
  );
}

// For many dynamic properties, use CSS custom properties
function GradientCard({ hue, saturation }: GradientCardProps) {
  return (
    <div
      className="rounded-lg p-6 bg-[oklch(var(--card-l)_var(--card-c)_var(--card-h))]"
      style={{
        "--card-h": hue,
        "--card-c": saturation,
        "--card-l": 0.95,
      } as React.CSSProperties}
    >
      Content
    </div>
  );
}
```

---

## 12. Common UI Patterns

### 12.1 Modal/Dialog Pattern

```tsx
// Reusable dialog with Shadcn/ui
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

// Controlled dialog with URL state (enables sharing/bookmarking)
function useDialogState(paramName: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const open = searchParams.has(paramName);

  const setOpen = (value: boolean) => {
    setSearchParams((prev) => {
      if (value) prev.set(paramName, "true");
      else prev.delete(paramName);
      return prev;
    });
  };

  return [open, setOpen] as const;
}

function UserEditDialog({ user }: { user: User }) {
  const [open, setOpen] = useDialogState("edit-user");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Edit</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>Update your profile information.</DialogDescription>
        </DialogHeader>
        <UserForm user={user} onSuccess={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
```

### 12.2 Data Table Pattern

```tsx
// TanStack Table + Shadcn/ui
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel,
  type ColumnDef, flexRender,
} from "@tanstack/react-table";

const columns: ColumnDef<User>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting()}>
        Name
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: "email",
    header: "Email",
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => <Badge>{row.getValue("role")}</Badge>,
    filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
  },
  {
    id: "actions",
    cell: ({ row }) => <UserRowActions user={row.original} />,
  },
];

function UsersTable({ data }: { data: User[] }) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DataTablePagination table={table} />
    </div>
  );
}
```

### 12.3 Infinite Scroll

```tsx
// WRONG: scroll event listener with manual threshold
useEffect(() => {
  const handleScroll = () => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
      loadMore();
    }
  };
  window.addEventListener("scroll", handleScroll);
  return () => window.removeEventListener("scroll", handleScroll);
}, []);

// CORRECT: IntersectionObserver + TanStack Query
function InfiniteUserList() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["users"],
    queryFn: ({ pageParam }) => fetchUsers({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const observerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!observerRef.current || !hasNextPage) return;

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) fetchNextPage(); },
      { rootMargin: "200px" }
    );
    observer.observe(observerRef.current);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage]);

  const users = data?.pages.flatMap((page) => page.users) ?? [];

  return (
    <div>
      {users.map((user) => (
        <UserCard key={user.id} user={user} />
      ))}
      <div ref={observerRef}>
        {isFetchingNextPage && <Spinner />}
      </div>
    </div>
  );
}
```

### 12.4 Command Palette (cmdk)

```tsx
// cmdk is the standard for command palette / search UI
import { Command } from "cmdk";

function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0">
        <Command className="rounded-lg">
          <Command.Input placeholder="Type a command or search..." className="h-12 px-4" />
          <Command.List className="max-h-[300px] overflow-auto p-2">
            <Command.Empty>No results found.</Command.Empty>
            <Command.Group heading="Navigation">
              <Command.Item onSelect={() => navigate("/dashboard")}>
                <Home className="mr-2 h-4 w-4" /> Dashboard
              </Command.Item>
              <Command.Item onSelect={() => navigate("/users")}>
                <Users className="mr-2 h-4 w-4" /> Users
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Actions">
              <Command.Item onSelect={() => setOpen(false)}>
                <Plus className="mr-2 h-4 w-4" /> Create new...
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
```
