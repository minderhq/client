# minder-client

Minder's **management console** — the operator web UI (open source, Apache-2.0).
React 18 + Vite + React Router 7 + Tailwind 4, ~6.3k LOC. Served on `:8009`
(loopback + Traefik `client.minder.local`, forward-auth gated).

> Distinct from **OpenWebUI** (that's the chat UI). This is the plugin-config /
> knowledge-base / pipeline / model / graph / voice **management** UI. It talks to
> the Minder api-gateway (`:8000`) through a thin typed fetch layer
> (`src/lib/api.ts`); it never calls downstream services directly.

This is a standalone repository. The Minder core consumes it as a **git
submodule** (mounted at `src/services/client`) and builds this same `Dockerfile`
via its compose stack — so the console is developed, tested, and versioned here,
independently of the (closed-source) core.

## Run / check

```bash
npm install
npm run dev          # Vite dev server (localhost:5173)

# The CI-mirroring checks — green locally ⇒ green in this repo's CI job. Run all
# four before pushing:
npm run typecheck    # tsc -b --noEmit
npm run lint         # eslint .
npm run test         # vitest run  (jsdom; pure-logic + hook/component tests)
npm run build        # tsc -b && vite build
```

## Build-time configuration (`VITE_*`)

`VITE_*` vars are baked in at **image build time** (Vite convention), not read at
container start — changing one means **rebuilding the image**, not just
restarting. Set via the compose `build.args` (which read `CLIENT_*` from `.env`);
each also has a matching `ARG` default in the `Dockerfile`.

| Var | Default | Meaning |
|-----|---------|---------|
| `VITE_API_BASE_URL` | `http://localhost:8000` | api-gateway base for all `fetch()` calls. Works over the direct-port bypass. |
| `VITE_OIDC_LOGIN_URL` | *(empty)* | SSO login entry (full-page nav into Authelia's OIDC flow). **No default** — only a real Traefik + DNS + TLS deployment has it. When unset, the SSO button is **hidden** and local login is the only option (over localhost the `*.minder.local` host can't resolve, so a baked URL would dead-end). |
| `VITE_AUTHELIA_PORTAL_URL` | *(empty)* | Authelia self-service portal link on the Settings page. Same opt-in rule; plain text shown when unset. |

> Both `*.minder.local` URLs are empty-by-default on purpose (a recurring
> localhost dead-link class): render the link only when the deployment configures
> it. See `src/lib/api.ts`.

## Layout

```
src/
├── main.tsx                 # entry: BrowserRouter + <App/>
├── App.tsx                  # shell (sidebar/header) + Routes, wrapped in <ErrorBoundary>
├── pages/                   # one component per route (25 pages)
├── components/              # shared UI building blocks (below)
└── lib/                     # framework-agnostic helpers + hooks (below)
```

### `components/` — shared UI

- **`ErrorBoundary.tsx`** — top-level render-crash guard (class component; no hook
  equivalent). Wraps `<Routes>` keyed by pathname, so any page throw shows a
  recoverable "Try again / Reload" fallback instead of blanking the app.
- **`SourceBadge.tsx`** / **`PluginVersion.tsx`** — a plugin's source badge
  (text + icon + accessible name) and its version with the "newer version
  listed" hint, shared by the Discover and Installed plugin cards.
- **`StatusLine.tsx`** — accessible status/error line (aria-live: polite for info,
  assertive for errors). The standard way pages surface load/mutation status.
- **`EmptyState.tsx`** — the "nothing here yet" line for empty lists (one voice).
- **`Sidebar.tsx`** / **`PageTabs.tsx`** / **`CommandPalette.tsx`** — all three
  render from `lib/nav.ts` (see "Navigation and routes" below).
- **`RedirectWithQuery.tsx`** — `<Navigate replace>` that keeps `?query` and
  `#hash`, used for every redirect in `lib/routes.ts`.
- **`ExternalLink.tsx`** — new-tab link for an API-supplied URL
  (`rel="noopener noreferrer"`). Only http(s) URLs become links (`lib/safeUrl.ts`);
  anything else (`javascript:`, `data:`, …) shows as text with a note.
- **`SubmissionReviewCard.tsx`** / **`SubmissionDetails.tsx`** — one submission in
  Publish › Submission review: what will run, who submitted it and when, previous
  feedback, the raw record, and the reviewer actions (approve/archive confirm,
  reject needs feedback).
- **`MindHubConnectionPlaceholder.tsx`** — informational panel on Installation
  settings › MindHub & sources until the real connection (#2201) lands. No
  controls.
- **`PageHeader.tsx`**, **`InfoCallout.tsx`**, **`ConfirmDialog.tsx`** (via
  `useConfirm()`), **`Sidebar.tsx`**, **`UserMenu.tsx`**.

### `lib/` — helpers & hooks

- **`api.ts`** — `apiFetch<T>` / `apiFetchBlob` (bearer injection, JSON/error
  handling, optional `AbortSignal`), `ApiError`, `friendlyErrorMessage`, and the
  `Paginated<T>` list envelope (`{items,total,limit,offset}`, matches the backend
  `shared.models.PaginatedList` — #501).
- **`auth.tsx`** — `AuthProvider` / `useAuth` (JWT in sessionStorage; SSO callback
  + local login; silent token refresh). Pure claim helpers live in **`jwt.ts`**
  (`decodeJwtClaims`, `localExpiryMs`, `refreshDelayMs`) so they're testable
  without rendering the provider.
- **`useAsyncResource.ts`** — declarative data-fetch hook: AbortController
  cancellation + **stale-response race guard** + opt-in `timeoutMs`. Replaces the
  hand-rolled `data/status/isError/loadX/useEffect` boilerplate. Adopt it when a
  page has deps-driven reloads or already re-fetches after mutations; skip it for
  a mount-only load that uses local optimistic add/filter (reload would only add
  round-trips).
- **`usePaginatedList.ts`** — "load a page, then Load More" offset pagination for
  the marketplace catalog.
- **`marketplace.ts`** — typed marketplace / plugin-registry calls and shapes
  (catalog, runtime-loaded plugins, `installations/me`); the start of #2198's
  single typed module. **`installedPlugins.ts`** + **`useInstalledPlugins.ts`**
  merge the runtime list with your installs for Installed › Plugins;
  **`pluginSource.ts`** classifies a plugin's source (First-party / Private git /
  Submitted, MindHub reserved) for `SourceBadge` and Discover's `?source=` filter;
  **`pluginVersion.ts`** compares installed vs listed versions.
  **`submissionReview.ts`** holds the submission review queue's shapes, status
  vocabulary, reviewer transitions (mirroring the backend state machine) and
  confirm-dialog copy.
- **`ui.ts`** — Tailwind class constants (`inputClass`, `primaryButtonClass`,
  `cardClass`, `badgeClass`, …), the `badgeTone` {success,warn,danger} palette,
  `confidenceBadgeColor`, `fieldHintClass`, `mutedTextClass`. Change a style once
  here instead of N pages.
- **`stt.ts`** (`matchingSttLanguage`), **`browser.ts`**, **`links.ts`**
  (`openWebUiUrl`), **`useDebouncedValue.ts`**, **`useElapsedSeconds.ts`**.

## Navigation and routes

`src/lib/nav.ts` is the single source for the sidebar, the in-page tabs
(`PageTabs`) and the ⌘K palette, including role gating (`visibleEntry` /
`leafVisible`: `adminOnly`, `requiresBilling`). `src/lib/routes.ts` holds the
marketplace routes and every redirect. One vocabulary is used for the route,
the tab, the page title (`PageHeader`) and the palette entry; tests hold the
pages' titles to `nav.ts`. `useRouteFocus` moves focus to the new page's `<h1>`
after a client-side navigation.

| Section › entry | Tabs → route | Who sees it |
|---|---|---|
| Marketplace › Discover | Plugins `/marketplace/discover/plugins` (`?source=`, `?q=`) · AI tools `/marketplace/discover/ai-tools` · Service bundles `/marketplace/discover/service-bundles` | everyone |
| Marketplace › Installed | Plugins `/marketplace/installed/plugins` · AI tools `/marketplace/installed/ai-tools` · Service bundles `/marketplace/installed/service-bundles` | everyone (actions need login / admin, as before) |
| Marketplace › Publish | Submissions `/marketplace/publish/submissions` · Submission review `/marketplace/publish/submission-review` | everyone · admin |
| Organization › Billing & licenses | Billing `/billing` · Licenses `/billing/licenses` | billing access (#64) · everyone |
| Installation settings › MindHub & sources | `/settings/sources`, `/settings/sources/:repositoryId` | admin |

Old URLs (`/plugins/*`, `/ai-tools/*`, `/bundles/*`, `/platform/bundles`,
`/marketplace/plugins/*`, …) redirect to these, query string included. Add to
`LEGACY_REDIRECTS` when you move a page; never remove an entry.

## Tests

Vitest (jsdom). Currently **pure logic + hooks + one component** (`api`, `jwt`,
`stt`, `ui`, `browser`, `usePaginatedList`, `useAsyncResource`, `ErrorBoundary`).
The config is intentionally plugin-less (esbuild transforms JSX); component/hook
tests via `@testing-library/react` work, but add an explicit `cleanup()` in
`afterEach` — there's no global setup file, so auto-cleanup isn't registered.
Fake-timer tests must use `vi.advanceTimersByTimeAsync` (not `waitFor`, which
deadlocks under fake timers).

## API contract

`openapi/api-gateway.json` is the API Gateway's OpenAPI spec, synced from the
published copy on the docs site
(`https://raw.githubusercontent.com/minderhq/docs/main/docs/api/openapi/api-gateway.json`).

- **`npm run gen:api`** regenerates `src/lib/api-types.gen.ts` from it with
  `openapi-typescript` (pinned devDependency). Never edit the generated file;
  the hand-written DTOs in `lib/types.ts` etc. can adopt these types over time.
- **`src/lib/apiContract.test.ts`** (part of `npm test`) checks every `/v1/...`
  path the client uses -- and, for `apiFetch`/`apiFetchBlob`/`fetch` calls with
  an inline `method`, the method -- exists in the spec. A call to a route the
  gateway doesn't serve fails CI. Known gaps go in its `KNOWN_MISSING` map, each
  with a reason.
- **CI drift check:** CI downloads the published spec, runs `gen:api`, and fails
  if `openapi/` or the generated types differ from what's committed. When the
  gateway's API changes, sync with:

```bash
curl -fsSL https://raw.githubusercontent.com/minderhq/docs/main/docs/api/openapi/api-gateway.json \
  -o openapi/api-gateway.json
npm run gen:api
npm test
```
