create extension if not exists vector;
create extension if not exists citext;

-- One sequence for every synced table: a client's pull cursor is "the last rev I have seen".
create sequence rev_seq;

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  quota_bytes bigint not null default 15000000000,
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash bytea primary key,
  user_id uuid not null references users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sessions (user_id);

-- Times that come from clients are kept as epoch milliseconds, exactly as the app stores them.
create table photos (
  id uuid primary key,
  user_id uuid not null references users on delete cascade,
  hash text not null,
  phash text not null,
  name text not null,
  type text not null,
  size bigint not null,
  width int not null,
  height int not null,
  taken_at bigint not null,
  imported_at bigint not null,
  camera text,
  lat double precision,
  lon double precision,
  favorite boolean not null default false,
  trashed_at bigint,
  tags text[] not null default '{}',
  album_ids uuid[] not null default '{}',
  suggested_tags text[] not null default '{}',
  edits jsonb,
  version int not null default 1,
  updated_at bigint not null,
  deleted boolean not null default false,
  has_original boolean not null default false,
  thumb_version int not null default 0,
  rev bigint not null default nextval('rev_seq')
);
create index photos_user_rev on photos (user_id, rev);
-- The same file imported on two devices becomes one photo.
create unique index photos_user_hash on photos (user_id, hash) where not deleted;

create table albums (
  id uuid primary key,
  user_id uuid not null references users on delete cascade,
  name text not null,
  cover_id uuid,
  created_at bigint not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  rev bigint not null default nextval('rev_seq')
);
create index albums_user_rev on albums (user_id, rev);

-- CLIP vectors computed on a device, shared so other devices don't analyse the photo again.
create table embeddings (
  photo_id uuid primary key references photos on delete cascade,
  user_id uuid not null references users on delete cascade,
  vector vector(512) not null,
  mean real not null,
  std real not null,
  rev bigint not null default nextval('rev_seq')
);
create index embeddings_user_rev on embeddings (user_id, rev);
