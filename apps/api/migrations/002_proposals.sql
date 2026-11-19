-- Proposal / underwriting tool: uploaded census or payroll sample, column mapping,
-- settings (tiers, thresholds), and the calculated before/after results.
create table if not exists proposal (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  client_id   uuid references client(id) on delete set null,
  company     text,
  file_name   text,
  sheet_name  text,
  headers     jsonb not null default '[]',
  raw_rows    jsonb not null default '[]',
  mapping     jsonb not null default '{}',
  settings    jsonb not null default '{}',
  summary     jsonb,
  results     jsonb,
  status      text not null default 'draft',      -- draft | sent | won | lost
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists proposal_client_idx on proposal(client_id);
