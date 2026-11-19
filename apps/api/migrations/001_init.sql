-- Payroll tax research database and payroll app schema.
-- Tax reference data is effective-dated and cited; client data is multi-tenant by client_id.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- reference data
create table if not exists tax_source (
  id          text primary key,
  agency      text not null,
  title       text not null,
  url         text not null default '',
  retrieved   date,
  notes       text
);

create table if not exists jurisdiction (
  code        text primary key,               -- 'US', 'CA', 'OH-COLUMBUS', 'PA-PSD-700102'
  name        text not null,
  type        text not null,                  -- federal/state/district/territory/county/city/school_district/psd/transit_district/special_district
  parent_code text references jurisdiction(code),
  state       text not null,
  fips        text,
  flags       text[] not null default '{}',   -- mirror_code, fica_applies, futa_applies, fit_replaced_by_territory_tax, ...
  attrs       jsonb not null default '{}',
  notes       text
);
create index if not exists jurisdiction_state_idx on jurisdiction(state);
create index if not exists jurisdiction_type_idx on jurisdiction(type);

create table if not exists tax_rule (
  id              text primary key,           -- 'US.FIT.2027'
  jurisdiction    text not null references jurisdiction(code),
  kind            text not null,              -- FIT, SIT, SUI_ER, SDI_EE, LIT_EE, ...
  name            text not null,
  payer           text not null check (payer in ('employee','employer')),
  wage_basis      text not null,
  effective_from  date not null,
  effective_to    date,
  status          text not null check (status in ('published','draft','projected','unverified','placeholder')),
  calc            jsonb not null,             -- CalcSpec
  nonresident_calc jsonb,
  applies_to      text,
  optional        boolean not null default false,
  notes           text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);
create index if not exists tax_rule_lookup_idx on tax_rule(jurisdiction, kind, effective_from);

create table if not exists tax_rule_source (
  rule_id   text references tax_rule(id) on delete cascade,
  source_id text references tax_source(id),
  primary key (rule_id, source_id)
);

-- Every change to a rule is kept, so we can audit what rate was used when.
create table if not exists tax_rule_history (
  id         bigserial primary key,
  rule_id    text not null,
  changed_at timestamptz not null default now(),
  changed_by text,
  before     jsonb,
  after      jsonb
);

create table if not exists reciprocity_agreement (
  work_state     text not null,
  resident_state text not null,
  form           text not null,
  effective_from date not null,
  effective_to   date,
  status         text not null,
  notes          text,
  primary key (work_state, resident_state, effective_from)
);

create table if not exists earning_type (
  code text primary key, name text not null, category text not null, cash boolean not null,
  supplemental boolean not null, taxability jsonb not null, state_overrides jsonb, w2 text, notes text
);

create table if not exists deduction_type (
  code text primary key, name text not null, category text not null, reduces_wages jsonb not null,
  state_overrides jsonb, limit_key text, catch_up_limit_key text, sort_order int not null,
  employer_paid boolean not null default false, w2 text, notes text
);

create table if not exists benefit_limit (
  key text not null, year int not null, name text not null, amount numeric(14,2) not null,
  status text not null, notes text, primary key (key, year)
);

create table if not exists retirement_system (
  code text primary key, name text not null, state text not null, member_rate numeric(8,5) not null,
  employer_rate numeric(8,5), pickup_414h boolean not null, ss_covered text not null,
  effective_from date not null, status text not null, notes text
);

create table if not exists vendor_profile (
  id text primary key, name text not null, status text not null, conventions jsonb not null,
  sample_count int not null default 0, notes text, updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- clients (multi-employer)
create table if not exists client (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  fein           text,
  home_state     text,
  pay_frequency  text not null default 'biweekly',
  futa_exempt    boolean not null default false,
  employee_count int,
  current_vendor text references vendor_profile(id),
  withhold_resident_local boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now()
);

create table if not exists client_work_location (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references client(id) on delete cascade,
  label       text not null,
  state       text not null,
  local_codes text[] not null default '{}',
  address     text
);

-- Per-client tax accounts: assigned SUI rates, account numbers, rate overrides and on/off toggles.
create table if not exists client_tax_setting (
  client_id     uuid not null references client(id) on delete cascade,
  tax_key       text not null,       -- '${jurisdiction}.${kind}' or a rule id
  enabled       boolean,
  rate          numeric(10,6),       -- decimal, e.g. 0.027
  account_number text,
  effective_from date not null default '2027-01-01',
  primary key (client_id, tax_key, effective_from)
);

create table if not exists employee (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references client(id) on delete cascade,
  employee_number    text,
  first_name         text not null,
  last_name          text not null,
  birth_date         date,
  hire_date          date,
  pay_type           text not null default 'hourly',   -- hourly / salary
  pay_rate           numeric(14,4) not null default 0,
  standard_hours     numeric(8,2) default 80,
  residence_state    text not null,
  residence_locals   text[] not null default '{}',
  residence_zip      text,
  unemployment_state text,
  ss_covered         boolean not null default true,
  medicare_covered   boolean not null default true,
  federal_w4         jsonb not null,
  state_w4           jsonb not null default '{}',
  tax_toggles        jsonb not null default '{}',
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);
create index if not exists employee_client_idx on employee(client_id);

create table if not exists employee_work_allocation (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references employee(id) on delete cascade,
  location_id            uuid references client_work_location(id),
  state                  text not null,
  local_codes            text[] not null default '{}',
  percent                numeric(7,4) not null,
  remote_for_convenience boolean not null default false
);

create table if not exists employee_recurring_deduction (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employee(id) on delete cascade,
  deduction_code    text not null references deduction_type(code),
  amount            numeric(14,2),
  percent           numeric(8,5),
  retirement_system text references retirement_system(code),
  garnishment       jsonb,
  start_date        date,
  end_date          date
);

-- ---------------------------------------------------------------- pay runs
create table if not exists pay_run (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references client(id) on delete cascade,
  run_type          text not null check (run_type in ('actual','mock','proposal')),
  vendor_profile_id text references vendor_profile(id),
  check_date        date not null,
  period_start      date,
  period_end        date,
  pay_frequency     text not null,
  label             text,
  totals            jsonb,
  created_at        timestamptz not null default now()
);

create table if not exists pay_statement (
  id            uuid primary key default gen_random_uuid(),
  pay_run_id    uuid not null references pay_run(id) on delete cascade,
  employee_id   uuid not null references employee(id),
  input         jsonb not null,     -- full PayInput used (reproducible)
  result        jsonb not null,     -- full PayResult with audit trail
  gross         numeric(14,2) not null,
  net           numeric(14,2) not null,
  employee_taxes numeric(14,2) not null,
  employer_taxes numeric(14,2) not null
);
create index if not exists pay_statement_run_idx on pay_statement(pay_run_id);

-- YTD accumulators per employee per year (actual runs only); mock/proposal runs never touch them.
create table if not exists employee_ytd (
  employee_id uuid not null references employee(id) on delete cascade,
  year        int not null,
  ytd         jsonb not null,
  primary key (employee_id, year)
);

-- ---------------------------------------------------------------- vendor learning
create table if not exists vendor_sample_paycheck (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   text not null references vendor_profile(id),
  client_id   uuid references client(id),
  label       text,
  input       jsonb not null,
  actual      jsonb not null,
  uploaded_at timestamptz not null default now()
);

create table if not exists vendor_learn_run (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  text not null references vendor_profile(id),
  result     jsonb not null,
  created_at timestamptz not null default now()
);
