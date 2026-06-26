// CandleRider 미니앱 공용 웹뷰 셸 — candlebike.vercel.app 을 WebView로 로딩.
// 토스 환경 마커 주입 + 뒤로가기 처리 + UA 마커 + 네이티브 브리지(appLogin).
// ⚠️ @granite-js/native/react-native-webview 의 WebView 사용(토스 호스트 링크 모듈).
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useBackHandler } from '@granite-js/react-native';
import { WebView } from '@granite-js/native/react-native-webview';
import { appLogin, loadFullScreenAd, showFullScreenAd, contactsViral, Analytics } from '@apps-in-toss/framework';

const SITE = 'https://candlerider.2nt4soft.com';

// 페이지 로드 전 주입: 사이트가 토스 인앱 환경을 감지(src/toss.js)해
// 외부광고(AdSense/하우스 자리)를 끄고 결과 게이트를 건너뛰도록 마커 설정.
//  __APPS_IN_TOSS_REWARD__ : 리워드 광고 브리지 지원(새 .ait)
//  __APPS_IN_TOSS_SHARE__  : 공유 리워드(contactsViral) 브리지 지원(새 .ait)
//  __APPS_IN_TOSS_EVENT__  : 핵심지표 커스텀 이벤트(logEvent) 브리지 지원(새 .ait)
const INJECT_BEFORE = `
  window.__APPS_IN_TOSS__ = true;
  window.__APPS_IN_TOSS_REWARD__ = true;
  window.__APPS_IN_TOSS_SHARE__ = true;
  window.__APPS_IN_TOSS_EVENT__ = true;
  true;
`;

// 핵심지표(분석) 커스텀 이벤트 — 1회 발사용 큐 아이템.
// RN framework엔 명령형 log API가 없어, Analytics.Impression(impression="on-mount")을
// 잠깐 렌더해 1회 발사한다(플레이북 검증 경로). 발사 후 타이머로 큐에서 제거.
type LogItem = { id: string; name: string; params?: Record<string, unknown> };

// 웹→셸 메시지 프로토콜: { type, requestId, params }
// 셸→웹 회신: window.__onTossBridgeMessage(JSON{ requestId, ok, data?, error? })
type BridgeRequest = { type?: string; requestId?: string; params?: Record<string, unknown> };

export function WebShell({ path }: { path: string }) {
  const ref = useRef<WebView>(null);
  // 웹뷰 히스토리 뒤로가기 가능 여부(최신값을 ref로 보관 → 핸들러 재등록 불필요)
  const canGoBackRef = useRef(false);
  // 핵심지표 이벤트 발사 큐(웹→브리지 logEvent → 짧게 렌더 → on-mount 발사 → 제거)
  const [logQueue, setLogQueue] = useState<LogItem[]>([]);
  const logSeq = useRef(0);

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
  // 이벤트 발사 컴포넌트는 보이지 않게(레이아웃 영향 0).
  hiddenLog: { position: 'absolute', width: 0, height: 0, opacity: 0 },
});
