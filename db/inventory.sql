-- ============================================================
--  CandleRider 아이템 인벤토리 — 계정 귀속(클라우드 저장). Supabase SQL 1회 실행.
--  owner: 'toss:<user_key>' (토스) — 추후 'google:<uid>' 등 확장.
--  data : { owned:[skinId...], color, consum:{id:count}, equipped:[id...] }
--  쓰기/읽기는 서버 라우트(/api/inventory, service_role)만 — anon 직접 접근 차단.
-- ============================================================
create table if not exists inventory (
  owner      text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table inventory enable row level security;
-- 토스: /api/inventory 가 service_role 로 수행(RLS 우회) → owner='toss:<user_key>'.
-- 구글(Supabase Auth): 로그인 유저가 본인 행만 직접 읽기/쓰기 → owner='google:<auth.uid()>'.
--   anon 은 auth.uid() 가 null 이라 전부 거부. service_role 은 RLS 우회.
drop policy if exists "inv_sel_own" on inventory;
drop policy if exists "inv_ins_own" on inventory;
drop policy if exists "inv_upd_own" on inventory;
create policy "inv_sel_own" on inventory for select to authenticated
  using (owner = 'google:' || auth.uid()::text);
create policy "inv_ins_own" on inventory for insert to authenticated
  with check (owner = 'google:' || auth.uid()::text);
create policy "inv_upd_own" on inventory for update to authenticated
  using (owner = 'google:' || auth.uid()::text)
  with check (owner = 'google:' || auth.uid()::text);
