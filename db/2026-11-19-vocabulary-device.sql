-- 记录浏览器推断出的设备类型。旧客户端省略该字段时默认为 unknown。
begin;

alter table public.vocabulary_appends
  add column if not exists device_type text not null default 'unknown'
  check (device_type in ('desktop', 'mobile', 'tablet', 'unknown'));

grant insert (device_type) on public.vocabulary_appends to authenticated;

commit;
