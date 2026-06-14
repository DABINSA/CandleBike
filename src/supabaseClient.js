// 공용 Supabase 클라이언트 — 리더보드/코스캐시가 함께 사용 (인스턴스 1개)
import { CONFIG } from './config.js';

let client = null;

export function isConfigured() {
  return !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
}

export async function getClient() {
  if (!isConfigured()) return null;
  if (client) return client;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return client;
}
