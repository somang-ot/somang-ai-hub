# 소망 님의 AI 협업 방

Slack 채널 **#소망-ai-협업방-전체** 를 저장소로 쓰는, 폰에서 바로 쓰는 AI 지시함입니다.
할 일을 한 번 남기면 여러 AI가 스레드로 답하고, 이 화면이 그 답장을 한 줄기 타임라인으로 모아 보여 줍니다.

- 앱 주소: **https://somang-ot.github.io/somang-ai-hub/**
- 저장소: **https://github.com/somang-ot/somang-ai-hub** (GitHub Pages, `main` / root 로 배포)
- 채널 ID: `C0CHQCP2KPD` · 워크스페이스: `소망 AI 협업방` (`T0CHQCNSMEX`)

> 화면이 안 열리면 저장소 → Settings → Pages 에서 Source가 `Deploy from a branch`, Branch가 `main` / `/ (root)` 인지 확인하세요.

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `index.html` | 앱 전체 (HTML/CSS/JS 한 파일, 빌드 없음) |
| `cloudflare-worker.js` | 브라우저 ↔ Slack 사이 CORS 프록시 (Cloudflare Worker) |
| `README.md` | 이 문서 |

## 먼저 그냥 열어 보기

위 앱 주소를 폰 브라우저로 열면 **미리보기 모드**로 예시 대화가 보입니다.
지시를 남겨 보면 답장이 어떻게 붙는지 그대로 확인할 수 있어요. (진짜 Slack에는 아무것도 올라가지 않습니다.)

진짜로 쓰려면 아래 3단계만 하면 됩니다.

---

## 1. Slack 앱 만들기 (5분)

1. https://api.slack.com/apps → **Create New App** → **From scratch** → 이름(예: `소망 허브`) → 워크스페이스 `소망 AI 협업방` 선택
2. 왼쪽 **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** 에 네 개 추가
   - `channels:history` — 스레드·채널 메시지 읽기
   - `channels:read` — 채널 정보 확인
   - `chat:write` — 지시 보내기
   - `users:read` — 보낸 사람 이름 표시
3. 같은 화면 위쪽 **Install to Workspace** → 허용 → 나오는 **Bot User OAuth Token**(`xoxb-…`) 복사
4. Slack에서 `#소망-ai-협업방-전체` 채널을 열고 `/invite @소망 허브` 로 방금 만든 앱을 초대
   - 초대하지 않으면 `not_in_channel` 오류가 납니다.

> 이미 쓰고 있는 봇 토큰이 있고 위 권한이 다 있으면 그대로 써도 됩니다.

## 2. 프록시 배포 (Cloudflare Worker, 3분)

휴대폰 브라우저는 `slack.com/api` 를 직접 부를 수 없습니다(CORS). Worker 하나를 두고 거쳐 가면 됩니다.

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Worker** → 이름 `somang-ai-hub` → **Deploy**
2. **Edit code** 에서 기본 코드를 지우고 이 저장소의 `cloudflare-worker.js` 내용을 그대로 붙여 넣기 → **Deploy**
3. **Settings → Variables and Secrets**
   - `ALLOWED_ORIGIN` = `https://somang-ot.github.io` (이 주소에서만 호출 허용)
   - (권장) `SLACK_TOKEN` = 위에서 복사한 `xoxb-…` 를 **Secret** 으로 추가
     → 토큰이 Worker에만 있고 폰에는 저장되지 않습니다.
4. Worker 주소 확인: `https://somang-ai-hub.<내서브도메인>.workers.dev`

> `SLACK_TOKEN` 을 Secret으로 넣었다면 앱 설정에서 **Worker에 토큰 보관** 을 켜고, Slack 토큰 칸은 비워 두세요.
> 넣지 않았다면 앱 설정의 Slack 토큰 칸에 `xoxb-…` 를 직접 넣습니다.

> Worker는 앱이 보낸 JSON 본문을 Slack이 받는 **form-urlencoded** 로 바꿔 전달하고, 토큰은 `Authorization: Bearer …` 헤더로 보냅니다.
> Slack은 JSON 본문의 `token` 을 무시하고, `conversations.info`·`conversations.replies` 같은 메서드는 JSON 본문 자체를 받지 않기 때문입니다.

## 3. 앱에 연결

앱 우측 상단 **설정** 탭에서:

| 항목 | 값 |
| --- | --- |
| Slack 토큰 | `xoxb-…` (Worker에 Secret으로 넣었다면 비워 둠) |
| 채널 ID | `C0CHQCP2KPD` |
| 프록시 URL | `https://somang-ai-hub.<내서브도메인>.workers.dev` |
| Worker에 토큰 보관 | Secret을 넣었으면 켜기 |
| 미리보기(데모) 모드 | 끄기 |
| 자동 새로고침 | 켜기 (20초마다 새 답장 확인) |

**연결 테스트** 를 눌러 `연결됐어요! 소망 AI 협업방 · #소망-ai-협업방-전체` 가 나오면 **저장**.
이후 **대화·결정** 탭에 실제 채널 대화가 보입니다.

---

## 쓰는 방법

- **AI 고르기** → 할 일 적기 → **지시 남기기**
  - `모두에게` — 멘션 없이 그대로 올립니다. 방을 지켜보는 AI들이 알아서 답합니다.
  - `피클` · `피클2` · `뮤즈` · `클로드` · `챗GPT` — 고른 AI의 이름표를 앞에 붙여 올립니다.
  - 이미 `@피클` 처럼 직접 적었다면 이름표를 두 번 붙이지 않습니다.
  - 클로드는 Slack 사용자 ID를 찾아 진짜 멘션(`<@U…>`)으로 보냅니다. 그래야 즉시 답합니다.
- **답장 보기** — 각 지시 아래에 스레드 답장이 붙습니다. `[피클]` `[뮤즈]` 처럼 이름표가 있으면 그 AI의 답장으로 색을 입혀 보여 줍니다.
- **결정 모아 보기** — 답장에 "확정·결정·예약" 같은 말이 있으면 위에 `최근 결정` 으로 짧게 모아 줍니다.
- **↻** 새로고침, 오른쪽 스위치는 자동 새로고침 켜기/끄기입니다.
- 화면 제목을 길게 눌러 **홈 화면에 추가** 하면 앱처럼 열립니다.

## 잘 안 될 때

| 증상 | 원인 / 해결 |
| --- | --- |
| `Slack에 닿지 못했어요` | 프록시 URL 오타, 또는 Worker의 `ALLOWED_ORIGIN` 이 지금 주소와 다름 |
| `invalid_auth` | 토큰 오타·만료. Slack에서 다시 설치해 토큰 재발급 |
| `missing_scope` | 위 4개 권한 추가 후 **Reinstall** (권한은 재설치해야 반영) |
| `not_in_channel` | 채널에서 `/invite @앱이름` |
| `channel_not_found` | 채널 ID 확인 (`C0CHQCP2KPD`) |
| 답장이 안 보임 | 자동 새로고침을 켜거나 ↻. 뮤즈는 최대 10분 걸릴 수 있음 |

## 보안

- 토큰은 이 브라우저의 `localStorage` 에만 저장되고 서버로 따로 보내지 않습니다. 다만 **공용 기기에서는 쓰지 마세요** (`설정 → 토큰 지우기`).
- Worker에 `SLACK_TOKEN` 을 Secret으로 두면 폰에는 토큰이 남지 않습니다. 이쪽을 권장합니다.
- `ALLOWED_ORIGIN` 을 꼭 본인 Pages 주소로 제한하세요.
- 이 앱은 채널 읽기/쓰기만 합니다. 결제·메일 발송 같은 일은 AI가 스레드에서 먼저 물어봅니다.

## 구조 메모

- `conversations.history`(최근 40개) → 답장이 있는 스레드 10개까지 `conversations.replies` 로 병렬 조회
- 채널 참여/나가기 알림(`channel_join` 등)은 타임라인에서 제외
- 뮤즈가 남기는 `*다음을 사용하여 보냄* Muse` 꼬리말은 화면에서 자동 제거
- 메시지 보낸 뒤 0.9초 후 자동 새로고침, 이후 20초 간격 폴링
