# V100 가격 조사 설계 및 운영

`POST /api/research`: `productName`, `brand`, `modelCode`, `mode` (`store`/`resell`), `size` (리셀 필수).
서버는 `gemini-3.8-flash`의 `generateContent`에 `google_search`와 JSON structured output을 사용합니다.
`groundingChunks`의 실제 출처와 가격 숫자를 포함하는 `groundingSupports`가 있는 항목만 반환합니다.
출처 또는 검증된 가격이 없으면 422를 반환하고 캐시하지 않습니다. Search Suggestions는 sandbox iframe으로 표시합니다.

## 사용량 및 개인정보

- Redis Lua 한 번으로 캐시 → IP 제한 → 전체 제한 → 양쪽 횟수 예약을 원자적으로 처리한 뒤 Grounding을 한 번 호출합니다. 자동 재시도하지 않습니다.
- 성공 결과만 24시간 캐시합니다. 제품명·브랜드·모델·모드·사이즈가 키에 반영되며 캐시 적중은 횟수를 차감하지 않습니다.
- 새 Grounding 시도는 IP당 하루 5회, 전체 하루 300회입니다. Redis 서버 시간 기준 한국시간 자정에 초기화합니다.
- 외부 호출 실패나 출처 없는 응답도 시도에 포함됩니다. 한도 초과 요청은 어느 쪽도 차감하지 않습니다.
- 한도 키는 배포마다 바뀌지 않습니다. 같은 Redis를 쓰는 Preview 배포들도 하루 예산을 공유합니다.
- Vercel이 덮어쓰는 `x-vercel-forwarded-for`만 신뢰합니다. IP는 서버 메모리에서 정규화 후 `IP_HASH_SECRET`으로 HMAC-SHA256 처리합니다. Redis에는 해시만 저장하고 일일 키는 자정에 만료됩니다.
- 앱 로그에는 결과 코드·처리 단계·결과 수만 기록합니다. 요청 객체, IP, 해시, API 키, 제공자 응답 원문을 기록하지 않습니다. Vercel 등 인프라 자체 접속 로그 정책은 이 코드가 제어하지 않습니다.
- Redis 장애나 필수 설정 누락 시 Grounding을 호출하지 않습니다.
- 300회는 Grounding API 요청 수입니다. Google은 한 요청 내부의 여러 검색 쿼리를 별도 과금할 수 있습니다. 기존 `/api/analyze` 이미지 식별 호출은 이 예산에 포함되지 않습니다.

## 환경변수

Vercel Preview의 서버 전용 `GEMINI_API_KEY`, `UPSTASH_REDIS_REST_URL` (HTTPS), `UPSTASH_REDIS_REST_TOKEN` (쓰기 권한), `IP_HASH_SECRET`이 필요합니다. 등록된 비밀값을 그대로 사용하며, 새로 설정할 때는 충분히 긴 무작위 값을 권장합니다. 클라이언트나 저장소에 값을 넣지 않습니다.
가격 조사 모델은 코드에 고정하여 기존 이미지 식별의 `GEMINI_MODEL` 설정과 분리합니다.

## 검증 및 배포

Node 20 이상에서 `pnpm install --frozen-lockfile`, `pnpm test`.
테스트는 응답 검증·캐시·IP 처리·오류 차단과 실제 제한 Lua의 5/300 경계, 1000건 순차 예약, 한국시간 자정 초기화를 확인합니다.
작업 브랜치는 `v100-ai-championship`입니다. 이 브랜치 push로 Preview를 배포하고 해당 커밋의 Ready, 빌드·런타임 로그와 브라우저 결과를 확인합니다.

## 공식 문서 (2026-09-12 확인)

- [모델명](https://ai.google.dev/gemini-api/docs/models)
- [Grounding 요청·응답·과금](https://ai.google.dev/gemini-api/docs/generate-content/google-search)
- [Structured output REST 스키마](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Upstash REST API](https://upstash.com/docs/redis/features/restapi)
- [Vercel IP 헤더](https://vercel.com/docs/headers/request-headers)

## 2026-09-13 Gemini 400 수정

Preview에서 `error.code=400`, `error.status=INVALID_ARGUMENT`, `classification=INVALID_MIME_TYPE`을 확인했습니다.
일부 사용 가이드 예제는 `responseFormat.text.mimeType`에 `application/json`을 쓰지만, [GenerateContent REST 참조의 TextResponseFormat](https://ai.google.dev/api/generate-content#TextResponseFormat)은 `APPLICATION_JSON` 열거값을 명시합니다. 실제 요청을 이 열거값으로 수정했습니다. HTTP `Content-Type`은 여전히 `application/json`입니다.

요청 조합은 `/v1beta/models/gemini-3.8-flash:generateContent`, `tools: [{google_search: {}}]`, `generationConfig.responseFormat.text: {mimeType: "APPLICATION_JSON", schema: ...}`입니다. `responseMimeType`/`responseSchema` 등 다른 출력 설정을 중복 지정하지 않습니다.

오류 로그는 HTTP 상태와 `error.code`, 대문자 식별자로 검증한 `error.status`, 최대 10개 `details[].reason`, 고정된 분류명만 기록합니다. `message`, `metadata`, `fieldViolations` 원문, 키, 요청/응답 본문은 기록하거나 클라이언트로 반환하지 않습니다. JSON이 아닌 오류도 고정 분류만 남깁니다.
