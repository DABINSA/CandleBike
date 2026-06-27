-- ============================================================
--  CandleRider 1위 달성 알림(브로드캐스트) — Supabase SQL 에디터에서 1회 실행.
--  선행: scores, app_kv, submit_score(db/security.sql) 가 이미 있어야 함.
--
--  목적: 누군가 어떤 종목에서 '전체 1위'를 새로 갱신하면 그 사실을 rank_events 에 적고,
--        Supabase Realtime 으로 모든 접속 클라이언트에 즉시 브로드캐스트한다.
--        클라이언트는 이 이벤트를 화면 상단의 '오른→왼 흐르는 띠'로 보여준다.
--
--  스팸 방지: '진짜 신기록으로 1위를 빼앗은 경우'에만 기록한다.
--             (= 이번 기록이 1위(v_better=0) AND 직전 최고기록보다 빠름)
--             → 같은 사람이 1위 유지하며 더 느리게 또 달리면 기록 안 됨.
--             → 그 종목 첫 완주(비교 대상 없음)도 기록 안 됨(시시한 1위 제외).
-- ============================================================

-- ── (1) 1위 달성 이벤트 테이블 ──────────────────────────────
create table if not exists rank_events (
  id         bigint generated always as identity primary key,
  nick       text        not null,
  symbol     text        not null,
  name       text,                                  -- 표시용 종목명(한글 등). 없으면 클라가 symbol 표시.
  created_at timestamptz not null default now()
);
create index if not exists rank_events_created_idx on rank_events (created_at desc);

-- 읽기는 공개(띠에 표시), 쓰기 정책은 0개 → submit_score(security definer)만 기록.
alter table rank_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='rank_events' and cmd='SELECT') then
    create policy "re_read" on rank_events for select using (true);
  end if;
end $$;

-- Realtime 발행 목록에 추가(이미 있으면 무시). 이게 있어야 클라가 INSERT 를 실시간 수신.
do $$ begin
  begin
    alter publication supabase_realtime add table rank_events;
  exception when duplicate_object then null;   -- 이미 추가됨
  end;
end $$;

-- ── (2) submit_score 갱신 — 1위 신기록이면 rank_events 에 기록 ──
-- 기존 시그니처(4-arg)를 drop 하고 p_name(표시용 종목명) 을 받는 5-arg 로 교체.
-- p_name 은 default '' 라, /api/score 가 아직 p_name 을 안 넘겨도(구버전) 정상 동작한다.
drop function if exists submit_score(text, text, int, text);
create or replace function submit_score(
  p_nick text, p_symbol text, p_score int, p_ip text, p_name text default ''
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
  v_max      int    := 30;       -- 윈도우당 최대 등록 횟수
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

  -- 직전 최고기록(이번 등록 전) — 1위 갱신 판정용
  select min(score) into v_prev_min from scores where symbol = p_symbol;

  -- 완주 시간 등록 + 같은 종목 내 순위 (시간이 작을수록 = 빠를수록 상위)
  insert into scores(nick, symbol, score) values (p_nick, p_symbol, p_score) returning id into v_id;
  select count(*) into v_total  from scores where symbol = p_symbol;
  select count(*) into v_better from scores where symbol = p_symbol and score < p_score;

  -- 1위 신기록(직전 최고보다 빠름)일 때만 브로드캐스트용 이벤트 기록.
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

-- anon/공개 호출 차단 — service_role(서버 라우트)만 실행 가능
revoke all on function submit_score(text, text, int, text, text) from public, anon, authenticated;

-- ============================================================
--  검증
--  (a) anon 으로 select → 정상(읽기 공개):
--      select * from rank_events order by created_at desc limit 5;
--  (b) 같은 종목에 더 빠른 기록을 2번째로 넣으면 rank_events 1행 생겨야 함.
--  (c) Realtime: Dashboard > Database > Replication 에서 rank_events 가
--      supabase_realtime 발행에 포함됐는지 확인.
-- ============================================================
