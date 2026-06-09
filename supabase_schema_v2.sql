-- =====================================================================
-- Nova StartupOS AI — Production Hardening Migration (v2)
-- ---------------------------------------------------------------------
-- ADDITIVE migration. Run AFTER supabase_schema.sql. Safe to re-run.
--
-- Adds:
--   • subscriptions, payments, ai_requests, usage_tracking,
--     audit_logs, notifications, assessments, system_events tables
--   • saved_funding (user "save opportunity" relation)
--   • Column compatibility: blog_posts.excerpt / blog_posts.publish_at
--     (kept as a backward-compat alias view exposed via generated cols)
--   • visa_programs.fit_score numeric (separate from suitability_score)
--   • ai_providers_config.api_key text (encrypted at rest by Postgres)
--   • payment_gateways flat columns (publishable_key, secret_key, etc.)
--     mirrored alongside the existing config jsonb so writes from either
--     shape succeed; reads can use either.
--   • RLS, indexes, and triggers for every new table
--   • record_audit() helper + log_profile_changes trigger
-- =====================================================================

create extension if not exists "pgcrypto";

-- =====================================================================
-- 1. COLUMN COMPATIBILITY (additive — never drops data)
-- =====================================================================

-- ---- blog_posts: add excerpt + publish_at synonyms ------------------
alter table public.blog_posts add column if not exists excerpt    text;
alter table public.blog_posts add column if not exists publish_at timestamptz;

-- One-shot backfill so existing rows carry both column names.
update public.blog_posts set excerpt    = coalesce(excerpt, snippet);
update public.blog_posts set publish_at = coalesce(publish_at, scheduled_at);

-- Keep both columns in sync via trigger (writes to either column work).
create or replace function public.sync_blog_aliases()
returns trigger language plpgsql as $$
begin
  -- snippet <-> excerpt
  if new.snippet is distinct from old.snippet and new.excerpt is not distinct from old.excerpt then
    new.excerpt := new.snippet;
  elsif new.excerpt is distinct from old.excerpt and new.snippet is not distinct from old.snippet then
    new.snippet := new.excerpt;
  end if;
  -- scheduled_at <-> publish_at
  if new.scheduled_at is distinct from old.scheduled_at and new.publish_at is not distinct from old.publish_at then
    new.publish_at := new.scheduled_at;
  elsif new.publish_at is distinct from old.publish_at and new.scheduled_at is not distinct from old.scheduled_at then
    new.scheduled_at := new.publish_at;
  end if;
  return new;
end$$;

drop trigger if exists trg_blog_alias_sync on public.blog_posts;
create trigger trg_blog_alias_sync
  before update on public.blog_posts
  for each row execute function public.sync_blog_aliases();

-- Insert-time alias copy (column may be supplied either way).
create or replace function public.sync_blog_aliases_ins()
returns trigger language plpgsql as $$
begin
  if new.excerpt is null and new.snippet is not null then new.excerpt := new.snippet; end if;
  if new.snippet is null and new.excerpt is not null then new.snippet := new.excerpt; end if;
  if new.publish_at is null and new.scheduled_at is not null then new.publish_at := new.scheduled_at; end if;
  if new.scheduled_at is null and new.publish_at is not null then new.scheduled_at := new.publish_at; end if;
  return new;
end$$;

drop trigger if exists trg_blog_alias_sync_ins on public.blog_posts;
create trigger trg_blog_alias_sync_ins
  before insert on public.blog_posts
  for each row execute function public.sync_blog_aliases_ins();

-- ---- visa_programs: fit_score numeric ------------------------------
alter table public.visa_programs add column if not exists fit_score integer;
update public.visa_programs
   set fit_score = coalesce(fit_score, nullif(regexp_replace(coalesce(suitability_score, ''), '\D', '', 'g'), '')::int)
 where fit_score is null;

-- ---- ai_providers_config: api_key column (server reads ENV in prod)
alter table public.ai_providers_config add column if not exists api_key text;

-- ---- payment_gateways: flat columns mirrored alongside config jsonb -
alter table public.payment_gateways add column if not exists publishable_key text;
alter table public.payment_gateways add column if not exists secret_key      text;
alter table public.payment_gateways add column if not exists webhook_url     text;
alter table public.payment_gateways add column if not exists webhook_secret  text;
alter table public.payment_gateways add column if not exists client_id       text;
alter table public.payment_gateways add column if not exists client_secret   text;
alter table public.payment_gateways add column if not exists webhook_id      text;
alter table public.payment_gateways add column if not exists live            boolean default false;

create or replace function public.sync_gateway_config()
returns trigger language plpgsql as $$
declare merged jsonb;
begin
  -- Build a merged jsonb from flat columns. Frontend can write either shape.
  merged := jsonb_strip_nulls(jsonb_build_object(
    'publishable_key', new.publishable_key,
    'secret_key',      new.secret_key,
    'webhook_url',     new.webhook_url,
    'webhook_secret',  new.webhook_secret,
    'client_id',       new.client_id,
    'client_secret',   new.client_secret,
    'webhook_id',      new.webhook_id,
    'live',            new.live
  ));
  -- Preserve any extra keys the caller already had in `config`.
  new.config := coalesce(new.config, '{}'::jsonb) || merged;
  return new;
end$$;

drop trigger if exists trg_gateway_sync on public.payment_gateways;
create trigger trg_gateway_sync
  before insert or update on public.payment_gateways
  for each row execute function public.sync_gateway_config();


-- =====================================================================
-- 2. NEW TABLES
-- =====================================================================

-- ---- subscriptions --------------------------------------------------
create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  stripe_customer_id       text,
  stripe_subscription_id   text unique,
  stripe_price_id          text,
  plan_tier                text not null check (plan_tier in ('Free','Pro','Startup')),
  status                   text not null check (status in
                             ('trialing','active','past_due','canceled','incomplete','incomplete_expired','unpaid','paused')),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean default false,
  canceled_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists idx_subs_user_id on public.subscriptions(user_id);
create index if not exists idx_subs_status  on public.subscriptions(status);

-- ---- payments -------------------------------------------------------
create table if not exists public.payments (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  subscription_id          uuid references public.subscriptions(id) on delete set null,
  stripe_payment_intent_id text,
  stripe_invoice_id        text unique,
  amount_cents             integer not null,
  currency                 text not null default 'usd',
  status                   text not null check (status in
                             ('succeeded','pending','failed','refunded')),
  description              text,
  receipt_url              text,
  created_at               timestamptz not null default now()
);
create index if not exists idx_payments_user_id on public.payments(user_id);
create index if not exists idx_payments_sub_id  on public.payments(subscription_id);
create index if not exists idx_payments_status  on public.payments(status);

-- ---- audit_logs -----------------------------------------------------
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  user_name   text,
  user_email  text,
  action      text not null,           -- e.g. 'user.suspend', 'role.change'
  resource    text,                    -- e.g. 'profiles', 'startups'
  resource_id text,
  metadata    jsonb default '{}'::jsonb,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_user      on public.audit_logs(user_id);
create index if not exists idx_audit_action    on public.audit_logs(action);
create index if not exists idx_audit_created   on public.audit_logs(created_at desc);

-- Helper to write an audit row from any SECURITY DEFINER function/trigger.
create or replace function public.record_audit(
  p_action text, p_resource text, p_resource_id text, p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid;
  v_name  text;
  v_email text;
begin
  v_uid := auth.uid();
  if v_uid is not null then
    select name, email into v_name, v_email from public.profiles where id = v_uid;
  end if;
  insert into public.audit_logs(user_id, user_name, user_email, action, resource, resource_id, metadata)
  values (v_uid, v_name, v_email, p_action, p_resource, p_resource_id, coalesce(p_metadata, '{}'::jsonb));
end$$;

-- Auto-log changes to the role column (privilege-escalation forensics).
create or replace function public.log_profile_role_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.role is distinct from old.role
                          or new.is_active is distinct from old.is_active) then
    perform public.record_audit(
      case when new.role is distinct from old.role then 'profile.role_change'
           else 'profile.status_change' end,
      'profiles', new.id::text,
      jsonb_build_object('old_role', old.role, 'new_role', new.role,
                         'old_is_active', old.is_active, 'new_is_active', new.is_active)
    );
  end if;
  return new;
end$$;

drop trigger if exists trg_log_profile_changes on public.profiles;
create trigger trg_log_profile_changes
  after update on public.profiles
  for each row execute function public.log_profile_role_changes();

-- ---- notifications --------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_user_id   on public.notifications(user_id);
create index if not exists idx_notif_unread    on public.notifications(user_id, is_read) where is_read = false;

-- ---- assessments (real readiness scoring history) ------------------
create table if not exists public.assessments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  startup_id         uuid not null references public.startups(id) on delete cascade,
  innovation_score   integer not null check (innovation_score   between 0 and 100),
  scalability_score  integer not null check (scalability_score  between 0 and 100),
  market_score       integer not null check (market_score       between 0 and 100),
  investment_score   integer not null check (investment_score   between 0 and 100),
  composite_score    integer not null check (composite_score    between 0 and 100),
  recommendations    jsonb   not null default '[]'::jsonb,
  inputs             jsonb   not null default '{}'::jsonb,  -- snapshot of fields used
  created_at         timestamptz not null default now()
);
create index if not exists idx_assess_user    on public.assessments(user_id);
create index if not exists idx_assess_startup on public.assessments(startup_id, created_at desc);

-- ---- ai_requests (one row per AI invocation) ------------------------
create table if not exists public.ai_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  provider_name   text,
  model           text,
  prompt_chars    integer,
  completion_chars integer,
  prompt_tokens   integer,
  completion_tokens integer,
  cost_usd        numeric(10,6) default 0,
  status          text not null check (status in ('ok','error','rate_limited','blocked')),
  error_message   text,
  ip_address      text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ai_user    on public.ai_requests(user_id, created_at desc);
create index if not exists idx_ai_status  on public.ai_requests(status);

-- ---- usage_tracking (rolling counters per user / period) -----------
create table if not exists public.usage_tracking (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  metric          text not null,            -- 'ai_requests','plans_generated','decks_generated'
  period          text not null,            -- 'YYYY-MM-DD' (day) or 'YYYY-MM' (month)
  count           integer not null default 0,
  updated_at      timestamptz not null default now(),
  unique (user_id, metric, period)
);
create index if not exists idx_usage_user on public.usage_tracking(user_id);

-- ---- system_events (super-admin "system health" telemetry) ---------
create table if not exists public.system_events (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,                -- 'database','ai','email','storage'
  status      text not null check (status in ('ok','degraded','down')),
  latency_ms  integer,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sysevents_source on public.system_events(source, created_at desc);

-- ---- saved_funding (user-saved opportunities) ----------------------
create table if not exists public.saved_funding (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  funding_source_id   uuid not null references public.funding_sources(id) on delete cascade,
  notes               text,
  created_at          timestamptz not null default now(),
  unique (user_id, funding_source_id)
);
create index if not exists idx_saved_funding_user on public.saved_funding(user_id);


-- =====================================================================
-- 3. updated_at TRIGGERS for new tables
-- =====================================================================
drop trigger if exists trg_subs_updated on public.subscriptions;
create trigger trg_subs_updated
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_usage_updated on public.usage_tracking;
create trigger trg_usage_updated
  before update on public.usage_tracking
  for each row execute function public.set_updated_at();


-- =====================================================================
-- 4. ROW-LEVEL SECURITY for new tables
-- =====================================================================
alter table public.subscriptions   enable row level security;
alter table public.payments        enable row level security;
alter table public.audit_logs      enable row level security;
alter table public.notifications   enable row level security;
alter table public.assessments     enable row level security;
alter table public.ai_requests     enable row level security;
alter table public.usage_tracking  enable row level security;
alter table public.system_events   enable row level security;
alter table public.saved_funding   enable row level security;

-- ---- subscriptions -------------------------------------------------
drop policy if exists subs_owner_select on public.subscriptions;
drop policy if exists subs_admin_select on public.subscriptions;
create policy subs_owner_select on public.subscriptions
  for select using (user_id = auth.uid());
create policy subs_admin_select on public.subscriptions
  for select using (public.is_admin());
-- Writes only happen from server-side (service role) via webhook.

-- ---- payments ------------------------------------------------------
drop policy if exists pay_owner_select  on public.payments;
drop policy if exists pay_admin_select  on public.payments;
create policy pay_owner_select on public.payments
  for select using (user_id = auth.uid());
create policy pay_admin_select on public.payments
  for select using (public.is_admin());

-- ---- audit_logs ----------------------------------------------------
drop policy if exists audit_admin_select on public.audit_logs;
create policy audit_admin_select on public.audit_logs
  for select using (public.is_admin());
-- Writes happen via record_audit() (SECURITY DEFINER) only.

-- ---- notifications -------------------------------------------------
drop policy if exists notif_owner_all on public.notifications;
create policy notif_owner_all on public.notifications
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- assessments ---------------------------------------------------
drop policy if exists assess_owner_all   on public.assessments;
drop policy if exists assess_admin_select on public.assessments;
create policy assess_owner_all on public.assessments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy assess_admin_select on public.assessments
  for select using (public.is_admin());

-- ---- ai_requests ---------------------------------------------------
drop policy if exists ai_owner_select  on public.ai_requests;
drop policy if exists ai_admin_select  on public.ai_requests;
create policy ai_owner_select on public.ai_requests
  for select using (user_id = auth.uid());
create policy ai_admin_select on public.ai_requests
  for select using (public.is_admin());

-- ---- usage_tracking ------------------------------------------------
drop policy if exists usage_owner_select on public.usage_tracking;
drop policy if exists usage_admin_select on public.usage_tracking;
create policy usage_owner_select on public.usage_tracking
  for select using (user_id = auth.uid());
create policy usage_admin_select on public.usage_tracking
  for select using (public.is_admin());

-- ---- system_events -------------------------------------------------
drop policy if exists sysev_admin_select on public.system_events;
create policy sysev_admin_select on public.system_events
  for select using (public.is_admin());

-- ---- saved_funding -------------------------------------------------
drop policy if exists savfund_owner_all on public.saved_funding;
create policy savfund_owner_all on public.saved_funding
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- =====================================================================
-- 5. STORAGE BUCKET (idempotent)
-- =====================================================================
-- Creates the startup-logos bucket + an authenticated-write / public-read policy.
-- Safe to run repeatedly.
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'startup-logos') then
    insert into storage.buckets (id, name, public) values ('startup-logos', 'startup-logos', true);
  end if;
end$$;

drop policy if exists "startup_logos_public_read" on storage.objects;
create policy "startup_logos_public_read"
  on storage.objects for select
  using (bucket_id = 'startup-logos');

drop policy if exists "startup_logos_auth_write" on storage.objects;
create policy "startup_logos_auth_write"
  on storage.objects for insert
  with check (bucket_id = 'startup-logos' and auth.uid() is not null);

drop policy if exists "startup_logos_auth_update" on storage.objects;
create policy "startup_logos_auth_update"
  on storage.objects for update
  using (bucket_id = 'startup-logos' and auth.uid() is not null);


-- =====================================================================
-- 5. MODEL MIGRATION (June 2026 hardening)
-- ---------------------------------------------------------------------
-- The previous default models for some providers have been retired by
-- their vendors and now return "No endpoints found for ..." from
-- OpenRouter. Rewrite any old default_model values stored in
-- ai_providers_config to their current equivalents. Idempotent.
-- =====================================================================
update public.ai_providers_config
   set default_model = 'anthropic/claude-sonnet-4'
 where default_model in (
   'anthropic/claude-3.5-sonnet',
   'anthropic/claude-3-5-sonnet',
   'anthropic/claude-3-5-sonnet-20241022',
   'claude-3-5-sonnet',
   'claude-3-5-sonnet-20241022',
   'claude-3.5-sonnet'
 );

update public.ai_providers_config
   set default_model = 'google/gemini-2.5-pro'
 where default_model in (
   'google/gemini-flash-1.5',
   'google/gemini-pro-1.5',
   'gemini-1.5-flash',
   'gemini-1.5-pro'
 );

-- Make sure the default OpenRouter row points at a current model. If a
-- new install seeded the v1 schema before this migration ran, this
-- corrects it. Safe to re-run.
update public.ai_providers_config
   set default_model = 'anthropic/claude-sonnet-4'
 where provider_name = 'openrouter'
   and (default_model is null or default_model = '');


-- =====================================================================
-- DONE.
-- =====================================================================
