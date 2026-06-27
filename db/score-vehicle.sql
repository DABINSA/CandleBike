-- ============================================================
--  CandleRider 완주 기록에 '사용 장비' 저장 — Supabase SQL 에디터에서 1회 실행.
--  선행: db/security.sql, db/rank-events.sql (submit_score 5-arg 가 있어야 함).
--
--  추가: scores.vehicle(탈것 id) + scores.items(그 판에 발동한 소모품 id, 콤마구분).
--        순위표엔 탈것만 표시, 어드민엔 탈것+소모품 표시.
--  submit_score 를 6-arg(p_vehicle, p_items 추가)로 교체. 둘 다 default '' 라
--  /api/score 가 안 넘겨도(구버전) 정상 동작.
-- ============================================================

alter table scores add column if not exists vehicle text;
alter table scores add column if not exists items   text;

drop function if exists submit_score(text, text, int, text, text);
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
  v_window   int    := 600000;   -- 10분(ms)
  v_max      int    := 30;
  v_count    int;
  v_reset    bigint;
  v_id       bigint;
  v_total    int;
  v_better   int;
  v_prev_min int;
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

  select min(score) into v_prev_min from scores where symbol = p_symbol;

  insert into scores(nick, symbol, score, vehicle, items)
    values (p_nick, p_symbol, p_score, nullif(p_vehicle, ''), nullif(p_items, ''))
    returning id into v_id;
  select count(*) into v_total  from scores where symbol = p_symbol;
  select count(*) into v_better from scores where symbol = p_symbol and score < p_score;

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
