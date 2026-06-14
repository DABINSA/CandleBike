// 야후 파이낸스용 초경량 CORS 프록시 (Cloudflare Worker · 무료).
// 공개 프록시는 자주 막히므로, 실데이터를 안정적으로 쓰려면 이걸 배포하세요.
//
// 배포(5분):
//  1) dash.cloudflare.com → Workers & Pages → Create → Worker
//  2) 이 코드 붙여넣고 Deploy → https://<이름>.<계정>.workers.dev 주소 확인
//  3) src/config.js 의 CORS_PROXY 를 'https://<그 주소>/?url=' 로 설정
//
// (Yahoo 도메인만 허용해 오·남용 방지)

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    if (!target || !/^https:\/\/[a-z0-9.-]*\.yahoo\.com\//i.test(target)) {
      return new Response('bad url', { status: 400, headers: cors });
    }
    const upstream = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });
  },
};
