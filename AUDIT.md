# Nova StartupOS AI — Full Project Audit

> Audit of the repository as it exists. No code, UI, or architecture was modified.

---

## PHASE 1 — PROJECT DISCOVERY

### Folder Structure (factual, root-level)

```
StartUp Project/
├── api/                       2 Vercel serverless functions
│   ├── ai-stream.js           AI streaming proxy (auth + provider routing)
│   └── stripe-checkout.js     Stripe Checkout session creator
├── css/                       Bootstrap + plugins + custom (nova.css, style.css)
├── img/                       Static assets (avatars, blog, chefs, menu, etc.)
├── js/                        8 hand-written modules + 5 vendor libs
│   ├── admin.js               Admin & Super Admin UI engine (748 lines)
│   ├── ai.js                  AI streaming client (Edge-Function caller)
│   ├── api.js                 Network hub (Supabase + legacy REST stubs)
│   ├── export.js              PDF/DOCX/PPTX export engine
│   ├── main.js                App coordinator (1,535 lines, all features)
│   ├── store.js               localStorage state layer
│   ├── wizard.js              Onboarding & startup wizard
│   └── (vendor) jquery, bootstrap, chart.umd, magnific-popup, aos
├── webfonts/                  Font Awesome assets
├── .env.example               Env template (Supabase + AI keys + Stripe)
├── .gitignore
├── index.html                 Single-page app shell (124 KB, ~1,540 lines)
├── package.json               commonjs, only 2 deps: stripe, @supabase/supabase-js
├── README.md                  Arabic deployment guide
├── supabase_schema.sql        Full Postgres schema with RLS
├── TECHNICAL_SPECIFICATION.md Arabic technical spec
└── vercel.json                Rewrites + security headers
```

### Detection Matrix

| Technology | Status | Evidence |
|---|---|---|
| Next.js / React / Vue / Angular | **Not used** | No build config, no JSX, pure DOM manipulation |
| Vite / Webpack / Bundler | **Not used** | `package.json` has no build script; site is pure static |
| Vanilla JavaScript SPA | **Confirmed** | All UI in `index.html` + `js/*.js` |
| Bootstrap 5.3 | **Confirmed** | `css/bootstrap.min.css`, `js/bootstrap.bundle.min.js` |
| jQuery 3.7.1 + Magnific Popup | **Confirmed** | Used only for video lightbox |
| Chart.js | **Confirmed** | `chart.umd.min.js`, line/radar/doughnut charts |
| Node.js (≥18) | **Confirmed** | `engines.node` in `package.json` |
| Vercel Serverless Functions | **Confirmed** | `api/*.js`, `vercel.json` rewrites |
| Supabase (Auth + DB + Storage) | **Confirmed in client; NOT configured** | `js/api.js` uses placeholders `your-project-id` / `your-anon-public-key` |
| PostgreSQL | **Confirmed (via Supabase)** | `supabase_schema.sql` defines all tables |
| Prisma / ORM | **Not used** | Direct Supabase JS SDK calls only |
| Firebase | **Not used** | — |
| Stripe | **Partial (server only)** | `api/stripe-checkout.js` exists; no client wiring or webhook |
| PayPal | **UI only** | Form fields exist in admin; no API route, no SDK |
| OpenRouter / OpenAI / DeepSeek | **Server-side mapped** | `api/ai-stream.js` PROVIDERS map |
| Anthropic / Gemini | **Mapped via OpenRouter only** | Same file routes both through OpenRouter, no direct SDK |
| Package manager | **None required** | No `node_modules` shipped; deps only used in serverless functions at runtime |
| Build tool | **None** | Pure static + serverless |

---

## PHASE 2 — FRONTEND ANALYSIS

### Landing page (public sections)

| Section | Component | Feature | Data Source | Status |
|---|---|---|---|---|
| Hero | `#hero` | Marketing hero + CTA | Hardcoded HTML | UI-only |
| Social Proof | `#proof` | Logos / press strip | Hardcoded HTML | UI-only |
| Problem / Features / How It Works / Benefits | `#problem` `#features` `#how` `#benefits` | Marketing content | Hardcoded HTML | UI-only |
| Pricing | `#pricing` | Monthly/yearly toggle | Hardcoded values + `#ptog` listener | UI-only |
| Testimonials / FAQ / CTA / Footer | — | Marketing | Hardcoded HTML | UI-only |
| Auth offcanvas (`#lofc`) | login/signup tabs + Google/GitHub buttons | Real Supabase Auth | `NovaApi.login` / `register` / `quickLogin` | **Functional** when Supabase keys are set; falls back to fake "demo login" otherwise |

### Dashboard sections (authenticated SPA)

| Page (sec-id) | Component | Feature | Data Source | Status |
|---|---|---|---|---|
| `sec-overview` | Dashboard home | Greeting, KPIs, score chart, live activity ticker | Static demo numbers; `liveActivity` cycles a hardcoded array | **UI / mock** |
| `sec-startups` | My Startups | Cards list, create wizard, edit, delete | `NovaStore` local + `NovaApi.getStartups/createStartup/updateStartup/deleteStartup` (Supabase `startups` table) | **Functional** (Supabase backed) |
| `sec-analytics` | Analytics | Bar + doughnut + funnel charts | Computed from local `NovaStore` startups only | **UI / local** (not a real analytics pipeline) |
| `sec-plans` | Business Plans | Form + AI-generated plan + export | Calls `NovaApi.generateBusinessPlan(id)` → endpoint **does not exist** → falls back to `renderLocalPlan()` hardcoded template | **Partially functional**: only template-based output works; "AI generation" is a static template |
| `sec-decks` | Pitch Decks | 10-slide grid | `DECK_SLIDES` hardcoded constant; `NovaApi.generatePitchDeck` calls non-existent endpoint | **UI / mock** |
| `sec-readiness` | Readiness Assessment | 4 score cards + radar chart + recommendations | `NovaApi.runAssessment` non-existent → `setTimeout` randomizes scores | **Mock** (random numbers) |
| `sec-funding` | Funding Assistant | 9 hardcoded opportunities, save buttons | `FUNDING` const array; admin can also write to `funding_sources` (Supabase) — but UI does NOT load from there in default flow because `NOVA_BACKEND` only flips true after backend startup sync | **Mostly mock** with Supabase scaffold |
| `sec-visa` | Visa Assistant | 4 country cards + 6 program cards | `VISA_COUNTRIES` and `VISA_PROGRAMS` hardcoded | **UI-only / mock** |
| `sec-copilot` | AI Copilot | Chat UI, conversation list, streaming bubble | Backend mode → `NovaAI.generateStream` to **`/functions/v1/nova-ai-stream`** (does NOT exist); local mode → `demoChat` keyword-matched canned replies | **UI / partially functional** (see AI audit) |
| `sec-documents` | Documents Center | Cards list, view/download/delete | `NovaApi.getDocuments` against `generated_documents` table | **Functional** (Supabase backed) |
| `sec-billing` | Billing & Upgrades | Plan grid, history table, cancel | Hardcoded `BILLING_PLANS` and `BILLING_HISTORY`; `selectPlan()` only toasts "coming soon" | **UI-only / mock** |
| `sec-settings` | Settings | Profile, AI key, theme, notifications | `NovaStore` + leftover legacy `PUT /auth/profile` fetch (no endpoint exists) | **Partially functional** (local persistence only) |
| Modals | `onboardModal`, `wizardModal`, `adminCrudModal`, `ticketModal` | Onboarding, startup creation, admin CRUD, support reply | Wired to Supabase via `api.js` | **Functional** when Supabase configured |

**Legend for "Status":**
- **Functional** → reaches Supabase or a working serverless function and persists.
- **Partially functional** → some paths persist, others fall back to hardcoded data.
- **UI-only / mock** → renders but does nothing real, or relies on hardcoded arrays.

---

## PHASE 3 — BACKEND ANALYSIS

### Backend exists?

**Yes, but minimal.** Only **two** Vercel serverless functions are implemented. The Supabase JS SDK is used directly from the browser for all CRUD, with RLS enforcing security.

There is **no traditional REST API**, no Express/Nest/Laravel server, no controllers/services layer. `api.js` contains a `request()` helper pointing at `http://localhost:8000/api` (default `NOVA_API_BASE`) and a long list of method stubs that target endpoints that do not exist anywhere in this repo.

### API Inventory (everything the frontend tries to call)

| Endpoint | Method | Purpose | Used By (frontend) | Exists? | Notes |
|---|---|---|---|---|---|
| `/api/ai-stream` (Vercel) | POST | Auth-verified AI streaming proxy with provider routing | Not directly (see note) | ✅ Implemented | `api/ai-stream.js`, 175 lines |
| `/api/stripe-checkout` (Vercel) | POST | Create Stripe Checkout session | **Nobody** (no UI button calls it) | ✅ Implemented | `api/stripe-checkout.js`, 65 lines |
| `${SUPABASE_URL}/functions/v1/nova-ai-stream` | POST | AI streaming via Supabase Edge Function | `js/ai.js` `generateStream` (the actual chat send path) | ❌ **Missing** | No `supabase/functions/` folder in repo |
| Supabase tables (direct SDK) | — | profiles, startups, generated_documents, support_tickets, blog_posts, funding_sources, visa_programs, payment_gateways, ai_providers_config, blocked_ips | `NovaApi.*` admin & user calls | ✅ Schema exists | All RLS policies defined |
| Supabase Storage `startup-logos` bucket | — | Logo uploads | `_uploadLogo` in api.js | ⚠️ Must be **manually created** (README admits this) |
| `/auth/change-password` `/auth/profile` `/auth/2fa*` | various | Profile/2FA management | `NovaApi.changePassword`, `updateProfile`, `twoFactorStatus`, etc. | ❌ Missing | Stub methods to `localhost:8000/api` |
| `/billing` `/billing/checkout` `/billing/cancel` | GET/POST | Billing API | Settings/Billing UI | ❌ Missing | UI never actually calls them |
| `/workspaces` (CRUD) | GET/POST/PUT/DELETE | Workspaces | Wired but unused server-side | ❌ Missing | Local only |
| `/startups/{id}/business-plans/generate` | POST | AI business plan | `NovaApi.generateBusinessPlan` | ❌ Missing | Falls back to local template |
| `/startups/{id}/business-plans` | GET | List plans | Defined, never called | ❌ Missing | — |
| `/startups/{id}/pitch-decks/generate` | POST | AI pitch deck | `NovaApi.generatePitchDeck` | ❌ Missing | Falls back to hardcoded slides |
| `/startups/{id}/assessments/run` | POST | Readiness assessment | `runAssessment()` | ❌ Missing | Falls back to random numbers |
| `/funding`, `/funding/save`, `/visa` (legacy) | GET/POST | Funding/visa lists | Some mapped to Supabase admin tables, others stub | ⚠️ Partial | Frontend admin calls go to Supabase; user-facing path uses hardcoded array |
| `/notifications`, `/notifications/read-all` | GET/POST | Notifications | UI mark-all-read button only updates DOM | ❌ Missing | Pure DOM toggle |
| `/copilot/conversations`, `/copilot/send`, `/copilot/stream` | various | Chat history | Stubbed; current chat uses local store + Edge Function | ❌ Missing | — |
| `/admin/dashboard` | GET | Admin overview | Used as fallback when `adminGetStats` fails | ❌ Missing | Falls back gracefully |
| `/admin/ai-settings` `/admin/email-settings` (+ test) | GET/POST | Settings | Admin/Super Admin panels | ❌ Missing | UI relies on Supabase tables for AI config; email settings has no fallback |
| `/admin/plans`, `/admin/cms/{section}`, `/admin/audit-logs` | various | CMS / plans / audit | Subscriptions table view; CMS editor | ❌ Missing | Audit logs has graceful fallback to single placeholder row |

**Summary:** of **~40+ method stubs in `api.js`**, only what runs through `supabase.from(...)` and the 2 Vercel functions has any real backend. Everything else is dead code or a fallback path.

---

## PHASE 4 — FRONTEND ↔ BACKEND CONNECTION AUDIT

| Feature | Frontend Exists | Backend Exists | Connected | Working | Notes |
|---|---|---|---|---|---|
| Login (email/password) | ✅ | ✅ Supabase Auth | ✅ | ✅ | Falls back to fake demo login if Supabase keys are placeholders |
| Register | ✅ | ✅ Supabase Auth + `handle_new_user` trigger | ✅ | ✅ | Auto-creates `profiles` row |
| OAuth (Google, GitHub) | ✅ | ✅ Supabase | ✅ | ⚠️ Requires manual Redirect URL config in Supabase dashboard |
| Session restore on reload | ✅ | ✅ | ✅ | ✅ | `NovaApi.me()` + `onAuthStateChange` |
| Logout | ✅ | ✅ | ✅ | ✅ | — |
| Subscriptions (user side) | ✅ Plan grid | ❌ No checkout call | ❌ | ❌ | "Select Plan" only toasts "coming soon" |
| Payments (Stripe Checkout) | ❌ No UI hook | ✅ `/api/stripe-checkout` exists | ❌ | ❌ | Server function is orphaned — no button posts to it |
| Stripe Webhooks | ❌ | ❌ | ❌ | ❌ | No `/api/stripe-webhook` route; admin UI captures the URL but it goes nowhere |
| Business Plans | ✅ | ❌ No AI generation endpoint | ⚠️ | ⚠️ | Renders hardcoded mad-libs template; persists result to `generated_documents` |
| Pitch Decks | ✅ | ❌ | ❌ | ⚠️ | Renders 10 hardcoded slides; persists JSON to `generated_documents` |
| Readiness Assessment | ✅ | ❌ | ❌ | ❌ | `Math.random()` for scores |
| AI Chat (Copilot) | ✅ | ⚠️ Half-implemented | ⚠️ | ⚠️ | `js/ai.js` calls `supabase/functions/v1/nova-ai-stream` which **is not in the repo**. The Vercel `/api/ai-stream.js` exists and would work, but **nothing calls it**. Falls back to keyword-matched demo replies in `demoChat()` |
| Funding (user) | ✅ | ⚠️ | ⚠️ | ⚠️ | Hardcoded array; backend tables exist but user view defaults to local list unless `NOVA_BACKEND=true` |
| Funding (admin CRUD) | ✅ | ✅ Supabase `funding_sources` | ✅ | ✅ | Insert/list/delete work |
| Visa (user) | ✅ | ❌ | ❌ | ❌ | Pure hardcoded array |
| Visa (admin CRUD) | ✅ | ✅ Supabase `visa_programs` | ✅ | ✅ | But `loadVisa` reads `v.fit_score` while schema column is `suitability_score` — **schema/UI mismatch** |
| Admin: Users | ✅ | ✅ `profiles` | ✅ | ✅ | List, edit, suspend, delete work via RLS |
| Admin: Subscriptions | ✅ Table | ❌ `/admin/plans` doesn't exist | ❌ | ❌ | Always errors; no fallback paint |
| Admin: Blog | ✅ | ✅ `blog_posts` | ✅ | ⚠️ | Schema columns: `snippet`, `body`, `scheduled_at`. UI sends `excerpt`, `body`, `publish_at` → **column-name mismatch** on insert |
| Admin: CMS | ✅ | ❌ `/cms` endpoint missing | ❌ | ❌ | Throws on load |
| Admin: Support Tickets | ✅ | ✅ `support_tickets` (+ JSONB messages) | ✅ | ✅ | Full reply + close flow works |
| Admin: Audit Logs | ✅ | ❌ no `audit_logs` table | ❌ | ⚠️ | Graceful fallback to one fake row |
| Super Admin: AI Providers | ✅ | ✅ `ai_providers_config` | ✅ | ⚠️ | UI sends `api_key` field but **schema has no `api_key` column** — write will fail; only enabled/priority/cost/default fields persist correctly. Real API keys live in Vercel env, not the DB |
| Super Admin: Payment Gateways | ✅ form | ✅ `payment_gateways` table | ⚠️ | ⚠️ | `superAdminSaveGateway` upserts payload into JSONB-less columns (`publishable_key`, `secret_key`, etc.) but schema only has `provider` + `config` (jsonb) → **payload shape mismatch** |
| Super Admin: Email | ✅ form | ❌ no endpoint | ❌ | ❌ | First call to `/admin/email-settings` errors |
| Super Admin: Security (blocked IPs) | ✅ | ✅ `blocked_ips` | ✅ | ✅ | Add/list/remove all work |
| Super Admin: Rate Limiting | ✅ form | ❌ | ❌ | ❌ | Save button only toasts |
| Super Admin: System Health | ✅ KPIs + monitor sparklines | ⚠️ Stats from `profiles`/`startups` counts | ⚠️ | ⚠️ | Sparklines are `Math.random()`; status badges are hardcoded "Operational" |

---

## PHASE 5 — AUTHENTICATION & ROLES

- **System:** Supabase Auth (email/password + OAuth Google/GitHub).
- **Session storage:** Supabase SDK's localStorage; access token also mirrored at `nova.token` for legacy fetch calls.
- **JWT:** validated server-side in `api/ai-stream.js` via `admin.auth.getUser(token)` using the service-role key.
- **No NextAuth, no Firebase, no custom JWT signing.** No password reset flow wired in the UI (no `forgotPassword` button).

### Roles

Defined in `profiles.role`, enum-checked: `'User' | 'Admin' | 'Super Admin'`.

| Role | What they see (per `applyRole` in admin.js + RLS) |
|---|---|
| **User** | Founder OS sidebar (Dashboard, My Startups, Analytics, Documents, Business Plans, Pitch Decks, Readiness, Funding, Visa, Copilot, Billing, Settings). Read/write only their own startups, documents, tickets |
| **Admin** | All of User + "Administration" group: Admin Dashboard, Users, Subscriptions, Funding DB, Visa DB, Blog, CMS, Support Tickets, Audit Logs. Read all profiles/startups/docs/tickets; write blog/funding/visa |
| **Super Admin** | All of Admin + "Super Admin" group: AI Providers, Gateways, Email Settings, Security, System Health. Sole writer to `payment_gateways` and `ai_providers_config` |

**Promotion is manual** — README states: `update public.profiles set role = 'Super Admin' where email = 'you@example.com';`

No granular permissions / no per-feature ACL — role implies the whole bundle.

---

## PHASE 6 — DATABASE AUDIT

### Tables defined in `supabase_schema.sql`

| Table | Key Columns | Relations | Indexes | RLS |
|---|---|---|---|---|
| `profiles` | id (PK→auth.users), name, email, role, plan_tier, is_active, created_at | FK → auth.users(id) ON DELETE CASCADE | PK only | Owner select/update; admins select/update/delete all |
| `startups` | id, user_id (FK), name, industry, country, current_stage, logo_url, startup_score, scores (jsonb), target_market, problem, solution, created_at | FK → profiles(id) | `idx_startups_user_id` | Owner full; admins select |
| `generated_documents` | id, startup_id, user_id, doc_type ('plan'/'deck'/'chat'), title, content, created_at | FK → startups, profiles | `idx_docs_user_id`, `idx_docs_startup_id` | Owner full; admins select |
| `support_tickets` | id, user_id, title, status ('open'/'closed'), messages (jsonb), created_at | FK → profiles | `idx_tickets_user_id` | Owner full; admins select/update |
| `blog_posts` | id, title, snippet, body, status ('draft'/'published'/'scheduled'), scheduled_at, created_at | None | None | Public reads published; admins full |
| `funding_sources` | id, name, type, country, ticket_size, created_at | None | None | Authed read; admins full |
| `visa_programs` | id, country, program_name, suitability_score, created_at | None | None | Authed read; admins full |
| `payment_gateways` | provider (PK 'stripe'/'paypal'), config (jsonb), updated_at | None | PK | Super Admin only |
| `ai_providers_config` | provider_name (PK), enabled, priority, input/output_cost_per_1k, is_default, default_model, updated_at | None | PK | Authed read; Super Admin write |
| `blocked_ips` | id, ip_address, reason, created_by (FK), created_at | FK → profiles | None | Admin full |

### Triggers / Functions

- `is_admin()`, `is_super_admin()` — `SECURITY DEFINER` SQL functions (avoid recursive RLS on `profiles`).
- `set_updated_at()` — generic `BEFORE UPDATE` trigger on `payment_gateways` and `ai_providers_config`.
- `handle_new_user()` — `AFTER INSERT ON auth.users` → auto-creates `profiles` row.

### Seeds

- `ai_providers_config` is pre-seeded with 5 providers (openrouter default, openai/anthropic/gemini/deepseek disabled).

### Missing or Inconsistent

| Issue | Severity |
|---|---|
| **No `audit_logs` table** — frontend calls `adminGetAuditLogs` and falls back to placeholder | Medium |
| **No `subscriptions`/`payments`/`invoices` tables** — billing UI shows hardcoded history; `adminGetStats` derives "revenue" as `paid_users × $39` | High (financials are theatre) |
| **No `notifications` table** — UI bell exists; mark-all-read is DOM-only | Low |
| **No `assessments` table** — readiness scores never persist | Medium |
| **No `business_plans` / `pitch_decks` tables** — only `generated_documents` (free-text content) is used | Low (intentional simplification) |
| **`payment_gateways.config` is jsonb** but `superAdminSaveGateway` upserts flat columns (`publishable_key`, etc.) → insert will fail | High |
| **`ai_providers_config` has no `api_key` column** but Save AI panel sends `api_key: ...` → write will silently drop or error | High |
| **`blog_posts`** schema uses `snippet`/`scheduled_at`; UI sends `excerpt`/`publish_at` | High |
| **`visa_programs`** column is `suitability_score` (text); UI reads/writes `fit_score` | Medium |
| **No bucket creation in SQL** — README: `startup-logos` bucket must be created manually | Medium |
| **No migrations system** — single `supabase_schema.sql` is the only source; no Prisma/SQL migrations folder | Medium |

---

## PHASE 7 — AI SYSTEM AUDIT

### Provider Matrix

| Provider | Server Mapped | Direct SDK Used | Endpoint | Status |
|---|---|---|---|---|
| **OpenRouter** | ✅ in `api/ai-stream.js` PROVIDERS map | None (uses fetch) | `https://openrouter.ai/api/v1/chat/completions` | **Working** if `OPENROUTER_API_KEY` set in Vercel env |
| **OpenAI** | ✅ | None | `https://api.openai.com/v1/chat/completions` | **Working** if `OPENAI_API_KEY` set |
| **DeepSeek** | ✅ | None | `https://api.deepseek.com/v1/chat/completions` | **Working** if `DEEPSEEK_API_KEY` set |
| **Gemini** | ⚠️ Mapped, but routed through OpenRouter (same URL/key) | — | OpenRouter | **Placeholder** — not a real Google Gemini integration |
| **Anthropic / Claude** | ⚠️ Same as Gemini — routed through OpenRouter | — | OpenRouter | **Placeholder** |

### Implementation Status

- `api/ai-stream.js`: **fully implemented**. Verifies Supabase JWT → reads `ai_providers_config` (enabled, priority, default) → forwards to upstream with master system prompt → re-emits OpenAI-compatible SSE frames.
- `js/ai.js` `generateStream`: **broken target**. Calls `${SUPABASE_URL}/functions/v1/nova-ai-stream`, but **no Supabase Edge Function exists in this repo**. There is no `supabase/functions/` directory.
- Result: in production, the chat path is **disconnected**. The Vercel `/api/ai-stream` is built and working, but `js/ai.js` does not call it. The `chat()` function in `ai.js` does an entirely separate path that calls OpenRouter directly from the browser using a key in localStorage — this works but is **insecure** (browser-exposed API key, contradicting the file's own comment about needing a backend proxy).

### Hidden System Prompt

A "master system prompt" lives in `api/ai-stream.js`. The same prompt is duplicated client-side in `js/ai.js` (`SYSTEM_PROMPT`) and `buildSystemPrompt()` injects active startup context + memory.

---

## PHASE 8 — PAYMENT SYSTEM AUDIT

### Stripe

| Feature | Status |
|---|---|
| Checkout session generator (`/api/stripe-checkout`) | ✅ Implemented and correct (subscription mode, `client_reference_id`, success/cancel URLs) |
| Frontend trigger | ❌ **No code path calls it.** `selectPlan()` only updates DOM and shows a toast |
| Webhook handler | ❌ No `/api/stripe-webhook` route exists |
| Subscription state in DB | ❌ No `subscriptions` table; `profiles.plan_tier` is the only signal and is set by `handle_new_user` to 'Free' and never updated by anything |
| Billing portal | ❌ Not implemented |
| Plan restrictions / paywalls | ❌ No gating anywhere — Pro features are accessible to Free users |

### PayPal

| Feature | Status |
|---|---|
| Admin form for credentials | ✅ UI present |
| Backend integration | ❌ Nothing |
| Checkout / capture / webhook | ❌ Nothing |

**Verdict:** Payments are **roughly 10% implemented** — only the Stripe Checkout session creator endpoint exists, but it is unreachable from the UI and has no completion loop (no webhook, no DB write, no plan upgrade).

---

## PHASE 9 — ADMIN & SUPER ADMIN AUDIT

### Admin sections

| Page | Backend Support | DB Dependency | Real Functionality |
|---|---|---|---|
| Admin Dashboard | Partial — `adminGetStats` aggregates counts from `profiles`/`startups`/`support_tickets` | ✅ tables exist | KPI tiles work; revenue is computed (active_subs × $39); recent signups list works; **revenue chart uses a hardcoded array** |
| Users | ✅ Supabase | `profiles` | List, search by name, edit, suspend, delete — all work |
| Subscriptions | ❌ Calls missing `/admin/plans` | None | Errors silently |
| Funding DB | ✅ | `funding_sources` | Add/list/delete work |
| Visa DB | ⚠️ Column-name mismatch (`fit_score` vs `suitability_score`) | `visa_programs` | List works (column missing → shows '—'); insert may fail |
| Blog | ⚠️ Column-name mismatch (`excerpt`/`publish_at` vs `snippet`/`scheduled_at`) | `blog_posts` | List works for existing rows; insert/edit will write to non-existent columns |
| CMS | ❌ `/cms` endpoint missing | None | Always errors |
| Support Tickets | ✅ | `support_tickets` (with messages JSONB) | List, filter, reply, close — all work |
| Audit Logs | ❌ No table | None | Shows 1-row placeholder |

### Super Admin sections

| Page | Backend Support | DB Dependency | Real Functionality |
|---|---|---|---|
| AI Providers | ⚠️ | `ai_providers_config` | Read works; toggle/priority/cost write works; **`api_key` field is sent but no column exists** — partial save |
| Payment Gateways | ⚠️ | `payment_gateways(provider, config jsonb)` | Form posts flat columns instead of `config` jsonb → upsert payload mismatch → fails |
| Email Settings | ❌ | None | Errors on first call |
| Security: Blocked IPs | ✅ | `blocked_ips` | Add/list/unblock work |
| Security: Rate Limiting | ❌ | None | Save button only toasts |
| System Health | ⚠️ | `profiles`, `startups` | KPI counts work; **monitor sparklines are `Math.random()`** |

---

## PHASE 10 — VERCEL COMPATIBILITY AUDIT

### What is configured

- `vercel.json`: `cleanUrls`, security headers, CORS for `/api/*`, two rewrites for serverless functions.
- `package.json`: `engines.node >=18`, dependencies `stripe@^16.8.0` and `@supabase/supabase-js@^2.45.0`.
- No build command, no output directory — Vercel deploys static files plus Node serverless functions automatically.

### Compatibility Check

| Check | Result |
|---|---|
| Build success | ✅ No build step required; static + 2 serverless funcs |
| Environment variables documented | ✅ `.env.example` lists all 7 needed vars |
| Node version | ✅ `>=18.x`, matches Vercel runtime defaults |
| Serverless function size | ✅ Both files small (<10KB), within 50MB Vercel limit |
| Cold-start friendly | ✅ Minimal deps |
| Edge runtime use | ❌ Not used — both functions are standard Node serverless. SSE streaming is well-supported in Node functions |
| Filesystem writes | ✅ None |
| Background jobs / cron | ❌ Not used (and not needed in current scope, but no scheduled-scoring or scheduled-blog-publish would work) |
| Long-running processes | ⚠️ AI streaming with SSE — Vercel default function timeout is **10s on Hobby**, **60s Pro**, **900s Enterprise**. Long AI completions may exceed Hobby tier limits |
| Unsupported packages | ✅ None |
| OAuth redirect | ⚠️ Requires manual Supabase dashboard config (README documents it) |
| Supabase keys exposure | ⚠️ Anon key embedded in client — that is the supported Supabase pattern, but the current code has placeholders, so **the live deploy will not work until the key is filled in** |

### VERCEL READY SCORE: **78 / 100**

**Blocking issues:** None for deploying. The site will deploy and load. But:

**Warnings:**
1. Supabase placeholders in `js/api.js` will produce a warning in the console and break all auth/DB calls until edited.
2. AI chat path points at a non-existent Supabase Edge Function — chat will return `404`.
3. Hobby plan SSE timeout could truncate long AI responses.
4. Storage bucket `startup-logos` must be created manually in Supabase before logo uploads work.

**Recommendations:**
- Either deploy a Supabase Edge Function named `nova-ai-stream` or repoint `js/ai.js` to `/api/ai-stream`.
- Wire the Stripe Checkout path: hook `selectPlan()` to `POST /api/stripe-checkout` and add a webhook handler.
- Reconcile the schema/UI column-name mismatches before users hit them.

---

## PHASE 11 — SECURITY AUDIT

| Finding | Severity |
|---|---|
| **Browser-side OpenRouter API key path in `ai.js` `chat()`** — reads `apiKey` from localStorage and posts it directly to OpenRouter. The file's own comment says this is for MVP only, but the code still ships. Anyone reading `localStorage.nova.state.v1` can steal the key | **High** |
| **Service-role key only on server** — correctly used in `api/ai-stream.js`, not exposed | OK |
| **JWT verification in serverless function** — correctly done via `admin.auth.getUser(token)` | OK |
| **RLS enabled on every table** with appropriate policies | OK |
| **`is_admin()` / `is_super_admin()` use `SECURITY DEFINER`** to avoid recursion | OK |
| **CORS `Access-Control-Allow-Origin: *`** on `/api/*` (set in both `vercel.json` and the functions) — fine for public AI endpoint, but `/api/stripe-checkout` should restrict origin to your own domain to prevent abuse from third-party sites | **Medium** |
| **No CSRF token** on the legacy fetch endpoints — moot because those endpoints don't exist, but if reactivated, would be a problem | Medium (latent) |
| **No rate limiting** anywhere in the codebase. Super Admin "Rate Limits" panel is purely cosmetic. AI endpoint is callable at full upstream cost by any authenticated user | **High** |
| **No input sanitization on chat prompt** — passed verbatim to upstream provider (acceptable; provider-side filters apply) | Low |
| **XSS risk in admin user editor**: `JSON.stringify({id, name, email})` is interpolated **inside an HTML attribute via single-quote `onclick=`**. A name containing `'` will break the handler; one containing `</script>` is escaped because `esc()` runs on the table cells, but the inline JSON in the onclick is **not** escaped. Crafted user names could break out | **High** |
| **`innerHTML` everywhere** — all admin tables, document cards, etc. build HTML from DB content via interpolation. `esc()` is called inconsistently. Several places use raw `${b.title}`, `${u.name}` without escaping inside event-handler attributes | **High** |
| **No SQL injection risk** in app code — all DB calls go through Supabase JS SDK with parameterized queries. RLS provides server-side enforcement | OK |
| **Hardcoded fallback text "your-anon-public-key"** — committed placeholder, no real key in repo | OK |
| **`.env` excluded** from git, `.env.example` contains only placeholders | OK |
| **Stripe webhook signature verification** — N/A, no webhook implemented (so any payment confirmation logic doesn't exist either) | High (functional gap, security-adjacent) |
| **Admin panel exposes audit-logs button** but no audit pipeline records anything — a real ops gap if compliance matters | Medium |
| **`.vscode/`** is in `.gitignore` ✅; `.git/` present locally only |   |
| **No secret scanning / pre-commit hook** | Low |

---

## PHASE 12 — FINAL REPORT

### Executive Summary

Nova StartupOS AI is a **polished static SPA** with **two thin serverless functions** and a **comprehensive Supabase schema**. The frontend is approximately 4,500 lines of well-commented vanilla JS that simulates an enterprise SaaS product. About **30% of the surface area is genuinely backend-connected** (auth, startups CRUD, documents storage, support tickets, admin tables, blocked IPs, ai_providers_config); the remaining **70% is either mocked, hardcoded, or wired to endpoints that don't exist** (AI generation, payments, assessments, billing history, analytics, notifications, CMS, audit logs, system monitors, plan gating).

The product is **demo-ready** — it presents convincingly when you sign in. It is **not** production-ready: payments don't actually charge, AI chat can't reach a working backend out of the box (the Edge Function it targets doesn't exist in the repo), and several admin write paths don't match the database schema.

### Architecture Overview

- **Frontend:** Vanilla JS SPA, Bootstrap 5.3, Chart.js, no build step.
- **Auth + DB + Storage:** Supabase (used directly from browser SDK with RLS).
- **Serverless functions:** Two on Vercel — AI streaming proxy and Stripe Checkout creator.
- **AI:** OpenRouter (default), OpenAI, DeepSeek; Anthropic/Gemini routed through OpenRouter.
- **No build pipeline, no CI, no test suite, no migrations system.**

### Existing (working) Features

Auth (email/pwd + OAuth), startup CRUD with logo upload, generated-documents persistence, support-ticket reply flow, admin user management, admin funding/visa CRUD (partial — column issues), super-admin AI provider toggling, super-admin blocked-IPs management, theme toggle, export to DOCX/PPTX/PDF, conversation history (local), workspace switcher (local).

### Missing (claimed but not real) Features

Real AI business plan generation, real AI pitch deck generation, real readiness scoring, Stripe checkout flow end-to-end, Stripe webhooks, plan gating/paywalls, billing history persistence, notifications system, audit logs, CMS endpoint, analytics pipeline, system health monitors, rate limiting, 2FA, password change, email settings backend, PayPal integration entirely.

### Final Score Categories

| Category | Score | Justification |
|---|---:|---|
| **UI Completeness** | **88/100** | Every dashboard surface is built and styled. Multi-role nav, modals, forms, charts. Minor gaps: no "forgot password" UI; some admin tables have no empty-state styling |
| **Backend Completeness** | **24/100** | Only auth + a handful of CRUD tables + 1 unreachable AI endpoint + 1 unused Stripe endpoint. Most claimed APIs are stubs |
| **Integration Completeness** | **35/100** | Auth↔Supabase strong; documents/tickets/users/funding/visa partially wired; AI/payments/billing/assessments not connected |
| **Security** | **52/100** | RLS is solid and correct. Server-side JWT verification is correct. Anon-key model used properly. Lost points: browser-stored AI key in legacy path, several `innerHTML` injection vectors in admin tables, no rate limiting, no Stripe webhook signature verification (because there's no webhook), open CORS on Stripe endpoint |
| **Deployment Readiness** | **78/100** | Will deploy on Vercel as-is. Static + 2 functions, sane headers, env vars documented. Loses points for placeholder Supabase keys committed in `api.js`, missing Edge Function, and manual bucket setup |
| **Production Readiness** | **38/100** | Demo-ready, not production-ready. Payments don't process, AI chat is broken in default config, schema/UI mismatches in admin write paths, no observability, no tests |

---

### Top recommended priorities (factual, derived from findings — not changes you asked for)

1. Fix the AI chat path — either deploy the missing Supabase Edge Function or repoint `js/ai.js` at `/api/ai-stream`.
2. Reconcile schema/UI column-name mismatches: `blog_posts` (excerpt/publish_at), `visa_programs` (fit_score), `payment_gateways` (flat vs jsonb), `ai_providers_config` (api_key column).
3. Wire `selectPlan()` to `/api/stripe-checkout`, add `/api/stripe-webhook`, and add a `subscriptions` table.
4. Replace `Math.random()` readiness scoring and hardcoded billing/analytics with real backed data.
5. Audit all `innerHTML` interpolations in admin tables for XSS, especially the `JSON.stringify` in attribute strings.
6. Add a minimal rate limiter on `/api/ai-stream` (per-user token budget) before exposing real keys.


---

## PHASE 4 — JUNE 2026 PRODUCTION HARDENING

> Fix bundle for: deprecated OpenRouter models, mobile horizontal overflow,
> and Pitch Deck generation failures.

### Issues Resolved

| # | Issue | Root Cause | Fix |
|---|---|---|---|
| 1 | `No endpoints found for anthropic/claude-3.5-sonnet` | OpenRouter retired `claude-3.5-sonnet` and `gemini-flash-1.5`; hardcoded in `api/generate-deck.js`, `js/ai.js`, `supabase_schema.sql` | New shared module `api/_lib/aiProviders.js` with `OPENROUTER_MODEL_CHAIN`, `DEPRECATED_MODEL_MAP`, `normalizeModel()`. Schema seeded with current ids. |
| 2 | Single-model deck generator with no retry | `callOpenRouterClaude()` hit one model, errored, surfaced raw text | `callOpenRouterWithFallback()` walks 5-model chain × 3 attempts each with exponential backoff. |
| 3 | Stale model name in DB | Existing rows in `ai_providers_config.default_model` could still hold the deprecated string | Idempotent `update ... where default_model in (...)` migration in `supabase_schema_v2.sql`. |
| 4 | Raw provider errors leaking to UI | "Generation failed: openrouter_404: No endpoints found..." reached toast | Server returns friendly text via `friendlyError()`; client also has a defensive translator. |
| 5 | Horizontal overflow on mobile | `.aur` blobs (600px), `#cta` 600×400 absolute glow, `.db-main { margin-left: 240px }` not clamped, third-party inline widths | Hardened `css/nova.css` with `html, body { max-width: 100% }`, `section { overflow-x: clip }`, mobile `@media (max-width: 991px)` `.db-main { margin-left: 0 !important }`, `[style*="width:600px"] { max-width: 100% !important }`, plus runtime `clampViewport()` safety net in `main.js`. |
| 6 | No diagnostics for AI failures | Errors swallowed into `ai_requests.error_message` only | `diag.record({...})` writes a structured JSON line per attempt; Vercel log drains catch them. Each request stores `attempts` count in `audit_logs.metadata`. |
| 7 | Front-end model menu offered retired models | `js/ai.js` MODELS array | Replaced with current chain. |

### New / Modified Files

```
api/_lib/aiProviders.js     NEW   Shared chain + retry + diagnostics
api/generate-deck.js        REWRITE  Native + OpenRouter chain, friendly errors
api/ai-stream.js            REWRITE  Same pattern, plus OpenRouter chain fallback
                                     for stream mode
js/ai.js                    EDIT  MODELS list updated to current OpenRouter ids
js/store.js                 EDIT  Default model -> anthropic/claude-sonnet-4
js/main.js                  EDIT  Friendly toasts for deck/plan failures;
                                  appended runtime overflow safeguard
css/nova.css                APPEND  Mobile responsiveness rules
supabase_schema.sql         EDIT  Seeds use current model identifiers
supabase_schema_v2.sql      APPEND Idempotent migration for old default_models
tests/run.js                EDIT  +5 tests covering aiProviders helpers
```

### Provider Chain (priority order)

1. `anthropic/claude-sonnet-4` — Claude Sonnet 4 (preferred for deck JSON quality)
2. `google/gemini-2.5-pro` — secondary
3. `openai/gpt-4o`
4. `openai/gpt-4o-mini`
5. `deepseek/deepseek-chat`

The deck endpoint additionally tries the Anthropic native API first
(when `ANTHROPIC_API_KEY` is set) and falls through to OpenAI's JSON-mode
as a last resort. Each provider is retried up to 3 times with exponential
backoff before moving to the next one.

### Mobile Hardening Summary

- `html, body { max-width: 100%; overflow-x: hidden }`
- `section, .sp { overflow-x: clip }`
- `.db-main, .db-top { margin-left: 0 !important }` ≤ 991px
- `.db-dropdown { max-width: calc(100vw - 28px) }` ≤ 575px
- `[style*="width:600px"] { max-width: 100% !important }`
- Runtime `clampViewport()` walks top-level body children if
  `documentElement.scrollWidth > window.innerWidth`.

### Verification

```
$ node tests/run.js
30 passed, 0 failed
```

The new `aiProviders` test group asserts:
- The active model chain contains zero deprecated identifiers.
- `normalizeModel()` rewrites every old alias.
- `friendlyError()` translates raw provider strings.
- Safety classifier models can never leak into a generation call.

### Migration Steps for Operators

1. Pull latest code, redeploy Vercel.
2. Run `supabase_schema_v2.sql` against the Supabase project (idempotent).
3. (Optional) In Super Admin → AI Engine, confirm provider rows show
   `anthropic/claude-sonnet-4` or `google/gemini-2.5-pro` as their default
   model. Older values are auto-migrated by the SQL above.
4. Smoke-test:
   - Login → Dashboard → Pitch Decks → "Generate Deck" — must succeed
     without a "No endpoints found" toast.
   - Open the same dashboard at 320 px width (Chrome DevTools) — no
     horizontal scroll, no black bar on the right.
   - Business Plan generation must continue to work as before.

