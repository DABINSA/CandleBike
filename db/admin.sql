-- ============================================================
--  CandleRider 어드민 통계 — Supabase SQL 에디터에서 1회 실행.
--  선행: scores(=완주기록), courses, app_kv(db/security.sql) 가 이미 있어야 함.
--        toss_users(db/toss-users.sql)는 없어도 동작(있으면 가입 지표 집계).
--
--  구성: (1) visits 테이블 — 방문 비콘(/api/hit) 집계용 (일자×방문자 1행)
--        (2) record_visit() — 비콘이 호출(서버 service_role 전용, RLS 우회)
--        (3) admin_stats() — 어드민 대시보드 한 번 왕복용 집계 JSON
--
--  모든 '일자'는 한국시간(Asia/Seoul) 기준으로 버킷팅한다('오늘'=KST 자정 경계).
-- ============================================================

-- ── (1) 방문 집계 테이블 ─────────────────────────────────────
-- 일자(KST)×방문자ID 당 1행. 신규 행 수 = 그날 '고유 방문자', views 합 = 방문(로드) 수.
create table if not exists visits (
  day        date    not null,
  visitor_id text    not null,                 -- 클라가 localStorage 에 보관하는 익명 UUID (PII 아님)
  views      int     not null default 0,
  is_toss    boolean not null default false,   -- 토스 인앱에서의 방문이면 true
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  primary key (day, visitor_id)
);
create index if not exists visits_day_idx on visits (day);

-- RLS on + 정책 0개 → anon 완전 차단. record_visit(서버 라우트, service_role)만 기록.
alter table visits enable row level security;

-- ── (2) 방문 기록 RPC ───────────────────────────────────────
-- /api/hit 가 service_role 로 호출. 같은 방문자가 같은 날 또 오면 views 만 증가(고유수 불변).
-- 반환값 = '전체 기간 통틀어 처음 보는 방문자(신규 유저)' 여부 → /api/hit 가 신규면 텔레그램 알림.
-- 🔴 반환 타입 변경(void→boolean) 때문에 create-or-replace 가 안 되므로 먼저 drop.
drop function if exists record_visit(text, boolean);
create or replace function record_visit(p_visitor text, p_toss boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_new boolean := false;
begin
  if p_visitor is null or length(p_visitor) = 0 or length(p_visitor) > 64 then
    return false;   -- 형식 이상치는 조용히 무시
  end if;
  -- insert 전에 판정: 이 visitor_id 가 과거 어느 날에도 없었으면 신규 유저.
  v_new := not exists (select 1 from visits where visitor_id = p_visitor);
  insert into visits(day, visitor_id, views, is_toss, first_at, last_at)
    values (v_day, p_visitor, 1, coalesce(p_toss, false), now(), now())
  on conflict (day, visitor_id) do update
    set views   = visits.views + 1,
        is_toss = visits.is_toss or coalesce(p_toss, false),
        last_at = now();
  return v_new;
end $$;

revoke all on function record_visit(text, boolean) from public, anon, authenticated;

-- ── 종목명 헬퍼 ─────────────────────────────────────────────
-- scores 엔 코드만 있어 표시용 한글명이 없다. rank_events(1위 달성 기록)에 남은
-- 최근 이름을 종목명으로 사용(없으면 NULL → 어드민은 코드만 표시). rank_events 없으면 NULL.
create or replace function sym_name(p_symbol text)
returns text
language sql
stable
set search_path = public
as $$
  select case when to_regclass('public.rank_events') is null then null else (
    select re.name from rank_events re
    where re.symbol = p_symbol and re.name is not null
    order by re.created_at desc limit 1
  ) end
$$;

-- ── (3) 어드민 통계 RPC ─────────────────────────────────────
-- /api/admin/stats 가 토큰 검증 후 service_role 로 호출. 모든 지표를 jsonb 하나로 반환.
-- toss_users/courses 는 없을 수도 있어 to_regclass 로 존재할 때만 집계(토스 출시 전 안전).
create or replace function admin_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today   date   := (now() at time zone 'Asia/Seoul')::date;
  v_toss    jsonb  := jsonb_build_object('total', 0, 'new_today', 0, 'new_7d', 0, 'recent', '[]'::jsonb);
  v_courses bigint := 0;
  -- 출시 전 활성화용 시드(가짜) 닉네임(scripts/cap/seed-leaderboard.mjs). 어드민 지표에선 제외.
  -- (순위판/DB엔 그대로 둔다 — 어드민 숫자만 실유저 기준으로 보기 위함)
  v_seed text[] := array[
    '질주본능','차트마스터','백플립장인','풀악셀','라이더킹','칼바람','도파민러',
    '한방질주','야수의심장','변동성헌터','슈퍼바이크','칼치기','초보라이더','느긋한주행'];
begin
  -- 토스 로그인 계정(= 우리 서비스의 '가입 유저') — 테이블이 있을 때만
  if to_regclass('public.toss_users') is not null then
    select jsonb_build_object(
      'total',     coalesce((select count(*) from toss_users), 0),
      'new_today', coalesce((select count(*) from toss_users where (created_at at time zone 'Asia/Seoul')::date = v_today), 0),
      'new_7d',    coalesce((select count(*) from toss_users where created_at > now() - interval '7 days'), 0),
      'recent', (
        select coalesce(jsonb_agg(t), '[]'::jsonb) from (
          select nick, created_at from toss_users order by created_at desc limit 30
        ) t
      )
    ) into v_toss;
  end if;

  if to_regclass('public.courses') is not null then
    select count(*) into v_courses from courses;
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'today', v_today,

    -- 방문자(비콘 기반)
    'visitors', jsonb_build_object(
      'today',       coalesce((select count(*) from visits where day = v_today), 0),
      'today_views', coalesce((select sum(views) from visits where day = v_today), 0),
      'today_toss',  coalesce((select count(*) from visits where day = v_today and is_toss), 0),
      'last7',       coalesce((select count(distinct visitor_id) from visits where day > v_today - 7), 0),
      'last30',      coalesce((select count(distinct visitor_id) from visits where day > v_today - 30), 0),
      'daily', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'day', gd::text, 'visitors', vis, 'views', vw, 'toss', ts)), '[]'::jsonb)
        from (
          select g.d::date gd,
                 coalesce(v.cnt, 0)   vis,
                 coalesce(v.views, 0) vw,
                 coalesce(v.toss, 0)  ts
          from generate_series(v_today - 13, v_today, interval '1 day') g(d)
          left join (
            select day, count(*) cnt, sum(views) views,
                   count(*) filter (where is_toss) toss
            from visits where day > v_today - 14 group by day
          ) v on v.day = g.d::date
          order by g.d
        ) s
      )
    ),

    -- 플레이(완주 = scores 1행) — 시드 닉 제외(실유저 기준)
    'plays', jsonb_build_object(
      'today',         coalesce((select count(*) from scores where nick <> all(v_seed) and (created_at at time zone 'Asia/Seoul')::date = v_today), 0),
      'last7',         coalesce((select count(*) from scores where nick <> all(v_seed) and created_at > now() - interval '7 days'), 0),
      'total',         coalesce((select count(*) from scores where nick <> all(v_seed)), 0),
      'players_today', coalesce((select count(distinct nick) from scores where nick <> all(v_seed) and (created_at at time zone 'Asia/Seoul')::date = v_today), 0),
      'players_total', coalesce((select count(distinct nick) from scores where nick <> all(v_seed)), 0)
    ),

    -- 가장 많이 플레이(완주)된 종목 — 전체 / 오늘 (시드 제외)
    'top_symbols', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select symbol, count(*) plays, min(score) best_ms, sym_name(symbol) name
        from scores where nick <> all(v_seed) group by symbol order by count(*) desc, symbol limit 10
      ) t
    ),
    'top_symbols_today', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select symbol, count(*) plays, sym_name(symbol) name
        from scores where nick <> all(v_seed) and (created_at at time zone 'Asia/Seoul')::date = v_today
        group by symbol order by count(*) desc, symbol limit 10
      ) t
    ),

    'toss_users', v_toss,

    -- 최근 활동 (시드 제외)
    'recent_scores', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select nick, symbol, score, created_at, sym_name(symbol) name from scores where nick <> all(v_seed) order by created_at desc limit 25
      ) t
    ),

    'courses', v_courses
  );
end $$;

revoke all on function admin_stats() from public, anon, authenticated;
