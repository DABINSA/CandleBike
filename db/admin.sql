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
create or replace function record_visit(p_visitor text, p_toss boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_visitor is null or length(p_visitor) = 0 or length(p_visitor) > 64 then
    return;   -- 형식 이상치는 조용히 무시
  end if;
  insert into visits(day, visitor_id, views, is_toss, first_at, last_at)
    values (v_day, p_visitor, 1, coalesce(p_toss, false), now(), now())
  on conflict (day, visitor_id) do update
    set views   = visits.views + 1,
        is_toss = visits.is_toss or coalesce(p_toss, false),
        last_at = now();
end $$;

revoke all on function record_visit(text, boolean) from public, anon, authenticated;

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

    -- 플레이(완주 = scores 1행)
    'plays', jsonb_build_object(
      'today',         coalesce((select count(*) from scores where (created_at at time zone 'Asia/Seoul')::date = v_today), 0),
      'last7',         coalesce((select count(*) from scores where created_at > now() - interval '7 days'), 0),
      'total',         coalesce((select count(*) from scores), 0),
      'players_today', coalesce((select count(distinct nick) from scores where (created_at at time zone 'Asia/Seoul')::date = v_today), 0),
      'players_total', coalesce((select count(distinct nick) from scores), 0)
    ),

    -- 가장 많이 플레이(완주)된 종목 — 전체 / 오늘
    'top_symbols', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select symbol, count(*) plays, min(score) best_ms
        from scores group by symbol order by count(*) desc, symbol limit 10
      ) t
    ),
    'top_symbols_today', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select symbol, count(*) plays
        from scores where (created_at at time zone 'Asia/Seoul')::date = v_today
        group by symbol order by count(*) desc, symbol limit 10
      ) t
    ),

    'toss_users', v_toss,

    -- 최근 활동
    'recent_scores', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select nick, symbol, score, created_at from scores order by created_at desc limit 25
      ) t
    ),

    'courses', v_courses
  );
end $$;

revoke all on function admin_stats() from public, anon, authenticated;
