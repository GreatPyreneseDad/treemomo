create table if not exists tm_families (id uuid primary key default gen_random_uuid(), name text not null, note text, species text, lat double precision, lng double precision, created_at timestamptz not null default now());
alter table tm_trees add column if not exists family uuid references tm_families(id) on delete set null;
create index if not exists tm_trees_family on tm_trees (family);
