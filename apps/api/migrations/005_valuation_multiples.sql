-- Typical EBITDA multiples by industry, ownership and company size. Seeded from published datasets
-- (apps/api/src/proposals/multiples-data.ts); every row keeps its source and whether the figure is
-- published, calculated from published figures, or edited by First Gen.
create table if not exists valuation_multiple (
  id text primary key,                 -- industry key | ownership | size band
  industry text not null,
  ownership text not null check (ownership in ('private', 'public')),
  size_band text not null,
  multiple numeric(6,2) not null,
  seed_multiple numeric(6,2),          -- the sourced figure, kept so an edit can be undone
  basis text not null check (basis in ('published', 'derived', 'custom')),
  seed_basis text,
  source text not null,
  source_url text,
  as_of text,
  method text,
  updated_at timestamptz not null default now(),
  updated_by text
);
create index if not exists valuation_multiple_lookup on valuation_multiple (industry, ownership, size_band);
