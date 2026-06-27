-- ============================================================
--  CandleRider 주간 순위 — Supabase SQL 에디터에서 1회 실행.
--  선행: db/security.sql, db/rank-events.sql, db/score-vehicle.sql, db/top-holders.sql.
--
--  순위는 '이번 주(매주 월요일 04:00 KST 리셋)' 기록만으로 계산/표시한다.
--  기록은 삭제하지 않음(역대 1위·통계 보존). '리셋'=시간 윈도우로 이번 주만 집계.
--   (1) week_start()  — 가장 최근 '월요일 04:00 KST' 경계(timestamptz)
--   (2) submit_score  — 순위/1위판정을 이번 주 범위로
--   (3) top_holders   — 도전 문구용 '이번 주 종목별 1위'
-- ============================================================

-- ── (1) 이번 주 시작 경계 ────────────────────────────────────
-- KST 기준 가장 최근 월요일 04:00. (월 04:00 이전이면 직전 주 04:00)
create or replace function week_start()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select (date_trunc('week', (now() at time zone 'Asia/Seoul') - interval '4 hours') + interval '4 hours')
         at time zone 'Asia/Seoul'
$$;

-- ── (2) submit_score — 이번 주 범위로 순위/1위 판정 ──────────
drop function if exists submit_score(text, text, int, text, text, text, text);
create or replace function submit_score(
  p_nick text, p_symbol text, p_score int, p_ip text,
  p_name text default '', p_vehicle text default '', p_items text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key      text   := 'rl:score:' || coalesce(p_ip, 'unknown');
  v_now      bigint := (extract(epoch from now()) * 1000)::bigint;
  v_window   int    := 600000;
  v_max      int    := 30;
  v_count    int;
  v_reset    bigint;
  v_id       bigint;
  v_total    int;
  v_better   int;
  v_prev_min int;
  v_wk       timestamptz := week_start();   -- 이번 주 시작
begin
  -- 고정윈도우 레이트리밋
  select (v->>'count')::int, (v->>'resetAt')::bigint into v_count, v_reset
    from app_kv where k = v_key;
  if v_reset is null or v_reset <= v_now then
    v_count := 0; v_reset := v_now + v_window;
  end if;
  if v_count >= v_max then
    return jsonb_build_object('error', 'rate', 'retryAfter', greatest(1, ((v_reset - v_now) / 1000))::int);
  end if;
  insert into app_kv(k, v, updated_at)
    values (v_key, jsonb_build_object('count', v_count + 1, 'resetAt', v_reset), now())
    on conflict (k) do update set v = excluded.v, updated_at = now();

  -- 이번 주 직전 최고기록(1위 갱신 판정용)
  select min(score) into v_prev_min from scores where symbol = p_symbol and created_at >= v_wk;

  insert into scores(nick, symbol, score, vehicle, items)
    values (p_nick, p_symbol, p_score, nullif(p_vehicle, ''), nullif(p_items, ''))
    returning id into v_id;

  -- 순위/총원: 이번 주 범위만
  select count(*) into v_total  from scores where symbol = p_symbol and created_at >= v_wk;
  select count(*) into v_better from scores where symbol = p_symbol and created_at >= v_wk and score < p_score;

  -- 이번 주 1위 신기록이면 알림 띠 이벤트
  if v_better = 0 and v_prev_min is not null and p_score < v_prev_min then
    insert into rank_events(nick, symbol, name) values (p_nick, p_symbol, nullif(p_name, ''));
  end if;

  return jsonb_build_object(
    'id', v_id,
    'rank', v_better + 1,
    'total', v_total,
    'percentile', greatest(1, round(((v_better + 1)::numeric / greatest(v_total, 1)) * 100))
  );
end $$;
revoke all on function submit_score(text, text, int, text, text, text, text) from public, anon, authenticated;

-- ── (3) top_holders — 이번 주 종목별 1위(도전 문구용) ────────
create or replace function top_holders(p_limit int default 14)
returns table(symbol text, nick text, score int, plays bigint, name text)
language sql
stable
set search_path = public
as $$
  with wk as (select week_start() ws),
  champ as (
    select distinct on (s.symbol) s.symbol, s.nick, s.score
    from scores s, wk where s.created_at >= wk.ws
    order by s.symbol, s.score asc
  ),
  counts as (
    select s.symbol, count(*) as plays from scores s, wk where s.created_at >= wk.ws group by s.symbol
  )
  select c.symbol, c.nick, c.score, k.plays,
    (select re.name from rank_events re
       where re.symbol = c.symbol and re.name is not null
       order by re.created_at desc limit 1) as name
  from champ c join counts k using (symbol)
  order by k.plays desc, c.symbol
  limit greatest(1, least(p_limit, 50));
$$;
grant execute on function top_holders(int) to anon, authenticated;

-- 검증: select week_start();  select * from top_holders(14);
