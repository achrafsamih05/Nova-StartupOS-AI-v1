-- =====================================================================
-- Nova StartupOS AI — Production Database Schema (Supabase / PostgreSQL)
-- ---------------------------------------------------------------------
-- Run this ENTIRE script once in the Supabase SQL Editor.
-- It is idempotent-friendly: tables use IF NOT EXISTS, policies are
-- dropped before recreation, and the script can be re-run safely.
--
-- Sections:
--   1. Extensions
--   2. Generic helper (set_updated_at)  — must come BEFORE any tables
--                                          that wire it as a trigger.
--   3. Core tables                       — created BEFORE the role-check
--                                          functions, because Postgres
--                                          parses `language sql` bodies
--                                          at CREATE time.
--   4. Role helpers (is_admin / is_super_admin)
--   5. auth.users -> profiles sign-up trigger
--   6. updated_at triggers
--   7. Seed: default AI providers
--   8. Row-Level Security (RLS) + policies
-- =====================================================================


-- =====================================================================
-- 1. EXTENSIONS
-- =====================================================================
-- pgcrypto provides gen_random_uuid(); uuid-ossp kept for compatibility.
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";


-- =====================================================================
-- 2. GENERIC HELPER (no table dependencies)
-- =====================================================================
-- set_updated_at(): trigger to auto-maintain updated_at columns.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- =====================================================================
-- 3. CORE TABLES
-- =====================================================================
-- All tables are created BEFORE the role-check functions below, so the
-- `language sql` functions can resolve `public.profiles` at CREATE time.

-- ---- profiles --------------------------------------------------------
-- One row per auth user; populated automatically by the sign-up trigger.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text,
  email       text,
  role        text        not null default 'User'
                          check (role in ('User', 'Admin', 'Super Admin')),
  plan_tier   text        not null default 'Free'
                          check (plan_tier in ('Free', 'Pro', 'Startup')),
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- ---- startups --------------------------------------------------------
create table if not exists public.startups (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  name          text not null,
  industry      text,
  country       text,
  current_stage text default 'Idea',
  logo_url      text,
  startup_score integer default 0,
  scores        jsonb   default '{}'::jsonb,
  target_market text,
  problem       text,
  solution      text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_startups_user_id on public.startups (user_id);

-- ---- generated_documents --------------------------------------------
create table if not exists public.generated_documents (
  id          uuid primary key default gen_random_uuid(),
  startup_id  uuid references public.startups (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  doc_type    text not null check (doc_type in ('plan', 'deck', 'chat')),
  title       text,
  content     text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_docs_user_id    on public.generated_documents (user_id);
create index if not exists idx_docs_startup_id on public.generated_documents (startup_id);

-- ---- support_tickets -------------------------------------------------
-- `messages` holds the conversational JSONB array:
--   [{ "role": "user|admin", "content": "...", "at": "ISO-timestamp" }]
create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  title       text,
  status      text not null default 'open' check (status in ('open', 'closed')),
  messages    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_tickets_user_id on public.support_tickets (user_id);

-- ---- blog_posts ------------------------------------------------------
create table if not exists public.blog_posts (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  snippet      text,
  body         text,
  status       text not null default 'draft'
                            check (status in ('draft', 'published', 'scheduled')),
  scheduled_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ---- funding_sources -------------------------------------------------
create table if not exists public.funding_sources (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text,
  country     text,
  ticket_size text,
  created_at  timestamptz not null default now()
);

-- ---- visa_programs ---------------------------------------------------
create table if not exists public.visa_programs (
  id                uuid primary key default gen_random_uuid(),
  country           text not null,
  program_name      text not null,
  suitability_score text,
  created_at        timestamptz not null default now()
);

-- ---- payment_gateways ------------------------------------------------
-- `config` securely holds keys/secrets/webhooks as JSONB. Super-admin only.
create table if not exists public.payment_gateways (
  provider   text primary key,          -- 'stripe' | 'paypal'
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---- ai_providers_config ---------------------------------------------
create table if not exists public.ai_providers_config (
  provider_name      text primary key,  -- 'openrouter' | 'openai' | ...
  enabled            boolean     not null default false,
  priority           integer     default 100,
  input_cost_per_1k  numeric(10,6) default 0,
  output_cost_per_1k numeric(10,6) default 0,
  is_default         boolean     not null default false,
  default_model      text,
  updated_at         timestamptz not null default now()
);

-- ---- blocked_ips -----------------------------------------------------
create table if not exists public.blocked_ips (
  id         uuid primary key default gen_random_uuid(),
  ip_address text not null,
  reason     text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);


-- =====================================================================
-- 4. ROLE HELPERS  (now safe — public.profiles exists)
-- =====================================================================

-- ---------------------------------------------------------------------
-- is_admin(): TRUE when the current auth user is Admin or Super Admin.
-- CRITICAL: declared SECURITY DEFINER so it reads `profiles` WITHOUT
-- triggering RLS — this prevents infinite recursion in the profiles
-- policies that would otherwise re-query profiles to evaluate themselves.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('Admin', 'Super Admin')
  );
$$;

-- is_super_admin(): TRUE only for the Super Admin tier.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'Super Admin'
  );
$$;


-- =====================================================================
-- 5. AUTH SIGN-UP TRIGGER  (auth.users -> public.profiles)
-- =====================================================================
-- Automatically create a profile row on every new sign-up, syncing the
-- email/name and applying safe defaults. SECURITY DEFINER so it can write
-- to public.profiles regardless of the caller's privileges.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role, plan_tier, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name',
             new.raw_user_meta_data ->> 'name',
             split_part(new.email, '@', 1)),
    new.email,
    'User',
    'Free',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =====================================================================
-- 6. updated_at TRIGGERS
-- =====================================================================
drop trigger if exists trg_payment_gateways_updated on public.payment_gateways;
create trigger trg_payment_gateways_updated
  before update on public.payment_gateways
  for each row execute function public.set_updated_at();

drop trigger if exists trg_ai_providers_updated on public.ai_providers_config;
create trigger trg_ai_providers_updated
  before update on public.ai_providers_config
  for each row execute function public.set_updated_at();


-- =====================================================================
-- 7. SEED: DEFAULT AI PROVIDERS
-- =====================================================================
-- Pre-populate the 5 core providers so the Super Admin panel never boots
-- into an empty state. OpenRouter is the default; tweak costs/priority later.
--
-- IMPORTANT (June 2026 hardening): the model identifiers below are the
-- CURRENTLY-SUPPORTED OpenRouter slugs. Models we previously seeded
-- (anthropic/claude-3.5-sonnet, google/gemini-flash-1.5) have been
-- decommissioned by their vendors and now return
-- "No endpoints found for ...". The supabase_schema_v2.sql migration
-- contains an UPSERT that rewrites any old row to these new values.
insert into public.ai_providers_config
  (provider_name, enabled, priority, input_cost_per_1k, output_cost_per_1k, is_default, default_model)
values
  ('openrouter', true,  1,  0.0005, 0.0015, true,  'anthropic/claude-sonnet-4'),
  ('anthropic',  false, 2,  0.0030, 0.0150, false, 'anthropic/claude-sonnet-4'),
  ('gemini',     false, 3,  0.0004, 0.0012, false, 'google/gemini-2.5-pro'),
  ('openai',     false, 4,  0.0050, 0.0150, false, 'openai/gpt-4o'),
  ('deepseek',   false, 5,  0.0002, 0.0008, false, 'deepseek/deepseek-chat')
on conflict (provider_name) do nothing;


-- =====================================================================
-- 8. ROW-LEVEL SECURITY (RLS) + POLICIES
-- =====================================================================
-- Enable RLS on every table.
alter table public.profiles            enable row level security;
alter table public.startups            enable row level security;
alter table public.generated_documents enable row level security;
alter table public.support_tickets     enable row level security;
alter table public.blog_posts          enable row level security;
alter table public.funding_sources     enable row level security;
alter table public.visa_programs       enable row level security;
alter table public.payment_gateways    enable row level security;
alter table public.ai_providers_config enable row level security;
alter table public.blocked_ips         enable row level security;


-- ---------------------------------------------------------------------
-- PROFILES
--   - A user reads/updates their OWN profile.
--   - Admins read ALL profiles; Admins update ALL (suspend/activate).
--   - Note: role checks use is_admin() (SECURITY DEFINER) to avoid
--     recursive policy evaluation on this same table.
-- ---------------------------------------------------------------------
drop policy if exists profiles_select_own       on public.profiles;
drop policy if exists profiles_update_own       on public.profiles;
drop policy if exists profiles_admin_select_all on public.profiles;
drop policy if exists profiles_admin_update_all on public.profiles;
drop policy if exists profiles_admin_delete     on public.profiles;

create policy profiles_select_own
  on public.profiles for select
  using (id = auth.uid());

create policy profiles_update_own
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_admin_select_all
  on public.profiles for select
  using (public.is_admin());

create policy profiles_admin_update_all
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

create policy profiles_admin_delete
  on public.profiles for delete
  using (public.is_admin());


-- ---------------------------------------------------------------------
-- STARTUPS  (owner full control; admins read all)
-- ---------------------------------------------------------------------
drop policy if exists startups_owner_all    on public.startups;
drop policy if exists startups_admin_select on public.startups;

create policy startups_owner_all
  on public.startups for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy startups_admin_select
  on public.startups for select
  using (public.is_admin());


-- ---------------------------------------------------------------------
-- GENERATED_DOCUMENTS  (owner full control; admins read all)
-- ---------------------------------------------------------------------
drop policy if exists docs_owner_all    on public.generated_documents;
drop policy if exists docs_admin_select on public.generated_documents;

create policy docs_owner_all
  on public.generated_documents for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy docs_admin_select
  on public.generated_documents for select
  using (public.is_admin());


-- ---------------------------------------------------------------------
-- SUPPORT_TICKETS
--   - Owner can create/read/update their own tickets.
--   - Admins can read ALL and update ANY (to reply / change status).
-- ---------------------------------------------------------------------
drop policy if exists tickets_owner_all    on public.support_tickets;
drop policy if exists tickets_admin_select on public.support_tickets;
drop policy if exists tickets_admin_update on public.support_tickets;

create policy tickets_owner_all
  on public.support_tickets for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy tickets_admin_select
  on public.support_tickets for select
  using (public.is_admin());

create policy tickets_admin_update
  on public.support_tickets for update
  using (public.is_admin())
  with check (public.is_admin());


-- ---------------------------------------------------------------------
-- BLOG_POSTS
--   - Published posts are publicly readable (landing/blog).
--   - Admins have full management rights.
-- ---------------------------------------------------------------------
drop policy if exists blog_public_select on public.blog_posts;
drop policy if exists blog_admin_all     on public.blog_posts;

create policy blog_public_select
  on public.blog_posts for select
  using (status = 'published' or public.is_admin());

create policy blog_admin_all
  on public.blog_posts for all
  using (public.is_admin())
  with check (public.is_admin());


-- ---------------------------------------------------------------------
-- FUNDING_SOURCES  (readable by any authenticated user; admin-managed)
-- ---------------------------------------------------------------------
drop policy if exists funding_auth_select on public.funding_sources;
drop policy if exists funding_admin_all   on public.funding_sources;

create policy funding_auth_select
  on public.funding_sources for select
  using (auth.uid() is not null);

create policy funding_admin_all
  on public.funding_sources for all
  using (public.is_admin())
  with check (public.is_admin());


-- ---------------------------------------------------------------------
-- VISA_PROGRAMS  (readable by any authenticated user; admin-managed)
-- ---------------------------------------------------------------------
drop policy if exists visa_auth_select on public.visa_programs;
drop policy if exists visa_admin_all   on public.visa_programs;

create policy visa_auth_select
  on public.visa_programs for select
  using (auth.uid() is not null);

create policy visa_admin_all
  on public.visa_programs for all
  using (public.is_admin())
  with check (public.is_admin());


-- ---------------------------------------------------------------------
-- PAYMENT_GATEWAYS  (Super Admin ONLY — holds secrets)
-- ---------------------------------------------------------------------
drop policy if exists gateways_superadmin_all on public.payment_gateways;

create policy gateways_superadmin_all
  on public.payment_gateways for all
  using (public.is_super_admin())
  with check (public.is_super_admin());


-- ---------------------------------------------------------------------
-- AI_PROVIDERS_CONFIG
--   - Any authenticated user may READ (to learn default model/provider).
--   - Only Super Admin may modify costs/priority/keys.
-- ---------------------------------------------------------------------
drop policy if exists ai_auth_select      on public.ai_providers_config;
drop policy if exists ai_superadmin_write on public.ai_providers_config;

create policy ai_auth_select
  on public.ai_providers_config for select
  using (auth.uid() is not null);

create policy ai_superadmin_write
  on public.ai_providers_config for all
  using (public.is_super_admin())
  with check (public.is_super_admin());


-- ---------------------------------------------------------------------
-- BLOCKED_IPS  (Super Admin / Admin managed)
-- ---------------------------------------------------------------------
drop policy if exists blocked_admin_all on public.blocked_ips;

create policy blocked_admin_all
  on public.blocked_ips for all
  using (public.is_admin())
  with check (public.is_admin());


-- =====================================================================
-- DONE. Post-setup notes:
--   • Run supabase_schema_v2.sql next to add subscriptions, payments,
--     audit_logs, notifications, assessments, ai_requests, usage_tracking,
--     system_events, saved_funding, plus column-compatibility shims and
--     the storage bucket.
--   • Promote your first admin manually:
--       update public.profiles set role = 'Super Admin'
--       where email = 'you@example.com';
-- =====================================================================
