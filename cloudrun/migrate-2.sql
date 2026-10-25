create table if not exists tm_quests (id uuid primary key default gen_random_uuid(), tree uuid not null references tm_trees(id) on delete cascade,
  kind text not null default 'cleanup', status text not null default 'open' check (status in ('open','done','closed')), ask text, litter jsonb,
  before_sighting uuid references tm_sightings(id) on delete set null, before_path text, created_by text, created_at timestamptz not null default now(),
  done_by text, done_at timestamptz, after_path text, verdict jsonb, attempts int not null default 0);
create unique index if not exists tm_quests_one_open on tm_quests (tree) where status = 'open';
create index if not exists tm_quests_done_by on tm_quests (done_by) where status = 'done';
create table if not exists tm_badges (player text not null, badge text not null, at timestamptz not null default now(), primary key (player, badge));
alter table tm_chronicle drop constraint if exists tm_chronicle_kind_check;
alter table tm_chronicle add constraint tm_chronicle_kind_check check (kind in ('moment','memory','steward','cleanup'));
