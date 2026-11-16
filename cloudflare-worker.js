// somang-ai-hub · Slack CORS 프록시 + 클로드(Anthropic) 중계기 (Cloudflare Worker)
//
// 1) Slack 프록시: 휴대폰 브라우저에서 slack.com/api 를 직접 부르면 CORS에 막히므로 이 Worker가 대신 전달한다.
// 2) 클로드 중계: POST /claude 로 { channel, thread_ts, prompt, mode } 를 받아
//    - Slack 스레드 답장(conversations.replies)을 읽어 맥락을 만들고
//    - Anthropic API(claude)에 물어보고
//    - 답을 '[클로드] …' 로 Slack 스레드에 붙인다. (1~2초)
//
// Worker 설정 → Variables and Secrets
//   ALLOWED_ORIGIN     (변수)   예: https://somang-ot.github.io
//   SLACK_TOKEN        (Secret) xoxb-…  (Slack 읽기/쓰기)
//   ANTHROPIC_API_KEY  (Secret) sk-ant-… (클로드 호출)
//   ANTHROPIC_MODEL    (변수, 선택) 예: claude-sonnet-4-6
//   SLACK_CHANNEL      (변수, 선택) 기본 채널 ID

const SLACK_API = 'https://slack.com/api/';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const DEFAULT_CHANNEL = 'C0CHQCP2KPD';
// 답장은 빠르게(Haiku), 취합은 더 꼼꼼하게(Sonnet). env.ANTHROPIC_MODEL 이 있으면 그것을 먼저 쓴다.
const MODEL_REPLY = 'claude-haiku-4-5-20251001';
const MODEL_SYNTHESIZE = 'claude-sonnet-4-6';
const DEFAULT_MODEL = MODEL_REPLY;
const FALLBACK_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'];
const MAX_TOKENS = 1024;
const THREAD_LIMIT = 60;
const THREAD_CHARS = 12000;
const SLACK_TEXT_LIMIT = 3800;

// 스레드에 바로 읽히는 짧은 한국어 답을 만드는 지침.
const SYSTEM_PROMPT = [
  "너는 소망 님의 Slack 워크스페이스 '소망 AI 협업방'에서 '클로드'로 활동하는 AI 동료다.",
  '같은 방에 피클(망이·개인 비서), 피클2, 뮤즈(정리·요약), 챗GPT가 있고, 각자 [이름] 이름표를 달고 스레드에 답한다.',
  '',
  '규칙:',
  '- 항상 한국어로, 스레드에 바로 읽히도록 짧고 실제로 쓸 수 있게 쓴다.',
  '- 인사, 자기소개, 서론, "물론입니다" 같은 말은 넣지 않는다. 첫 줄이 바로 답이다.',
  '- 기본 3~6줄. 목록은 "•" 로 3개 이하. 마크다운 제목(#)은 쓰지 않는다.',
  '- 굵게는 *별표 한 개* 로 쓴다. **별표 두 개**는 화면에 그대로 보이므로 쓰지 않는다.',
  '- 묻는 것에 먼저 답하고, 필요하면 다음 행동을 1가지만 제안한다.',
  '- 모르면 모른다고 말하고, 확인할 방법을 한 줄로 적는다.',
  '- 이름표 "[클로드]"는 직접 붙이지 않는다. 앱이 붙인다.',
].join('\n');

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return reply(null, 204, cors);

    const method = new URL(request.url).pathname.replace(/^\/+/, '').replace(/\/+$/, '').replace(/^api\//, '');

    // ---------- 클로드 중계 ----------
    if (method === 'claude' || method === 'claude/') {
      if (request.method === 'GET') {
        return reply({
          ok: true,
          endpoint: 'claude',
          has_key: !!env.ANTHROPIC_API_KEY,
          model: env.ANTHROPIC_MODEL || MODEL_REPLY,
          models: env.ANTHROPIC_MODEL ? [env.ANTHROPIC_MODEL] : [MODEL_REPLY, MODEL_SYNTHESIZE],
          slack_token: !!env.SLACK_TOKEN,
          channel: env.SLACK_CHANNEL || DEFAULT_CHANNEL,
        }, 200, cors);
      }
      if (request.method !== 'POST') return reply({ ok: false, error: 'use_post' }, 405, cors);
      try {
        return await handleClaude(request, env, cors);
      } catch (e) {
        return reply({ ok: false, error: 'worker_exception', message: String((e && e.message) || e) }, 500, cors);
      }
    }

    // ---------- Slack 프록시 ----------
    if (request.method !== 'POST') return reply({ ok: false, error: 'use_post' }, 405, cors);
    if (!/^(auth|chat|conversations|users|files)\.[a-zA-Z]+$/.test(method)) {
      return reply({ ok: false, error: 'method_not_allowed' }, 400, cors);
    }

    let data = {};
    try { data = JSON.parse((await request.text()) || '{}') || {}; } catch (_) { /* JSON이 아니면 빈 값 */ }
    const form = new URLSearchParams();
    for (const key of Object.keys(data)) {
      const v = data[key];
      if (key === 'token' || v === undefined || v === null) continue;
      form.set(key, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }

    const auth = request.headers.get('Authorization') ||
      (data.token ? 'Bearer ' + data.token : env.SLACK_TOKEN ? 'Bearer ' + env.SLACK_TOKEN : null);
    const upstream = await fetch(SLACK_API + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', ...(auth ? { Authorization: auth } : {}) },
      body: form.toString(),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });
  },
};

/* ===================== 클로드 ===================== */

async function handleClaude(request, env, cors) {
  let body = {};
  try { body = JSON.parse((await request.text()) || '{}') || {}; } catch (_) { /* 빈 값으로 진행 */ }

  const apiKey = env.ANTHROPIC_API_KEY || body.api_key || '';
  if (!apiKey) {
    return reply({
      ok: false,
      error: 'claude_not_configured',
      message: 'Worker에 ANTHROPIC_API_KEY 가 아직 없어요. Cloudflare Worker → Settings → Variables and Secrets 에 Secret 으로 추가해 주세요.',
    }, 200, cors);
  }

  const token = bearer(request) || (body.token ? String(body.token) : '') || env.SLACK_TOKEN || '';
  if (!token) {
    return reply({ ok: false, error: 'slack_token_missing', message: 'Slack 토큰이 없어요. Worker의 SLACK_TOKEN 또는 앱 설정의 토큰을 확인해 주세요.' }, 200, cors);
  }

  const channel = String(body.channel || env.SLACK_CHANNEL || DEFAULT_CHANNEL);
  const threadTs = body.thread_ts ? String(body.thread_ts) : '';
  const mode = body.mode === 'synthesize' ? 'synthesize' : 'reply';
  const prompt = String(body.prompt || '').trim();

  // 1) 스레드 맥락 읽기 (실패해도 클로드 호출은 계속한다)
  let messages = [];
  let warn = null;
  if (threadTs) {
    const r = await slackCall(token, 'conversations.replies', { channel, ts: threadTs, limit: THREAD_LIMIT });
    if (r.ok && Array.isArray(r.messages)) messages = r.messages;
    else warn = r.error || 'replies_failed';
  }

  // 2) 클로드에게 보낼 한 덩어리 프롬프트 (보낸 사람 이름을 붙이기 위해 이름표를 먼저 읽는다)
  const names = await getUserNames(token);
  const ask = buildPrompt(mode, prompt, messages, names);

  // 3) Anthropic 호출 (모델이 없으면 다음 후보로)
  const model = body.model || env.ANTHROPIC_MODEL || (mode === 'synthesize' ? MODEL_SYNTHESIZE : MODEL_REPLY);
  const out = await callClaude(apiKey, ask, env, model);
  if (!out.ok) {
    return reply({
      ok: false,
      error: out.error,
      message: out.message,
      status: out.status || null,
      thread_messages: messages.length,
      warning: warn,
    }, 200, cors);
  }

  // 4) '[클로드] …' 로 스레드에 붙이기
  const text = '[클로드] ' + out.text.trim();
  const post = await slackPost(token, channel, text, threadTs);
  if (!post.ok) {
    return reply({
      ok: false,
      error: 'slack_post_failed',
      message: '클로드 답은 받았지만 Slack에 붙이지 못했어요 (' + post.error + ')',
      reply: out.text,
      thread_messages: messages.length,
    }, 200, cors);
  }

  return reply({
    ok: true,
    ts: post.ts,
    reply: out.text,
    model: out.model,
    mode,
    thread_messages: messages.length,
    usage: out.usage || null,
    warning: warn,
  }, 200, cors);
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

async function slackCall(token, method, params) {
  const form = new URLSearchParams();
  for (const k of Object.keys(params || {})) {
    const v = params[k];
    if (v === undefined || v === null) continue;
    form.set(k, String(v));
  }
  try {
    const res = await fetch(SLACK_API + method, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Bearer ' + token,
      },
      body: form.toString(),
    });
    const data = await res.json().catch(() => null);
    return data || { ok: false, error: 'bad_response' };
  } catch (e) {
    return { ok: false, error: 'network_error' };
  }
}

async function slackPost(token, channel, text, threadTs) {
  const chunks = splitText(text, SLACK_TEXT_LIMIT);
  let firstTs = null;
  for (let i = 0; i < chunks.length; i++) {
    const p = { channel, text: chunks[i] };
    if (threadTs) p.thread_ts = threadTs;
    const r = await slackCall(token, 'chat.postMessage', p);
    if (!r.ok) return { ok: false, error: r.error || 'post_failed', ts: firstTs };
    if (i === 0) firstTs = r.ts;
    if (chunks.length > 1) await sleep(350);
  }
  return { ok: true, ts: firstTs };
}

function splitText(text, limit) {
  if (text.length <= limit) return [text];
  const out = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.6) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

function buildPrompt(mode, prompt, messages, names) {
  const lines = [];
  for (const m of messages || []) {
    const text = cleanSlackText(m.text);
    if (!text) continue;
    if (m.subtype && /channel_join|channel_leave/.test(m.subtype)) continue;
    lines.push(speakerOf(m, names || {}) + ': ' + text);
  }
  let transcript = lines.join('\n');
  if (transcript.length > THREAD_CHARS) transcript = '…(앞부분 생략)…\n' + transcript.slice(-THREAD_CHARS);

  const parts = [];
  if (transcript) parts.push('지금까지 스레드 대화:\n' + transcript);

  if (mode === 'synthesize') {
    parts.push([
      '위 스레드에 [피클]·[피클2]·[뮤즈]·[챗GPT] 들이 남긴 답변을 종합해 최종 결론으로 취합해줘.',
      '형식:',
      '• 결론: 한 줄',
      '• 핵심: 3개 이하',
      '• 바로 할 일: 1~3개 (누가 / 언제)',
      '• 아직 정해지지 않은 것: 1~2개',
      '전체 10줄 이내, 서론 없이.',
    ].join('\n'));
  } else {
    if (prompt) parts.push('소망 님의 지시: ' + prompt);
    parts.push('위 지시에 [클로드]로서 바로 답해줘. 스레드에서 바로 읽히게 3~6줄, 필요하면 다음 행동 1가지.');
  }
  return parts.join('\n\n');
}

function speakerOf(m, names) {
  const t = String(m.text || '');
  const tag = t.match(/^\s*\[(피클2|피클|뮤즈|클로드|챗GPT|ChatGPT|Claude)\]/i);
  if (tag) return '[' + tag[1] + ']';
  if (m.user && names[m.user]) return names[m.user];
  if (m.user_name) return m.user_name;
  if (m.username) return m.username;
  if (m.bot_profile && m.bot_profile.name) return m.bot_profile.name;
  return m.bot_id ? 'AI' : '소망';
}

// Slack 사용자 이름표 (10분 캐시). 실패하면 조용히 빈 표를 쓴다.
let nameCache = { at: 0, map: {} };
async function getUserNames(token) {
  if (nameCache.at && Date.now() - nameCache.at < 600000 && Object.keys(nameCache.map).length) return nameCache.map;
  const r = await slackCall(token, 'users.list', { limit: 200 });
  if (!r.ok || !Array.isArray(r.members)) return nameCache.map || {};
  const map = {};
  for (const u of r.members) {
    if (!u || !u.id) continue;
    const p = u.profile || {};
    const nm = p.display_name || p.real_name || u.real_name || u.name || '';
    map[u.id] = nm || u.name || u.id;
  }
  nameCache = { at: Date.now(), map };
  return map;
}

function cleanSlackText(t) {
  return String(t || '')
    .replace(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, name) => '@' + (name || id))
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/\*?다음을 사용하여 보냄\*?[\s\S]*$/i, '')
    .replace(/_?Sent using_?\s+\S+\s*$/i, '')
    .trim();
}

async function callClaude(apiKey, prompt, env, modelOverride) {
  const models = [];
  const push = (m) => { if (m && models.indexOf(m) < 0) models.push(m); };
  push(modelOverride);
  push(DEFAULT_MODEL);
  FALLBACK_MODELS.forEach(push);

  let last = null;
  for (const model of models) {
    const r = await callOnce(apiKey, prompt, model);
    if (r.ok) return r;
    last = r;
    // 모델 이름 문제일 때만 다음 후보로 넘어간다. 크레딧·키 문제는 모델을 바꿔도 같다.
    if (r.error !== 'model_not_found') return r;
  }
  return last || { ok: false, error: 'claude_failed', message: '클로드 호출에 실패했어요.' };
}

async function callOnce(apiKey, prompt, model) {
  let res;
  try {
    res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (e) {
    return { ok: false, error: 'anthropic_unreachable', message: 'Anthropic에 닿지 못했어요. (' + String((e && e.message) || e) + ')' };
  }

  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }

  if (res.ok && data && Array.isArray(data.content)) {
    const text = data.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) return { ok: false, error: 'empty_reply', message: '클로드가 빈 답을 보냈어요. 잠시 뒤 다시 시도해 주세요.' };
    return { ok: true, text, model: data.model || model, usage: data.usage || null };
  }

  return mapAnthropicError(res.status, data, model);
}

function mapAnthropicError(status, data, model) {
  const err = (data && data.error) || {};
  const type = String(err.type || '');
  const msg = String(err.message || '');

  if (status === 401 || type === 'authentication_error') {
    return { ok: false, error: 'invalid_api_key', status, message: 'Anthropic API 키가 올바르지 않아요. Worker의 ANTHROPIC_API_KEY 값을 확인해 주세요.' };
  }
  if (/credit balance is too low|purchase credits|insufficient credit|billing/i.test(msg)) {
    return {
      ok: false, error: 'insufficient_credit', status,
      message: 'Anthropic 크레딧이 0이에요. platform.claude.com/settings/billing 에서 $5 충전하면 클로드가 바로 답해요.',
    };
  }
  if (status === 403 || type === 'permission_error') {
    return { ok: false, error: 'permission_denied', status, message: '이 API 키로는 호출할 수 없어요. (' + (msg || 'HTTP 403') + ')' };
  }
  if (status === 404 || type === 'not_found_error') {
    return { ok: false, error: 'model_not_found', status, message: '모델 "' + model + '" 을(를) 찾지 못했어요. (' + (msg || 'HTTP 404') + ')' };
  }
  if (status === 429 || type === 'rate_limit_error') {
    return { ok: false, error: 'rate_limited', status, message: '클로드 요청이 잠깐 몰렸어요. 10초 뒤에 다시 시도해 주세요.' };
  }
  if (status === 529 || type === 'overloaded_error') {
    return { ok: false, error: 'overloaded', status, message: '클로드 서버가 잠시 붐비네요. 조금 뒤에 다시 시도해 주세요.' };
  }
  if (type === 'invalid_request_error') {
    return { ok: false, error: 'invalid_request', status, message: '클로드 요청 형식이 맞지 않아요. (' + (msg || 'HTTP 400') + ')' };
  }
  return { ok: false, error: 'claude_failed', status, message: msg || ('클로드 오류 (HTTP ' + status + ')') };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function reply(obj, status, cors) {
  return new Response(obj ? JSON.stringify(obj) : null, {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
