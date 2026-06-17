-- ============================================================
--  CandleBike 보안 잠금 — Supabase SQL 에디터에서 실행
--  목적: anon(공개) 키로의 직접 쓰기를 차단하고, 모든 쓰기를
--        서버 라우트(/api/score, /api/save-course, service_role)로만 허용.
--  anon 키는 클라 번들에 노출되므로 직접 쓰기를 열면 점수 위조/캐시 오염/스팸이 가능.
--  service_role 은 RLS 를 우회하므로, 쓰기 정책을 0개로 만들어도 서버 라우트는 정상 동작.
-- ============================================================

-- 1) scores: anon 은 읽기만. (insert 는 /api/score 가 service_role 로 수행)
alter table scores enable row level security;
drop policy if exists "s_insert" on scores;
drop policy if exists "insert"   on scores;          -- 구버전 정책명 호환
-- 읽기 정책은 유지 (없으면 생성)
do $$ begin
  if not exists (select 1 from pg_policies where tablename='scores' and cmd='SELECT') then
    create policy "s_read" on scores for select using (true);
  end if;
end $$;

-- 2) courses: anon 은 읽기만. (insert/update 는 /api/save-course 가 수행)
alter table courses enable row level security;
drop policy if exists "c_insert" on courses;
drop policy if exists "c_update" on courses;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='courses' and cmd='SELECT') then
    create policy "c_read" on courses for select using (true);
  end if;
end $$;

-- 3) app_kv: 서버리스 레이트리밋용 KV. RLS on + 정책 0개 → anon 완전 차단,
--    service_role 만 접근(RLS 우회). 세션/시크릿을 여기 두지 말 것.
create table if not exists app_kv (
  k text primary key,
  v jsonb,
  updated_at timestamptz default now()
);
alter table app_kv enable row level security;
-- 정책을 만들지 않음(의도) → anon 읽기/쓰기 모두 거부.

-- 4) (선택) 오래된 레이트리밋 행 정리 — 주기적으로 실행하거나 cron 으로.
-- delete from app_kv where k like 'rl:%' and updated_at < now() - interval '1 day';

-- ============================================================
--  검증
--  (a) anon 키로 insert 시도 → 401/403/0행 이어야 함:
--      curl -X POST "$URL/rest/v1/scores" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--           -H "Content-Type: application/json" -d '{"nick":"x","symbol":"X","score":1}'
--  (b) anon 키로 select → 정상(200, 데이터) 이어야 함(읽기는 공개 유지).
--  (c) 테스트로 오염된 행 삭제(대시보드 또는 SQL):
--      delete from scores where nick='__sectest__';
-- ============================================================
