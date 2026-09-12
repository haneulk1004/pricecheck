# PRICE_CHECK V100

사진 식별 또는 직접 입력 → 제품 확인 → 매장 가격검증 / 리셀 시세 → 실시간 가격 조사.

Gemini 3.8 Flash와 Google Search Grounding으로 공개 가격을 조사하고 출처가 뒷받침하는 가격만 표시합니다. 기존 판매처 검색 링크, 매장가 입력, 리셀 사이즈 선택과 즐겨찾기를 유지합니다.

성공 결과는 Upstash Redis에 24시간 저장합니다. 새 가격 조사는 IP당 하루 5회, 전체 하루 300회이며 한국시간 자정에 초기화됩니다. IP는 HMAC 해시로만 저장합니다.

서버 설정, API 형식, 제한 범위, 테스트와 공식 문서는 [가격 조사 설계 및 운영](docs/PRICE_RESEARCH.md)을 참고하세요.

검증: Node 20 이상에서 `pnpm install --frozen-lockfile`, `pnpm test`.

배포 브랜치: `v100-ai-championship` → Vercel Preview.
