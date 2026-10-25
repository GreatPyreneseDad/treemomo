create table if not exists tm_gifts (id uuid primary key default gen_random_uuid(), tree uuid not null references tm_trees(id) on delete cascade,
  giver text not null, giver_user uuid references tm_users(id) on delete set null, from_name text, poem text not null, title text not null, code text not null, how text,
  status text not null default 'open' check (status in ('open','claimed','withdrawn')), created_at timestamptz not null default now(),
  claimed_by text, claimed_user uuid references tm_users(id) on delete set null, claimed_at timestamptz, verdict jsonb, attempts int not null default 0);
create unique index if not exists tm_gifts_one_open on tm_gifts (tree) where status = 'open';
create index if not exists tm_gifts_claimed_by on tm_gifts (claimed_by);
create index if not exists tm_gifts_giver on tm_gifts (giver);
alter table tm_chronicle drop constraint if exists tm_chronicle_kind_check;
alter table tm_chronicle add constraint tm_chronicle_kind_check check (kind in ('moment','memory','steward','cleanup','hug','gift'));
