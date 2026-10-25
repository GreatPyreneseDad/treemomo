create table if not exists tm_hugs (id uuid primary key default gen_random_uuid(), tree uuid not null references tm_trees(id) on delete cascade, player text not null, verdict jsonb, at timestamptz not null default now());
create index if not exists tm_hugs_player on tm_hugs (player, tree, at desc);
alter table tm_chronicle drop constraint if exists tm_chronicle_kind_check;
alter table tm_chronicle add constraint tm_chronicle_kind_check check (kind in ('moment','memory','steward','cleanup','hug'));
