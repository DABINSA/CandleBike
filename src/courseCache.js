// 코스 캐싱 — 같은 종목/같은 기간(주 또는 월)이면 DB에 저장된 코스를 즉시 로드.
// 최초 1명이 플레이할 때만 실데이터를 받아 Supabase `courses` 테이블 + 로컬에 저장.
//
// Supabase SQL:
//   create table courses (
//     symbol text primary key,
//     period text,
//     series jsonb,
//     updated_at timestamptz default now()
//   );
//   alter table courses enable row level security;
//   create policy "c_read"   on courses for select using (true);
//   create policy "c_insert" on courses for insert with check (true);
//   create policy "c_update" on courses for update using (true);

import { CONFIG } from './config.js';
import { getClient } from './supabaseClient.js';
import { getHistory } from './stock/provider.js';
import { generateMockHistory } from './stock/mockData.js';

// 'real-cache' | 'real-fetch' | 'demo' — 마지막 코스의 출처
let lastSource = 'real-cache';
export function getLastCourseSource() { return lastSource; }

// 현재 기간 버킷 키 (주/월)
export function currentPeriod() {
  const d = new Date();
  if ((CONFIG.COURSE_UPDATE || 'week') === 'month') return d.toISOString().slice(0, 7); // YYYY-MM
  // ISO 주차
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const LS = 'candlebike_courses';
function lsGet() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }
function lsSet(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch {} }

export async function getCourse(symbol) {
  const period = currentPeriod();

  // 1) 로컬 캐시 (이 기기에서 이미 받은 적 있음)
  const local = lsGet();
  if (local[symbol] && local[symbol].period === period && local[symbol].series) {
    lastSource = 'real-cache';
    return local[symbol].series;
  }

  // 2) Supabase 공유 캐시 (다른 사람이 이미 받아둠)
  const client = await getClient();
  if (client) {
    try {
      const { data } = await client.from('courses').select('series,period').eq('symbol', symbol).maybeSingle();
      if (data && data.period === period && data.series && data.series.length) {
        local[symbol] = { period, series: data.series };
        lsSet(local);
        lastSource = 'real-cache';
        return data.series;
      }
    } catch (e) { console.warn('courses 조회 실패', e); }
  }

  // 3) 최초 1회: 실데이터 fetch → 저장
  if (CONFIG.STOCK_PROVIDER !== 'mock') {
    try {
      const series = await getHistory(symbol);
      local[symbol] = { period, series };
      lsSet(local);
      if (client) {
        try {
          await client.from('courses').upsert({ symbol, period, series, updated_at: new Date().toISOString() });
        } catch (e) { console.warn('courses 저장 실패', e); }
      }
      lastSource = 'real-fetch';
      return series;
    } catch (e) {
      // 실데이터 실패(프록시 차단 등) → 데모로 진행하되 캐시에는 저장하지 않음
      console.warn('실데이터 실패, 데모 코스로 진행', e);
      lastSource = 'demo';
      return generateMockHistory(symbol, CONFIG.HISTORY_YEARS);
    }
  }

  // mock 모드
  lastSource = 'demo';
  return generateMockHistory(symbol, CONFIG.HISTORY_YEARS);
}
