// somang-ai-hub · Slack CORS 프록시 (Cloudflare Worker)
// 휴대폰 브라우저에서 slack.com/api 를 직접 부르면 CORS에 막히므로, 이 Worker가 대신 전달한다.
// Worker 설정 → 변수: ALLOWED_ORIGIN (예: https://somang-ot.github.io), SLACK_TOKEN (선택, Secret)

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return reply(null, 204, cors);
    if (request.method !== 'POST') return reply({ ok: false, error: 'use_post' }, 405, cors);

    // 경로에서 Slack 메서드만 꺼낸다. (/chat.postMessage, /api/chat.postMessage 모두 허용)
    const method = new URL(request.url).pathname.replace(/^\/+/, '').replace(/^api\//, '');
    if (!/^(auth|chat|conversations|users|files)\.[a-zA-Z]+$/.test(method)) {
      return reply({ ok: false, error: 'method_not_allowed' }, 400, cors);
    }

    // 본문에 토큰이 없으면 Worker 시크릿 토큰을 붙인다. → 폰에는 토큰을 저장하지 않아도 된다.
    const raw = await request.text();
    let body = raw;
    try {
      const data = JSON.parse(raw || '{}');
      if (!data.token && env.SLACK_TOKEN) {
        data.token = env.SLACK_TOKEN;
        body = JSON.stringify(data);
      }
    } catch (_) { /* JSON이 아니면 그대로 전달 */ }

    const auth = request.headers.get('Authorization');
    const upstream = await fetch('https://slack.com/api/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...(auth ? { Authorization: auth } : {}) },
      body,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });
  },
};

function reply(obj, status, cors) {
  return new Response(obj ? JSON.stringify(obj) : null, {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
