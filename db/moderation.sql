-- ============================================================
--  CandleRider 닉네임 모더레이션 — Supabase SQL 에디터에서 1회 실행.
--
--  목적: 욕설·성적 문구 등 부적절한 닉네임을 차단한다.
--   (1) banned_words : 금지어 목록(어드민이 추가/삭제). 서버가 닉을 정규화 후 부분일치로 검사.
--   (2) nick_bans    : 필터를 빠져나간 특정 닉을 어드민이 직접 차단(Phase 2에서 강제변경/익명처리에 사용).
--
--  쓰기는 service_role 서버 라우트만(/api/nick-check·/api/admin/words 등). anon 직접 접근 차단.
-- ============================================================

-- ── (1) 금지어 목록 ─────────────────────────────────────────
create table if not exists banned_words (
  word       text primary key,          -- 소문자/정규화해 저장하는 게 이상적(서버가 정규화해 비교)
  created_at timestamptz default now()
);
alter table banned_words enable row level security;
-- 읽기는 공개(클라가 닉 저장 전 즉시 검사). 쓰기는 서버(service_role)만 — anon 추가/삭제 불가.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='banned_words' and cmd='SELECT') then
    create policy "bw_read" on banned_words for select using (true);
  end if;
end $$;

-- ── (2) 차단된 닉(슬립스루) — 강제변경/익명처리 ─────────────
create table if not exists nick_bans (
  nick       text primary key,
  reason     text,
  created_at timestamptz default now()
);
alter table nick_bans enable row level security;
-- 읽기 공개(클라가 '내 닉이 차단됐는지' 확인해 강제 변경). 쓰기는 서버만.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='nick_bans' and cmd='SELECT') then
    create policy "bn_read" on nick_bans for select using (true);
  end if;
end $$;

-- ── 닉 차단 RPC(어드민 전용) — 차단등록 + 기존 기록을 '랜덤 더미닉'으로 일괄 덮어쓰기 ──
-- /api/admin/stats 가 service_role 로 호출. (원본 닉은 사라짐 — 어차피 부적절)
-- '익명의라이더' 대신 시드 스타일 랜덤닉(차단 유저당 1개)으로 대체해 순위판에 자연스럽게.
create or replace function ban_nick(p_nick text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a text[] := array['질주','칼바람','풀악셀','변동성','캔들','폭주','야수','슈퍼','한방','도파민','로켓','칼치기','백플립','차트','불꽃','번개','강철','돌격','질풍','폭락장'];
  b text[] := array['라이더','킹','마스터','장인','헌터','바이크','러','보스','전설','괴물','스피드','윙','질주','본능','대장'];
  v_anon text;
begin
  if p_nick is null or length(trim(p_nick)) = 0 then return; end if;
  v_anon := a[floor(random() * array_length(a, 1)) + 1] || b[floor(random() * array_length(b, 1)) + 1];
  insert into nick_bans(nick) values (p_nick) on conflict (nick) do nothing;
  update scores set nick = v_anon where nick = p_nick;
  if to_regclass('public.rank_events') is not null then
    update rank_events set nick = v_anon where nick = p_nick;
  end if;
  if to_regclass('public.toss_users') is not null then
    update toss_users set nick = v_anon where nick = p_nick;
  end if;
end $$;
revoke all on function ban_nick(text) from public, anon, authenticated;

-- ── 초기 금지어 시드(기본값 — 어드민에서 추가/삭제 가능) ─────
-- 부분일치 기준이라 핵심 어근 위주. 오탐이 보이면 어드민에서 삭제.
insert into banned_words(word) values
  ('시발'),('씨발'),('시1발'),('씨1발'),('ㅅㅂ'),('ㅄ'),('병신'),('븅신'),('ㅂㅅ'),
  ('개새'),('새끼'),('썅'),('좆'),('좇'),('존나'),('존1나'),('지랄'),('니미'),('느금'),
  ('보지'),('자지'),('섹스'),('야동'),('폰섹'),('창녀'),('걸레'),('노콘'),('강간'),('성기'),
  ('fuck'),('fuk'),('shit'),('bitch'),('asshole'),('dick'),('pussy'),('cunt'),('cock'),
  ('sex'),('porn'),('nigger'),('nigga'),('faggot'),('rape'),('whore'),('slut')
on conflict (word) do nothing;

-- 검증: select count(*) from banned_words;
