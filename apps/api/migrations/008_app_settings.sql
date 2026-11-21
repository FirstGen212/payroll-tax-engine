-- App-wide settings an admin can change without a release, such as what each benefit package costs First Gen.
create table if not exists app_setting (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
