# NanoGemClaw

Personal AI assistant powered by Gemini, delivered via Telegram. TypeScript monorepo with Express backend and React dashboard.

## Quick Commands

```bash
# Backend
npm run dev              # Start with tsx (hot reload)
npm run build            # tsc → dist/
npm run typecheck        # tsc --noEmit
npm test                 # vitest run (12 files, ~330 tests)
npm run test:watch       # vitest (watch mode)
npm run format:check     # prettier --check

# Dashboard (cd dashboard/)
npm run dev              # Vite dev server (port 5173, proxies /api → :3000)
npm run build            # tsc && vite build
npx tsc --noEmit         # Type check frontend separately

# CI runs: typecheck → format:check → test (on PR to main)
```

## Architecture

```
src/                     # Backend (Express + Socket.IO + better-sqlite3)
├── index.ts             # Entry: Telegram bot, state management, IPC
├── server.ts            # REST API + Socket.IO (dashboard backend, port 3000)
├── config.ts            # All env vars & constants
├── types.ts             # Shared types (RegisteredGroup, ScheduledTask, IPC, etc.)
├── db.ts                # Re-exports from db/ modules
├── db/                  # Split DB: connection, messages, tasks, stats, preferences
├── routes/              # Express routers: auth, groups, tasks, knowledge, calendar, skills, config, analytics
├── ipc-handlers/        # IPC message handlers (schedule, cancel, pause, resume, register-group, etc.)
├── utils/               # safe-compare.ts (timingSafeEqual)
└── __tests__/           # Vitest tests

dashboard/               # Frontend (React + Vite + Tailwind + shadcn/ui)
├── src/pages/           # Overview, Tasks, Knowledge, Calendar, Analytics, Settings, Logs, Memory, GroupDetail
├── src/components/      # DashboardLayout, LoginScreen, modals, editors, charts
├── src/hooks/           # useApi (apiFetch, useApiQuery, useApiMutation), useToast
└── src/lib/             # utils (cn())

store/                   # Runtime data (gitignored): messages.db, registered_groups.json
groups/                  # Per-group folders with conversation context
```

## Key Patterns

**Backend dependency injection** — `server.ts` exposes `setGroupsProvider()`, `setGroupRegistrar()`, `setGroupUpdater()` called from `index.ts`. Server never imports index directly.

**Dynamic imports** — Backend uses `await import('./db.js')` pattern (ESM, `.js` extensions in imports).

**Dual RegisteredGroup types** — `src/types.ts` has `RegisteredGroup` WITHOUT `id` (storage layer). `src/server.ts` has a LOCAL `RegisteredGroup` interface WITH `id` (API layer). Don't confuse them.

**API response format** — All endpoints return `{ data: ... }` or `{ error: ... }`. Never expose `err.message` to consumers.

**Auth** — Header-only: `x-access-code` (dashboard) and `x-api-key` (API). No query string auth. Socket.IO also uses auth headers.

**Route param validation** — `SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/` for folder params to prevent path traversal.

**FTS5 queries** — Wrap search terms in double quotes: `"${query.replace(/"/g, '""')}"` to prevent injection.

## Conventions

- **Indent**: 4-space in `server.ts` and all dashboard files; 2-space in `index.ts`, `db.ts`, `config.ts`
- **Frontend theme**: Dark (slate-900/950), lucide-react icons, `cn()` for classnames, tailwind-merge
- **Formatting**: Prettier enforced (CI checks). Run `npm run format` before committing
- **Module system**: ESM (`"type": "module"`), target ES2022, `NodeNext` resolution
- **Node**: >=20 required

## Testing

- **Framework**: Vitest 4 with globals enabled, node environment
- **Pattern**: `vi.hoisted()` + `require()` for values in `vi.mock()` factories
- **DB tests**: Single init/close per file, `beforeEach` resets tables
- **Fake timers**: Use `advanceTimersByTimeAsync`, no `done()` callbacks
- **Coverage**: v8 provider, thresholds: 80% lines, 80% functions, 70% branches
- **Supertest**: Used for HTTP route testing (`server-routes.test.ts`)

## Environment Variables

Required: `TELEGRAM_BOT_TOKEN`
Required for image gen: `GEMINI_API_KEY`
Dashboard: `DASHBOARD_API_KEY`, `DASHBOARD_HOST` (default 127.0.0.1), `DASHBOARD_ORIGINS`
Optional: `GEMINI_MODEL` (default gemini-3-flash-preview), `CONTAINER_TIMEOUT`, `WEBHOOK_URL`, `STT_PROVIDER`, `TZ`

## Security Notes

- `safeCompare()` in `src/utils/safe-compare.ts` uses `crypto.timingSafeEqual` — use for all secret comparisons
- Never commit `.env`, `*.keys.json`, or `store/` contents
- Container mount security: allowlist at `~/.config/nanogemclaw/mount-allowlist.json` (outside project, never mounted)
- Error responses use generic messages — never leak internal details
