// CandleRider 미니앱 공용 웹뷰 셸 — candlebike.vercel.app 을 WebView로 로딩.
// 토스 환경 마커 주입 + 뒤로가기 처리 + UA 마커 + 네이티브 브리지(appLogin).
// ⚠️ @granite-js/native/react-native-webview 의 WebView 사용(토스 호스트 링크 모듈).
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useBackHandler, IOScrollView } from '@granite-js/react-native';
import { WebView } from '@granite-js/native/react-native-webview';
import { appLogin, loadFullScreenAd, showFullScreenAd, contactsViral, Analytics, InlineAd } from '@apps-in-toss/framework';

const SITE = 'https://candlerider.2nt4soft.com';

// 페이지 로드 전 주입: 사이트가 토스 인앱 환경을 감지(src/toss.js)해
// 외부광고(AdSense/하우스 자리)를 끄고 결과 게이트를 건너뛰도록 마커 설정.
//  __APPS_IN_TOSS_REWARD__    : 리워드 광고 브리지 지원(새 .ait)
//  __APPS_IN_TOSS_SHARE__     : 공유 리워드(contactsViral) 브리지 지원(새 .ait)
//  __APPS_IN_TOSS_EVENT__     : 핵심지표 커스텀 이벤트(logEvent) 브리지 지원(새 .ait)
//  __APPS_IN_TOSS_BANNER_AD__ : 네이티브 배너(InlineAd) 오버레이 지원(새 .ait)
const INJECT_BEFORE = `
  window.__APPS_IN_TOSS__ = true;
  window.__APPS_IN_TOSS_REWARD__ = true;
  window.__APPS_IN_TOSS_SHARE__ = true;
  window.__APPS_IN_TOSS_EVENT__ = true;
  window.__APPS_IN_TOSS_BANNER_AD__ = true;
  true;
`;

// 핵심지표(분석) 커스텀 이벤트 — 1회 발사용 큐 아이템.
// RN framework엔 명령형 log API가 없어, Analytics.Impression(impression="on-mount")을
// 잠깐 렌더해 1회 발사한다(플레이북 검증 경로). 발사 후 타이머로 큐에서 제거.
type LogItem = { id: string; name: string; params?: Record<string, unknown> };

// 웹→셸 메시지 프로토콜: { type, requestId, params }
// 셸→웹 회신: window.__onTossBridgeMessage(JSON{ requestId, ok, data?, error? })
type BridgeRequest = { type?: string; requestId?: string; params?: Record<string, unknown> };

// 배너 광고 오버레이 — web-framework 배너는 셸 WebView 안에서 동작 안 해(esm.sh 차단),
// 웹이 placeholder 좌표를 통지하면 셸이 그 위에 네이티브 InlineAd 를 얹는다(모두의웨딩 방식).
type AdSlot = { slotId: string; adGroupId: string; top: number; left: number; width: number; height: number; inViewport: boolean };
type AdOverlay = { scrolling: boolean; slots: AdSlot[] };

// InlineAd 렌더 실패가 앱 전체를 죽이지 않게 격리 — 실패 시 아무것도 안 그림.
class AdErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error('[InlineAd] render error (swallowed):', err); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function WebShell({ path }: { path: string }) {
  const ref = useRef<WebView>(null);
  // 웹뷰 히스토리 뒤로가기 가능 여부(최신값을 ref로 보관 → 핸들러 재등록 불필요)
  const canGoBackRef = useRef(false);
  // 핵심지표 이벤트 발사 큐(웹→브리지 logEvent → 짧게 렌더 → on-mount 발사 → 제거)
  const [logQueue, setLogQueue] = useState<LogItem[]>([]);
  const logSeq = useRef(0);
  // 배너 광고 오버레이(좌표형) — '결과 보기 전' 큰 이미지 배너 전용(스크롤 없는 게이트).
  const [adOverlay, setAdOverlay] = useState<AdOverlay>({ scrolling: false, slots: [] });
  // 고정 배너 — 홈/플레이/결과 하단 고정(스크롤 추적 안 함 → 깜빡임 없음). 화면당 1개.
  const [banner, setBanner] = useState<{ adGroupId: string; position: string; height: number } | null>(null);

  // 토스 뒤로가기(하드웨어/네비 바) → 웹뷰 히스토리가 있으면 그쪽 먼저, 없으면 토스가 닫도록.
  // 자체 뒤로가기 버튼을 따로 두지 않아 "뒤로가기 버튼 중복" 거절 사유도 피함.
  const backHandler = useBackHandler();
  useEffect(() => {
    const sub = backHandler.addEventListener(() => {
      if (canGoBackRef.current) {
        ref.current?.goBack();
        return true; // 기본 닫기 막고 웹뷰 뒤로
      }
      return undefined; // 더 뒤로 갈 곳 없으면 토스 기본 동작(닫기)
    });
    return () => sub.remove();
  }, [backHandler]);

  const reply = (requestId: string, ok: boolean, data?: unknown, error?: string) => {
    const payload = JSON.stringify({ requestId, ok, data, error });
    ref.current?.injectJavaScript(
      `window.__onTossBridgeMessage && window.__onTossBridgeMessage(${JSON.stringify(payload)}); true;`
    );
  };

  const onMessage = async (e: { nativeEvent: { data: string } }) => {
    let msg: BridgeRequest;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    // 배너 오버레이 통지(단방향, requestId 없음) — 슬롯 좌표/표시 상태 갱신.
    if (msg?.type === 'adOverlay') {
      const m = msg as unknown as { scrolling?: boolean; slots?: AdSlot[] };
      setAdOverlay({ scrolling: !!m.scrolling, slots: Array.isArray(m.slots) ? m.slots : [] });
      return;
    }
    // 고정 배너 통지(단방향) — 자리별 하단 고정 배너 표시/숨김.
    if (msg?.type === 'tossBanner') {
      const m = msg as unknown as { adGroupId?: string; position?: string; height?: number };
      setBanner(m.adGroupId ? { adGroupId: m.adGroupId, position: m.position || 'bottom', height: m.height || 64 } : null);
      return;
    }
    if (!msg?.type || !msg?.requestId) return;
    const { type, requestId } = msg;
    try {
      if (type === 'appLogin') {
        const result = await appLogin();          // { authorizationCode, referrer }
        reply(requestId, true, result);
      } else if (type === 'showRewardedAd') {
        // 리워드 광고 — load → loaded 시 show. userEarnedReward=보상확정, dismissed=닫힘.
        const adGroupId = (msg.params && (msg.params as any).adGroupId) || '';
        let earned = false; let replied = false;
        const done = (ok: boolean, data?: unknown, error?: string) => { if (replied) return; replied = true; reply(requestId, ok, data, error); };
        const evt = (e: any) => (typeof e === 'string' ? e : (e && e.type) || '');
        loadFullScreenAd({
          options: { adGroupId },
          onEvent: (e: any) => {
            if (evt(e) === 'loaded') {
              showFullScreenAd({
                options: { adGroupId },
                onEvent: (se: any) => {
                  const tt = evt(se);
                  if (tt === 'userEarnedReward') earned = true;
                  else if (tt === 'dismissed') done(true, { rewarded: earned });
                  else if (tt === 'failedToShow') done(false, undefined, 'failedToShow');
                },
                onError: (err: any) => done(false, undefined, (err && err.message) || 'showError'),
              });
            }
          },
          onError: (err: any) => done(false, undefined, (err && err.message) || 'loadError'),
        });
      } else if (type === 'shareReward') {
        // 공유 리워드 — contactsViral(친구 공유). sendViral=공유완료, close=시트 닫힘.
        // close 시 {shared} 회신 → 웹이 공유 완료면 서버/로컬 보상 지급.
        const moduleId = (msg.params && (msg.params as any).moduleId) || '';
        let shared = false; let replied = false;
        const done = (ok: boolean, data?: unknown, error?: string) => { if (replied) return; replied = true; reply(requestId, ok, data, error); };
        const evt = (e: any) => (typeof e === 'string' ? e : (e && e.type) || '');
        try {
          contactsViral({
            options: { moduleId },
            onEvent: (e: any) => {
              const tt = evt(e);
              if (tt === 'sendViral') shared = true;       // 공유 완료(보상 시점)
              else if (tt === 'close') done(true, { shared });
            },
            onError: (err: any) => done(false, undefined, (err && err.message) || 'shareError'),
          });
        } catch (err) {
          done(false, undefined, err instanceof Error ? err.message : 'shareError');
        }
      } else if (type === 'logEvent') {
        // 핵심지표 커스텀 이벤트 — Analytics.Impression 을 잠깐 렌더해 1회 발사(best-effort).
        const name = (msg.params && (msg.params as any).name) || '';
        const params = (msg.params && (msg.params as any).params) || undefined;
        if (name) {
          const id = `ev_${++logSeq.current}`;
          setLogQueue((q) => [...q, { id, name, params }]);
          // 발사용 컴포넌트가 마운트되면 on-mount 로 토스에 전송됨 → 짧게 뒤 제거.
          setTimeout(() => setLogQueue((q) => q.filter((x) => x.id !== id)), 1500);
        }
        reply(requestId, true);   // best-effort ack
      } else {
        reply(requestId, false, undefined, `UNKNOWN_TYPE:${type}`);
      }
    } catch (err) {
      reply(requestId, false, undefined, err instanceof Error ? err.message : 'BRIDGE_ERROR');
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={ref}
        source={{ uri: `${SITE}${path}` }}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        onNavigationStateChange={(s) => { canGoBackRef.current = s.canGoBack; }}
        injectedJavaScriptBeforeContentLoaded={INJECT_BEFORE}
        // UA에 마커 추가 → 서버(사이트)가 토스 인앱 요청을 식별(서버측 분기용).
        applicationNameForUserAgent="AppsInTossWebView"
      />
      {/* 핵심지표 이벤트 발사 — 마운트되는 순간(on-mount) 토스로 1회 전송. 화면엔 안 보임(0px). */}
      {logQueue.map((e) => (
        <Analytics.Impression
          key={e.id}
          name={e.name}
          params={e.params}
          impression="on-mount"
        >
          <View style={styles.hiddenLog} />
        </Analytics.Impression>
      ))}

      {/* 배너 광고 오버레이 — 웹뷰 위에 네이티브 InlineAd 를 슬롯 좌표에 정렬해 얹음.
          box-none: 광고 영역 외 터치는 웹뷰로 통과. 스크롤 중/뷰포트 밖이면 언마운트(떨림·잘못된 노출 방지). */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {adOverlay.slots.map((s) => {
          const show = !adOverlay.scrolling && s.inViewport;
          if (!show) return null;
          return (
            <View
              key={s.slotId}
              pointerEvents="auto"
              style={{ position: 'absolute', top: s.top, left: s.left, width: s.width, height: s.height || 76 }}
            >
              {/* InlineAd 내부 ImpressionArea 는 IOContext(IOScrollView) 안에서만 동작 → IOScrollView 로 감쌈 */}
              <AdErrorBoundary>
                <IOScrollView style={{ flex: 1 }} scrollEnabled={false} showsVerticalScrollIndicator={false}>
                  <InlineAd adGroupId={s.adGroupId} variant="card" />
                </IOScrollView>
              </AdErrorBoundary>
            </View>
          );
        })}
      </View>

      {/* 고정 배너 — 화면 하단(또는 상단)에 고정. 스크롤 추적 안 함 → 깜빡임 없음.
          box-none: 배너 외 터치는 웹뷰로 통과. */}
      {banner && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View
            pointerEvents="auto"
            style={[styles.fixedBanner, banner.position === 'top' ? { top: 0 } : { bottom: 0 }, { height: banner.height || 64 }]}
          >
            <AdErrorBoundary>
              <IOScrollView style={{ flex: 1 }} scrollEnabled={false} showsVerticalScrollIndicator={false}>
                <InlineAd adGroupId={banner.adGroupId} variant="card" />
              </IOScrollView>
            </AdErrorBoundary>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
  // 이벤트 발사 컴포넌트는 보이지 않게(레이아웃 영향 0).
  hiddenLog: { position: 'absolute', width: 0, height: 0, opacity: 0 },
  fixedBanner: { position: 'absolute', left: 0, right: 0 },
});
