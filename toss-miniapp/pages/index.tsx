// 루트('/') — candlebike.vercel.app 홈(종목 검색 → 플레이)을 WebShell로 로딩.
import { createRoute } from '@granite-js/react-native';
import { WebShell } from '../src/WebShell';

export const Route = createRoute('/', {
  validateParams: (params) => params,
  component: Index,
});

export function Index() {
  return <WebShell path="/" />;
}
