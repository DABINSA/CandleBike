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
-- 정책 0개 → anon 완전 차단. /api/inventory 가 service_role 로 수행(토스 토큰 검증 후).
