# Testing & Quality

Testing patterns for production web applications. Vitest, Testing Library, Playwright, accessibility testing, mocking, and CI integration.

---

## Table of Contents

1. [Vitest Setup & Configuration](#1-vitest-setup--configuration)
2. [Testing Library Philosophy](#2-testing-library-philosophy)
3. [Component Testing](#3-component-testing)
4. [Hook Testing](#4-hook-testing)
5. [Async Testing](#5-async-testing)
6. [Mocking](#6-mocking)
7. [Snapshot Testing](#7-snapshot-testing)
8. [Accessibility Testing](#8-accessibility-testing)
9. [Playwright E2E Testing](#9-playwright-e2e-testing)
10. [Visual Regression Testing](#10-visual-regression-testing)
11. [Test Organization & Naming](#11-test-organization--naming)
12. [What to Test vs What Not to Test](#12-what-to-test-vs-what-not-to-test)
13. [CI Integration](#13-ci-integration)

---

## 1. Vitest Setup & Configuration

### 1.1 Basic Setup

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.stories.{ts,tsx}",
        "src/test/**",
        "src/types/**",
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    // Pool settings for faster execution
    pool: "forks",
    poolOptions: {
      forks: { minForks: 2, maxForks: 8 },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
```

### 1.2 Setup File

```typescript
// src/test/setup.ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Cleanup after each test (React Testing Library)
afterEach(() => {
  cleanup();
});

// Mock IntersectionObserver (not available in jsdom)
const mockIntersectionObserver = vi.fn();
mockIntersectionObserver.mockReturnValue({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
});
window.IntersectionObserver = mockIntersectionObserver;

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
window.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
```

---

## 2. Testing Library Philosophy

### 2.1 Test Behavior, Not Implementation

```tsx
// WRONG: testing implementation details
it("sets isLoading state to true when fetching", () => {
  const { result } = renderHook(() => useUsers());
  expect(result.current.isLoading).toBe(true);
  // Testing internal state, not user behavior
});

// WRONG: testing that a specific function was called
it("calls setUsers when data arrives", () => {
  const setUsersSpy = vi.spyOn(React, "useState");
  render(<UserList />);
  expect(setUsersSpy).toHaveBeenCalled();
});

// CORRECT: test what the user sees and does
it("shows loading spinner while users are being fetched", () => {
  render(<UserList />);
  expect(screen.getByRole("status")).toBeInTheDocument();
});

it("displays user names after loading", async () => {
  render(<UserList />);
  expect(await screen.findByText("Alice Johnson")).toBeInTheDocument();
  expect(screen.getByText("Bob Smith")).toBeInTheDocument();
});
```

### 2.2 Query Priority

Use queries in this order (accessibility-first):

```tsx
// 1. getByRole — best, mirrors how assistive tech sees the page
screen.getByRole("button", { name: "Submit" });
screen.getByRole("heading", { level: 2, name: "Users" });
screen.getByRole("textbox", { name: "Email" });
screen.getByRole("checkbox", { name: "Accept terms" });

// 2. getByLabelText — great for form fields
screen.getByLabelText("Email address");

// 3. getByPlaceholderText — when no label exists (fix the UI first)
screen.getByPlaceholderText("Search...");

// 4. getByText — for non-interactive elements
screen.getByText("No results found");

// 5. getByTestId — LAST RESORT (not user-facing)
screen.getByTestId("user-list");

// WRONG: coupling tests to implementation
container.querySelector(".user-card");
container.querySelector("[data-index='0']");
screen.getByTestId("btn-submit"); // when getByRole("button") works fine
```

---

## 3. Component Testing

### 3.1 Rendering and Assertions

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders with default variant", () => {
    render(<Badge>Active</Badge>);

    const badge = screen.getByText("Active");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("bg-primary");
  });

  it("renders destructive variant", () => {
    render(<Badge variant="destructive">Deleted</Badge>);
    expect(screen.getByText("Deleted")).toHaveClass("bg-destructive");
  });
});
```

### 3.2 User Interactions

```tsx
import userEvent from "@testing-library/user-event";

describe("LoginForm", () => {
  // WRONG: using fireEvent for user interactions
  it("submits the form", () => {
    render(<LoginForm onSubmit={handleSubmit} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  });

  // CORRECT: userEvent simulates real browser behavior (focus, keydown, input, keyup)
  it("submits credentials and shows success message", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Password"), "securepass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "securepass",
    });
  });

  it("shows validation error for invalid email", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSubmit={vi.fn()} />);

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Invalid email address")).toBeInTheDocument();
  });

  it("disables submit button while submitting", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => new Promise((r) => setTimeout(r, 1000)));

    render(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Password"), "securepass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();
  });
});
```

### 3.3 Testing with Providers

```tsx
// Create a custom render that wraps with all providers
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { render, type RenderOptions } from "@testing-library/react";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  initialRoute?: string;
}

function renderWithProviders(ui: React.ReactElement, options: CustomRenderOptions = {}) {
  const { initialRoute = "/", ...renderOptions } = options;
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialRoute]}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return { ...render(ui, { wrapper: Wrapper, ...renderOptions }), queryClient };
}

// Usage
it("shows user profile page", async () => {
  renderWithProviders(<UserProfile />, { initialRoute: "/users/123" });
  expect(await screen.findByText("Alice Johnson")).toBeInTheDocument();
});
```

---

## 4. Hook Testing

### 4.1 renderHook

```tsx
import { renderHook, act } from "@testing-library/react";
import { useCounter } from "@/hooks/use-counter";

describe("useCounter", () => {
  it("initializes with default value", () => {
    const { result } = renderHook(() => useCounter());
    expect(result.current.count).toBe(0);
  });

  it("initializes with provided value", () => {
    const { result } = renderHook(() => useCounter(10));
    expect(result.current.count).toBe(10);
  });

  it("increments and decrements", () => {
    const { result } = renderHook(() => useCounter(0));

    act(() => { result.current.increment(); });
    expect(result.current.count).toBe(1);

    act(() => { result.current.decrement(); });
    expect(result.current.count).toBe(0);
  });

  it("respects min/max bounds", () => {
    const { result } = renderHook(() => useCounter(5, { min: 0, max: 10 }));

    act(() => { result.current.set(15); });
    expect(result.current.count).toBe(10);

    act(() => { result.current.set(-5); });
    expect(result.current.count).toBe(0);
  });
});
```

### 4.2 Testing Hooks with Context

```tsx
// Hooks that depend on context need a wrapper
import { renderHook } from "@testing-library/react";
import { useAuth } from "@/hooks/use-auth";
import { AuthProvider } from "@/providers/auth";

describe("useAuth", () => {
  it("returns authenticated user", () => {
    const mockUser = { id: "1", name: "Alice", role: "admin" as const };

    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <AuthProvider initialUser={mockUser}>{children}</AuthProvider>
      ),
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("throws when used outside provider", () => {
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useAuth())).toThrow(
      "useAuth must be used within AuthProvider"
    );

    spy.mockRestore();
  });
});
```

---

## 5. Async Testing

### 5.1 waitFor and findBy

```tsx
// WRONG: using arbitrary timeouts
it("loads data", async () => {
  render(<UserList />);
  await new Promise((r) => setTimeout(r, 1000));
  expect(screen.getByText("Alice")).toBeInTheDocument();
});

// WRONG: not awaiting async operations
it("loads data", () => {
  render(<UserList />);
  expect(screen.getByText("Alice")).toBeInTheDocument(); // fails — data not loaded yet
});

// CORRECT: findBy* queries wait automatically (combines getBy + waitFor)
it("loads and displays users", async () => {
  render(<UserList />);

  // findBy waits up to 1000ms by default
  expect(await screen.findByText("Alice Johnson")).toBeInTheDocument();
  expect(screen.getByText("Bob Smith")).toBeInTheDocument(); // already rendered
});

// CORRECT: waitFor for complex assertions
it("removes user from list after deletion", async () => {
  const user = userEvent.setup();
  render(<UserList />);

  // Wait for initial load
  expect(await screen.findByText("Alice Johnson")).toBeInTheDocument();

  // Delete user
  await user.click(screen.getByRole("button", { name: "Delete Alice Johnson" }));
  await user.click(screen.getByRole("button", { name: "Confirm" }));

  // Wait for removal
  await waitFor(() => {
    expect(screen.queryByText("Alice Johnson")).not.toBeInTheDocument();
  });
});
```

### 5.2 Testing Loading and Error States

```tsx
describe("UserProfile", () => {
  it("shows loading skeleton initially", () => {
    render(<UserProfile userId="123" />);

    expect(screen.getByRole("status")).toBeInTheDocument(); // spinner/skeleton
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("shows user data after loading", async () => {
    render(<UserProfile userId="123" />);

    expect(await screen.findByRole("heading", { name: "Alice Johnson" }))
      .toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("shows error state when fetch fails", async () => {
    // MSW handler returns error for this test (see Mocking section)
    server.use(
      http.get("/api/users/999", () => HttpResponse.json(null, { status: 404 }))
    );

    render(<UserProfile userId="999" />);

    expect(await screen.findByText("User not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
  });
});
```

---

## 6. Mocking

### 6.1 vi.mock for Modules

```typescript
// WRONG: mocking too much — testing the mock, not the code
vi.mock("@/api/users", () => ({
  fetchUsers: vi.fn().mockResolvedValue([{ id: "1", name: "Alice" }]),
  createUser: vi.fn().mockResolvedValue({ id: "2", name: "Bob" }),
  deleteUser: vi.fn().mockResolvedValue(undefined),
}));

// CORRECT: mock at the network level with MSW — test real code paths
```

### 6.2 MSW (Mock Service Worker)

```typescript
// src/test/mocks/handlers.ts
import { http, HttpResponse } from "msw";

const users = [
  { id: "1", name: "Alice Johnson", email: "alice@example.com" },
  { id: "2", name: "Bob Smith", email: "bob@example.com" },
];

export const handlers = [
  http.get("/api/users", ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get("q");

    const filtered = search
      ? users.filter((u) => u.name.toLowerCase().includes(search.toLowerCase()))
      : users;

    return HttpResponse.json({ data: filtered, total: filtered.length });
  }),

  http.get("/api/users/:id", ({ params }) => {
    const user = users.find((u) => u.id === params.id);
    if (!user) return HttpResponse.json(null, { status: 404 });
    return HttpResponse.json(user);
  }),

  http.post("/api/users", async ({ request }) => {
    const body = await request.json() as { name: string; email: string };
    return HttpResponse.json(
      { id: crypto.randomUUID(), ...body },
      { status: 201 }
    );
  }),

  http.delete("/api/users/:id", () => {
    return new HttpResponse(null, { status: 204 });
  }),
];
```

```typescript
// src/test/mocks/server.ts
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
```

```typescript
// src/test/setup.ts — add to existing setup
import { server } from "./mocks/server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### 6.3 Overriding Handlers Per Test

```tsx
import { server } from "@/test/mocks/server";
import { http, HttpResponse } from "msw";

it("shows error banner when API returns 500", async () => {
  // Override the default handler for this specific test
  server.use(
    http.get("/api/users", () => {
      return HttpResponse.json(
        { message: "Internal server error" },
        { status: 500 }
      );
    })
  );

  render(<UserList />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Failed to load users"
  );
});
```

### 6.4 Mocking Browser APIs

```typescript
// Mock navigator.clipboard
it("copies text to clipboard", async () => {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  render(<CopyButton text="hello" />);
  await user.click(screen.getByRole("button", { name: "Copy" }));

  expect(writeText).toHaveBeenCalledWith("hello");
  expect(await screen.findByText("Copied!")).toBeInTheDocument();
});

// Mock timers
it("shows toast for 3 seconds then hides", async () => {
  vi.useFakeTimers();
  render(<Toast message="Saved!" duration={3000} />);

  expect(screen.getByText("Saved!")).toBeInTheDocument();

  await act(() => vi.advanceTimersByTime(3000));

  expect(screen.queryByText("Saved!")).not.toBeInTheDocument();
  vi.useRealTimers();
});
```

---

## 7. Snapshot Testing

### 7.1 When Useful

```tsx
// GOOD use: small, stable UI components where structure matters
it("renders badge correctly", () => {
  const { container } = render(<Badge variant="success">Active</Badge>);
  expect(container.firstChild).toMatchInlineSnapshot(`
    <span
      class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-100 text-green-800"
    >
      Active
    </span>
  `);
});
```

### 7.2 When NOT Useful

```tsx
// WRONG: snapshot of a large component — brittle, nobody reviews the diff
it("renders the dashboard", () => {
  const { container } = render(<Dashboard />);
  expect(container).toMatchSnapshot();
  // Produces 500+ lines, breaks on any CSS class change, gets rubber-stamped on update
});

// WRONG: snapshot of dynamic content
it("renders user list", () => {
  render(<UserList users={mockUsers} />);
  expect(screen.getByRole("list")).toMatchSnapshot();
  // Breaks whenever mock data changes
});

// CORRECT: assert specific behavior instead
it("renders all users in the list", () => {
  render(<UserList users={mockUsers} />);
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent("Alice Johnson");
});
```

---

## 8. Accessibility Testing

### 8.1 axe-core Integration

```typescript
// Install: npm install -D vitest-axe
// src/test/setup.ts
import "vitest-axe/extend-expect";
```

```tsx
import { axe } from "vitest-axe";

describe("Navigation", () => {
  it("has no accessibility violations", async () => {
    const { container } = render(<Navigation />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// Test specific components for a11y
describe("Form components", () => {
  it("login form is accessible", async () => {
    const { container } = render(<LoginForm onSubmit={vi.fn()} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("dialog is accessible when open", async () => {
    const { container } = render(
      <ConfirmDialog open title="Delete?" onConfirm={vi.fn()}>
        Are you sure?
      </ConfirmDialog>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

### 8.2 Testing Keyboard Navigation

```tsx
it("navigates tabs with arrow keys", async () => {
  const user = userEvent.setup();
  render(<Tabs items={["Tab 1", "Tab 2", "Tab 3"]} />);

  // Focus first tab
  await user.tab();
  expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveFocus();

  // Arrow right to next tab
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveFocus();

  // Arrow right wraps to first
  await user.keyboard("{ArrowRight}");
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveFocus();
});

it("closes dialog with Escape key", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Dialog open onOpenChange={onClose}><p>Content</p></Dialog>);

  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledWith(false);
});
```

### 8.3 Testing ARIA Attributes

```tsx
it("marks required fields with aria-required", () => {
  render(<UserForm />);

  expect(screen.getByLabelText("Email")).toHaveAttribute("aria-required", "true");
  expect(screen.getByLabelText("Name")).toHaveAttribute("aria-required", "true");
  expect(screen.getByLabelText("Bio")).not.toHaveAttribute("aria-required");
});

it("associates error messages with fields via aria-describedby", async () => {
  const user = userEvent.setup();
  render(<UserForm onSubmit={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Submit" }));

  const emailInput = screen.getByLabelText("Email");
  const errorId = emailInput.getAttribute("aria-describedby");
  expect(errorId).toBeTruthy();
  expect(document.getElementById(errorId!)).toHaveTextContent("Email is required");
});
```

---

## 9. Playwright E2E Testing

### 9.1 Setup

```typescript
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "mobile", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
```

### 9.2 Page Object Pattern

```typescript
// e2e/pages/login.page.ts
import { type Page, type Locator, expect } from "@playwright/test";

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel("Email");
    this.passwordInput = page.getByLabel("Password");
    this.submitButton = page.getByRole("button", { name: "Sign in" });
    this.errorMessage = page.getByRole("alert");
  }

  async goto() {
    await this.page.goto("/login");
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async expectError(message: string) {
    await expect(this.errorMessage).toContainText(message);
  }
}

// e2e/pages/dashboard.page.ts
export class DashboardPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly userMenu: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: "Dashboard" });
    this.userMenu = page.getByRole("button", { name: /user menu/i });
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }

  async logout() {
    await this.userMenu.click();
    await this.page.getByRole("menuitem", { name: "Log out" }).click();
  }
}
```

### 9.3 E2E Test Examples

```typescript
// e2e/auth.spec.ts
import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/login.page";
import { DashboardPage } from "./pages/dashboard.page";

test.describe("Authentication", () => {
  test("successful login redirects to dashboard", async ({ page }) => {
    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);

    await loginPage.goto();
    await loginPage.login("admin@example.com", "password123");
    await dashboardPage.expectLoaded();

    await expect(page).toHaveURL("/dashboard");
  });

  test("invalid credentials show error", async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto();
    await loginPage.login("wrong@example.com", "wrong");
    await loginPage.expectError("Invalid email or password");
  });

  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/login");
  });
});
```

### 9.4 Playwright Assertions and Selectors

```typescript
// WRONG: brittle selectors
await page.click("#btn-submit");
await page.locator(".user-card:nth-child(2) .delete-btn").click();

// CORRECT: accessible selectors (same philosophy as Testing Library)
await page.getByRole("button", { name: "Submit" }).click();
await page.getByRole("row", { name: /Alice/ }).getByRole("button", { name: "Delete" }).click();

// Waiting for elements
await expect(page.getByText("Changes saved")).toBeVisible();
await expect(page.getByRole("alert")).toBeHidden();

// Waiting for network
await page.waitForResponse("**/api/users");

// Screenshot assertions
await expect(page.getByTestId("chart")).toHaveScreenshot("revenue-chart.png");
```

---

## 10. Visual Regression Testing

### 10.1 Brief Overview

Use for components where pixel-perfect accuracy matters (charts, complex layouts).

**Chromatic** (integrates with Storybook):
- Captures screenshots of every story
- Compares against baseline on PR
- Cloud-based diffing and approval UI
- Best for design systems

**Percy** (BrowserStack):
- Captures during Playwright/Cypress E2E runs
- Cross-browser visual diffs
- Best for full-page visual testing

```typescript
// Playwright built-in visual regression (free, runs locally)
test("hero section matches snapshot", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".hero")).toHaveScreenshot("hero.png", {
    maxDiffPixelRatio: 0.01,
  });
});
```

---

## 11. Test Organization & Naming

### 11.1 File Structure

```
src/
├── components/
│   └── ui/
│       ├── button.tsx
│       └── button.test.tsx        # Co-located test
├── features/
│   └── users/
│       ├── components/
│       │   ├── user-list.tsx
│       │   └── user-list.test.tsx  # Co-located test
│       ├── hooks/
│       │   ├── use-users.ts
│       │   └── use-users.test.ts
│       └── api.ts
├── test/
│   ├── setup.ts                   # Global test setup
│   ├── test-utils.tsx             # Custom render, helpers
│   └── mocks/
│       ├── handlers.ts            # MSW handlers
│       └── server.ts              # MSW server
e2e/
├── pages/                         # Page objects
│   ├── login.page.ts
│   └── dashboard.page.ts
├── auth.spec.ts                   # E2E specs
└── users.spec.ts
```

### 11.2 Naming Conventions

```tsx
// WRONG: vague test names
it("works correctly", () => { /* ... */ });
it("should render", () => { /* ... */ });
it("handles edge cases", () => { /* ... */ });

// CORRECT: describe what happens and under what condition
describe("UserList", () => {
  it("renders empty state when no users exist", () => { /* ... */ });
  it("displays all user names and emails", () => { /* ... */ });
  it("filters users by search query", async () => { /* ... */ });
  it("shows error message when fetch fails", async () => { /* ... */ });
  it("disables delete button for non-admin users", () => { /* ... */ });
});

// Pattern: "[action/state] when [condition]"
// "renders empty state when no users exist"
// "disables submit button when form is invalid"
// "shows validation error when email is malformed"
```

---

## 12. What to Test vs What Not to Test

### 12.1 DO Test

```
- User-visible behavior (rendering, interactions, navigation)
- Form validation and submission
- Error states (network errors, 404s, validation errors)
- Loading states
- Conditional rendering based on data/permissions
- Accessibility (keyboard nav, ARIA, screen reader output)
- Custom hooks with non-trivial logic
- Utility functions with edge cases
- Integration between components that communicate
```

### 12.2 DO NOT Test

```
- Third-party library internals (Radix renders correctly, React Router navigates)
- CSS styling (use visual regression for pixel checks)
- Implementation details (state variable names, render counts, effect execution order)
- Simple prop-forwarding components with no logic
- TypeScript types (the compiler tests those)
- Constants/config files
- Generated code (API clients, GraphQL types)
```

### 12.3 Test Pyramid for Frontend

```
          /  \         E2E (Playwright): 10-20 tests
         /    \        Critical user journeys only
        /------\
       /        \      Integration: 50-100 tests
      /          \     Components with data fetching, routing, context
     /            \
    /--------------\
   /                \   Unit: 200+ tests
  /                  \  Hooks, utilities, pure components
 /____________________\
```

---

## 13. CI Integration

### 13.1 GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Test

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "npm"
      - run: npm ci
      - run: npx vitest run --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-report
          path: coverage/

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "npm"
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test --project=chromium
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "npm"
      - run: npm ci
      - run: npx biome check .
      - run: npx tsc --noEmit
```

### 13.2 Pre-Commit Testing

```json
// package.json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "check": "biome check . && tsc --noEmit && vitest run"
  }
}
```

```yaml
# .husky/pre-push (run fast checks before push)
npm run check
```
