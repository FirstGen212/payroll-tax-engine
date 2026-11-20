-- Users, roles and permissions, sessions (with impersonation), audit log,
-- proposal ownership/queue fields, proposal revisions and published client reports.
create table if not exists app_user (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null,
  role          text not null default 'analyst',        -- admin | manager | analyst | viewer
  extra_permissions text[] not null default '{}',       -- granted on top of the role
  denied_permissions text[] not null default '{}',      -- taken away from the role
  password_hash text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists app_session (
  id              text primary key,                     -- sha256 of the cookie token
  user_id         uuid not null references app_user(id) on delete cascade,
  impersonating_id uuid references app_user(id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);
create index if not exists app_session_user_idx on app_session(user_id);

create table if not exists audit_log (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  actor_id      uuid references app_user(id) on delete set null,   -- who is really signed in
  as_user_id    uuid references app_user(id) on delete set null,   -- whose view they were using (impersonation)
  action        text not null,
  target        text,
  detail        jsonb,
  ip            text
);
create index if not exists audit_log_at_idx on audit_log(at desc);

alter table proposal add column if not exists owner_id uuid references app_user(id) on delete set null;
alter table proposal add column if not exists notes text;
alter table proposal add column if not exists report_settings jsonb not null default '{}';
alter table proposal add column if not exists completed_at timestamptz;

create table if not exists proposal_revision (
  id          bigserial primary key,
  proposal_id uuid not null references proposal(id) on delete cascade,
  at          timestamptz not null default now(),
  user_id     uuid references app_user(id) on delete set null,
  label       text,
  settings    jsonb not null,
  summary     jsonb
);
create index if not exists proposal_revision_idx on proposal_revision(proposal_id, at desc);

-- A published, client-facing proposal page. Each publish is a fresh link with a snapshot of the numbers.
create table if not exists proposal_report (
  slug        text primary key,
  proposal_id uuid not null references proposal(id) on delete cascade,
  snapshot    jsonb not null,
  created_by  uuid references app_user(id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  views       integer not null default 0,
  last_viewed_at timestamptz
);
create index if not exists proposal_report_proposal_idx on proposal_report(proposal_id);
