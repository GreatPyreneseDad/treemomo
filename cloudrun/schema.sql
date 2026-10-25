create extension if not exists pgcrypto;
create table if not exists tm_trees (id uuid primary key default gen_random_uuid(), lat double precision, lng double precision, accuracy_m double precision,
  species text, species_confidence double precision, health jsonb, visits int not null default 1, first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(), momo jsonb, place jsonb);
create index if not exists tm_trees_ll on tm_trees (lat, lng);
create table if not exists tm_sightings (id uuid primary key default gen_random_uuid(), tree uuid references tm_trees(id) on delete cascade, player text,
  video_path text, analysis jsonb, momo jsonb, placement jsonb, critiques jsonb not null default '[]', sponsor jsonb,
  status text not null default 'new' check (status in ('new','documented','captured','escaped')), created_at timestamptz not null default now());
create index if not exists tm_sightings_player on tm_sightings (player, created_at desc);
create table if not exists tm_sponsors (id uuid primary key default gen_random_uuid(), name text, offer text, lat double precision, lng double precision,
  radius_m int not null default 400, demo boolean not null default true, active boolean not null default true, created_at timestamptz not null default now());
create table if not exists tm_chronicle (id bigserial primary key, tree uuid references tm_trees(id) on delete cascade, sighting uuid references tm_sightings(id) on delete set null,
  kind text not null check (kind in ('moment','memory','steward')), text text, author text, player text, weather jsonb, verified boolean not null default false, at timestamptz not null default now());
create index if not exists tm_chronicle_tree on tm_chronicle (tree, at desc);
create table if not exists tm_quests (id uuid primary key default gen_random_uuid(), tree uuid not null references tm_trees(id) on delete cascade,
  kind text not null default 'cleanup', status text not null default 'open' check (status in ('open','done','closed')), ask text, litter jsonb,
  before_sighting uuid references tm_sightings(id) on delete set null, before_path text, created_by text, created_at timestamptz not null default now(),
  done_by text, done_at timestamptz, after_path text, verdict jsonb, attempts int not null default 0);
create unique index if not exists tm_quests_one_open on tm_quests (tree) where status = 'open';
create index if not exists tm_quests_done_by on tm_quests (done_by) where status = 'done';
create table if not exists tm_badges (player text not null, badge text not null, at timestamptz not null default now(), primary key (player, badge));
alter table tm_chronicle drop constraint if exists tm_chronicle_kind_check;
alter table tm_chronicle add constraint tm_chronicle_kind_check check (kind in ('moment','memory','steward','cleanup'));
create table if not exists tm_hugs (id uuid primary key default gen_random_uuid(), tree uuid not null references tm_trees(id) on delete cascade, player text not null, verdict jsonb, at timestamptz not null default now());
create index if not exists tm_hugs_player on tm_hugs (player, tree, at desc);
alter table tm_chronicle drop constraint if exists tm_chronicle_kind_check;
alter table tm_chronicle add constraint tm_chronicle_kind_check check (kind in ('moment','memory','steward','cleanup','hug'));
create table if not exists tm_users (id uuid primary key default gen_random_uuid(), google_sub text not null unique, email text, name text, picture text,
  primary_player text not null unique, created_at timestamptz not null default now(), last_seen timestamptz not null default now());
create table if not exists tm_links (player text primary key, user_id uuid not null references tm_users(id) on delete cascade, linked_at timestamptz not null default now());
create table if not exists tm_gifts (id uuid primary key default gen_random_uuid(), tree uuid not null references tm_trees(id) on delete cascade,
  giver text not null, giver_user uuid references tm_users(id) on delete set null, from_name text, poem text not null, title text not null, code text not null, how text,
  status text not null default 'open' check (status in ('open','claimed','withdrawn')), created_at timestamptz not null default now(),
  claimed_by text, claimed_user uuid references tm_users(id) on delete set null, claimed_at timestamptz, verdict jsonb, attempts int not null default 0);
create unique index if not exists tm_gifts_one_open on tm_gifts (tree) where status = 'open';
create index if not exists tm_gifts_claimed_by on tm_gifts (claimed_by);
create index if not exists tm_gifts_giver on tm_gifts (giver);
alter table tm_chronicle drop constraint if exists tm_chronicle_kind_check;
alter table tm_chronicle add constraint tm_chronicle_kind_check check (kind in ('moment','memory','steward','cleanup','hug','gift'));
