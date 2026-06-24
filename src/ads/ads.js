// 광고 — 3가지 모드 (config.AD_MODE)
//   house  : "여기에 광고하세요" 자체 안내(이메일 문의 유도). 자리 선점 + 광고주 유치용.
//   adsense: 실제 Google AdSense (승인 후). index.html <head> 스크립트 주석 해제 필요.
//   off    : 광고/리워드 게이트 모두 끔.
//
// 광고 위치(4곳): 홈 배너 · 플레이 하단 배너 · 결과 보기 전 5초 전면 · 결과 화면 배너.

import { CONFIG } from '../config.js';
import { t } from '../i18n.js';
import { IS_TOSS, effectiveAdMode } from '../toss.js';
import { attachTossBanner } from '../tossAds.js';

// 토스 인앱에서는 외부광고(AdSense/하우스) 금지 → 'off' 로 강제. 그 외엔 CONFIG.AD_MODE 그대로.
// 단, 토스에선 토스 인앱 배너 광고(TossAds)를 슬롯에 붙인다(플레이 하단 · 결과 화면).
const AD_MODE = effectiveAdMode(CONFIG.AD_MODE);

// 하우스 광고 마크업 (variant: 'banner' | 'reward' | 'result')
export function houseAdMarkup(variant = 'banner') {
  const email = CONFIG.AD_CONTACT_EMAIL || '';
  const title = variant === 'reward' ? t.houseTitleReward
    : variant === 'result' ? t.houseTitleResult : t.houseTitle;
  const sub = variant === 'reward' ? t.houseSubReward
    : variant === 'result' ? t.houseSubResult : t.houseSub;
  const mailto = `mailto:${email}?subject=${encodeURIComponent(t.mailSubject)}`;
  return (
    `<div class="house-ad house-${variant}">` +
    `<span class="house-tag">${t.adSpace}</span>` +
    `<div class="house-title">${title}</div>` +
    `<div class="house-sub">${sub}</div>` +
    `<a class="house-cta" href="${mailto}">${t.houseCta(email)}</a>` +
    `</div>`
  );
}

export function renderHouseAd(el, variant) {
  if (!el) return;
  if (IS_TOSS) {                                  // 토스: 결과 화면만 토스 배너, 홈 등은 숨김
    if (variant === 'result') attachTossBanner(el);
    else el.style.display = 'none';
    return;
  }
  if (AD_MODE === 'off') { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = houseAdMarkup(variant);
}

// 플레이 중 하단 배너
export function initPlayBanner() {
  const banner = document.getElementById('ad-banner');
  if (!banner) return;
  if (IS_TOSS) { banner.style.display = 'flex'; attachTossBanner(banner); return; }  // 토스 배너
  if (AD_MODE === 'off') { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';

  if (AD_MODE === 'adsense' && window.adsbygoogle) {
    const ins = banner.querySelector('ins.adsbygoogle');
    const ph = banner.querySelector('.ad-placeholder');
    if (ins) {
      ins.style.display = 'inline-block';
      if (ph) ph.style.display = 'none';
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { console.warn(e); }
    }
    return;
  }
  // house
  banner.innerHTML = houseAdMarkup('banner');
}

// 결과 보기 전 5초 강제(리워드형) — 하우스 광고를 보여주고 5초 후 결과 해제
export function showRewardedAd() {
  return new Promise((resolve) => {
    const screen = document.getElementById('screen-ad');
    const timerEl = document.getElementById('ad-timer');
    const btn = document.getElementById('btn-skip-ad');
    const video = screen.querySelector('.ad-reward-video');

    if (video && AD_MODE !== 'adsense') {
      video.innerHTML = `<span class="ad-tag">AD</span>` + houseAdMarkup('reward');
    }

    let remain = CONFIG.REWARD_AD_SECONDS;
    timerEl.textContent = remain;
    btn.disabled = true;
    btn.textContent = t.seeResultsLocked;

    const iv = setInterval(() => {
      remain -= 1;
      timerEl.textContent = Math.max(0, remain);
      if (remain <= 0) {
        clearInterval(iv);
        btn.disabled = false;
        btn.textContent = t.seeResultsUnlocked;
      }
    }, 1000);

    btn.onclick = () => {
      if (btn.disabled) return;
      btn.onclick = null;
      resolve(true);
    };
  });
}
