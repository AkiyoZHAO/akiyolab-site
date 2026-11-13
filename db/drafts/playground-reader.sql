-- 草案，尚未部署。安全云端存储确认后才可创建专用账号并登记授权。
-- 在同一管理员连接先设置 lab_play.playground_owner_id 为已核实的 Aki Auth UUID。
-- 本迁移仅支持现有单 Owner 数据的归属回填，多 Owner 数据须先逐行确认归属。
begin;

do $$
declare
  target_owner uuid := nullif(current_setting('lab_play.playground_owner_id', true), '')::uuid;
begin
  if target_owner is null or
     (select count(*) from auth.users where raw_app_meta_data ->> 'role' = 'owner') <> 1 or
     not exists (select 1 from auth.users where id = target_owner and raw_app_meta_data ->> 'role' = 'owner') then
    raise exception 'Verified single Owner identity required before assigning legacy row ownership';
  end if;
end;
$$;

-- 既有 upsert 不传此列，新行从调用者身份取得归属。旧行只回填允许的 Playground 键。
alter table public.panel_private
  add column owner_id uuid references auth.users(id) default auth.uid();

update public.panel_private
set owner_id = current_setting('lab_play.playground_owner_id')::uuid
where owner_id is null and (
  panel = 'playground:preferences:v1' or starts_with(panel, 'playground:feedback:v1:')
);

create schema if not exists private;
create table private.playground_reader_grants (
  reader_id uuid primary key references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (reader_id <> owner_id)
);
revoke all on private.playground_reader_grants from public, anon, authenticated;

-- 固定查询范围，Owner 从管理员登记表取得，调用者不能传入 owner 或 SQL 过滤条件。
create function public.read_playground_private_v1(p_after text default '', p_limit integer default 200)
returns table(panel text, content jsonb, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_owner uuid;
begin
  if auth.uid() is null or
     coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'playground_reader' or
     not exists (
       select 1 from auth.users u where u.id = auth.uid()
       and u.raw_app_meta_data ->> 'role' = 'playground_reader'
     ) then
    raise exception 'Reader authorization required' using errcode = '42501';
  end if;

  select g.owner_id into target_owner
  from private.playground_reader_grants g
  where g.reader_id = auth.uid() and g.revoked_at is null;
  if target_owner is null then
    raise exception 'Reader authorization required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 or
     p_after is null or length(p_after) > 200 then
    raise exception 'Invalid pagination' using errcode = '22023';
  end if;

  return query
  select p.panel, p.content, p.updated_at
  from public.panel_private p
  where p.owner_id = target_owner and p.panel > p_after and (
    p.panel = 'playground:preferences:v1' or starts_with(p.panel, 'playground:feedback:v1:')
  )
  order by p.panel
  limit p_limit;
end;
$$;

revoke all on function public.read_playground_private_v1(text, integer) from public, anon, authenticated;
grant execute on function public.read_playground_private_v1(text, integer) to authenticated;

-- 初始授权表为空。授权和撤销由管理员在安全接入确认后单独执行。
commit;
