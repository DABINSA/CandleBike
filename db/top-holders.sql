-- ============================================================
--  CandleRider 종목별 현재 1위(챔피언) 목록 — Supabase SQL 에디터에서 1회 실행.
--  선행: scores(=완주기록), rank_events(db/rank-events.sql, 이름 표시용·선택).
--
--  목적: 화면 상단 '1위 알림 띠'가 비어 밋밋할 때, "지금 △△ 1위는 OO님 — 도전!" 같은
--        도전 문구를 돌려 보여주기 위한 데이터. (실시간 1위 달성이 없을 때의 idle 콘텐츠)
--
--  읽기 전용·공개 데이터(순위판과 동일) — security invoker(호출자 권한)로 동작하며
--  scores/rank_events 모두 anon SELECT 공개라 anon 이 그대로 호출 가능.
-- ============================================================

create or replace function top_holders(p_limit int default 14)
returns table(symbol text, nick text, score int, plays bigint, name text)
language sql
stable
set search_path = public
as $$
  with champ as (
    -- 종목별 최고기록(=완주시간 최소) 보유자 1명
    select distinct on (symbol) symbol, nick, score
    from scores
    order by symbol, score asc
  ),
  counts as (
    select symbol, count(*) as plays from scores group by symbol
  )
  select
    c.symbol,
    c.nick,
    c.score,
    k.plays,
    -- 표시용 종목명(한글 등) — rank_events 에 기록된 최근 이름이 있으면 사용, 없으면 NULL(클라가 코드 표시)
    (select re.name from rank_events re
       where re.symbol = c.symbol and re.name is not null
       order by re.created_at desc limit 1) as name
  from champ c
  join counts k using (symbol)
  order by k.plays desc, c.symbol         -- 많이 플레이된(인기) 종목 우선
  limit greatest(1, least(p_limit, 50));
$$;

-- 공개 읽기 RPC — anon/authenticated 호출 허용(데이터가 이미 공개라 안전).
grant execute on function top_holders(int) to anon, authenticated;

-- ============================================================
--  검증: select * from top_holders(14);
--    → 종목별 1위 보유자와 플레이수, (있으면) 한글명이 인기순으로 나와야 함.
-- ============================================================
