-- ============================================================
--  CandleBike — 토스 인앱 라이트 로그인용 닉네임 저장
--  Supabase SQL 에디터에서 1회 실행.
--
--  목적: 토스 로그인으로 받은 안정적 사용자 식별자(user_key)에 닉네임을 묶어
--        '계정 기본 닉네임'으로 저장 → 재설치/다른 기기에서도 순위에 같은 닉 자동 사용.
--        PII(이름/휴대폰)는 저장하지 않는다(라이트 로그인 — user_key만).
--
--  쓰기는 service_role 서버 라우트(/api/auth/toss, /api/toss-nick)로만.
--  anon 키는 클라 번들에 노출되므로 직접 쓰기를 절대 열지 않는다(닉 위조 방지).
-- ============================================================

create table if not exists toss_users (
  user_key   text primary key,            -- 토스 user_key (복호화 불필요한 안정 식별자)
  nick       text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS on + 정책 0개 → anon 완전 차단. service_role(서버 라우트)만 읽기/쓰기.
alter table toss_users enable row level security;
drop policy if exists "tu_read"   on toss_users;
drop policy if exists "tu_insert" on toss_users;
drop policy if exists "tu_update" on toss_users;
-- (정책을 만들지 않는다 — 서버 라우트는 service_role 로 RLS 우회)
