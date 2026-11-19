-- 词汇盒子的私有追加流水。请求 UUID 使网络重试不会重复计数。
begin;

create table if not exists public.vocabulary_appends (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  word text not null check (char_length(word) between 1 and 120 and btrim(word) <> ''),
  tag text check (tag is null or (char_length(tag) between 1 and 30 and btrim(tag) <> '')),
  created_at timestamptz not null default now()
);

alter table public.vocabulary_appends enable row level security;

revoke all on public.vocabulary_appends from public, anon, authenticated;
grant select on public.vocabulary_appends to authenticated;
grant insert (request_id, word, tag) on public.vocabulary_appends to authenticated;

drop policy if exists vocabulary_owner_read on public.vocabulary_appends;
create policy vocabulary_owner_read on public.vocabulary_appends
  for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

drop policy if exists vocabulary_owner_append on public.vocabulary_appends;
create policy vocabulary_owner_append on public.vocabulary_appends
  for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'owner');

commit;
