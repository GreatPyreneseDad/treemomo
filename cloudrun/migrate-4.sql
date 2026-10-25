create table if not exists tm_users (id uuid primary key default gen_random_uuid(), google_sub text not null unique, email text, name text, picture text,
  primary_player text not null unique, created_at timestamptz not null default now(), last_seen timestamptz not null default now());
create table if not exists tm_links (player text primary key, user_id uuid not null references tm_users(id) on delete cascade, linked_at timestamptz not null default now());
