// CandleRider 미니앱 공용 웹뷰 셸 — candlebike.vercel.app 을 WebView로 로딩.
// 토스 환경 마커 주입 + 뒤로가기 처리 + UA 마커 + 네이티브 브리지(appLogin).
// ⚠️ @granite-js/native/react-native-webview 의 WebView 사용(토스 호스트 링크 모듈).
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useBackHandler } from '@granite-js/react-native';
import { WebView } from '@granite-js/native/react-native-webview';
import { appLogin } from '@apps-in-toss/framework';

const SITE = 'https://candlerider.2nt4soft.com';

// 페이지 로드 전 주입: 사이트가 토스 인앱 환경을 감지(src/toss.js)해
// 외부광고(AdSense/하우스 자리)를 끄고 결과 게이트를 건너뛰도록 마커 설정.
const INJECT_BEFORE = `
  window.__APPS_IN_TOSS__ = true;
  true;
`;

// 웹→셸 메시지 프로토콜: { type, requestId, params }
// 셸→웹 회신: window.__onTossBridgeMessage(JSON{ requestId, ok, data?, error? })
type BridgeRequest = { type?: string; requestId?: string; params?: Record<string, unknown> };

export function WebShell({ path }: { path: string }) {
  const ref = useRef<WebView>(null);
  // 웹뷰 히스토리 뒤로가기 가능 여부(최신값을 ref로 보관 → 핸들러 재등록 불필요)
  const canGoBackRef = useRef(false);

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
});
