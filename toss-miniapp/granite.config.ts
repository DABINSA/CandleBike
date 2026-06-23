import { router } from '@granite-js/plugin-router';
import { hermes } from '@granite-js/plugin-hermes';
import { appsInToss } from '@apps-in-toss/framework/plugins';
import { defineConfig } from '@granite-js/react-native/config';

export default defineConfig({
  appName: 'candlerider',
  scheme: 'intoss',
  plugins: [
    appsInToss({
      permissions: [],
      brand: {
        displayName: '캔들라이더',
        // ⚠️ 반드시 실제로 200 응답하는 정사각 PNG. 404면 "홈 화면에 추가" 단축 아이콘이
        //    기본 안드로이드 로봇으로 깨진다. 배포 전 200 확인:
        //    curl -o /dev/null -w "%{http_code}" https://candlebike.vercel.app/assets/favicon-192.png
        //    (콘솔 「디자인」 앱 아이콘은 512 PNG로 별도 업로드 권장)
        icon: 'https://candlebike.vercel.app/assets/favicon-192.png',
        primaryColor: '#2ce6c4',
      },
    }),
    router(),
    hermes(),
  ],
});
