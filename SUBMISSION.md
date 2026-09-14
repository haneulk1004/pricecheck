# PRICE_CHECK V100 — Wanted AI Championship 2026

## 한 줄 소개
사진 한 장 또는 제품명 입력만으로 제품을 식별하고, 매장 판매가와 온라인·리셀 시세를 실제 공개 출처로 검증하는 AI 쇼핑 어시스턴트.

## 문제
오프라인 매장에서 본 가격이 온라인보다 비싼지, 혹은 리셀 시장에서 특정 사이즈의 실제 시세가 얼마인지 확인하려면 여러 쇼핑몰과 플랫폼을 직접 검색해야 합니다. 검색 결과에는 광고, 다른 옵션, 다른 사이즈, 중고·리퍼·액세서리 가격이 섞여 있어 빠르게 판단하기 어렵습니다.

## 해결
PRICE_CHECK는 다음 흐름으로 가격 검증을 단순화합니다.

1. 사진 촬영·이미지 업로드 또는 제품명/모델명 직접 입력
2. Gemini로 브랜드·제품명·모델 코드 식별
3. 매장 가격검증 또는 리셀 시세 모드 선택
4. Gemini 3.8 Flash + Google Search Grounding으로 현재 공개 가격 조사
5. 가격 숫자를 뒷받침하는 URL citation과 판매처 도메인이 일치하는 결과만 표시
6. 검증 가능한 출처가 없으면 가격을 추정하지 않고 결과를 숨김

## 핵심 차별점
- AI가 가격을 만들어내지 않고 제품 식별·검색 질의 정규화에 사용됨
- 가격은 Google Search Grounding의 실제 citation으로만 검증
- 판매처명과 출처 도메인이 일치하지 않으면 해당 가격을 차단하는 fail-closed 정책
- 리셀 모드는 제품·모델·선택 사이즈가 모두 일치하는 근거만 허용
- 사진에서 모델/SKU가 실제로 보이지 않으면 추론해서 채우지 않음
- 성공 결과는 24시간 캐시하여 반복 사용 시 추가 조사 횟수 차감 없음

## 기술 구성
- Frontend: Single-file React 18 + Tailwind CSS
- Backend: Vercel Serverless Functions
- AI: Gemini 3.8 Flash
- Search evidence: Google Search Grounding via Gemini Interactions API
- Cache / quota: Upstash Redis
- Security: Gemini API key server-side only, IP는 HMAC 해시로만 저장

## 안정성·비용 제어
- 가격 조사 요청은 단일 Gemini Interactions 패스로 제한
- `thinking_level: low`로 가격 검색에 불필요한 추론 비용 최소화
- 동일 제품·모드·사이즈 성공 결과는 24시간 캐시
- 기본 제한: IP당 하루 5회, 전체 하루 300회, 한국시간 자정 초기화
- provider/grounding 실패는 PRICE_CHECK 일일 quota에서 환불
- citation 또는 판매처-출처 정합성이 없으면 가격 미표시

## 검증된 시나리오
- 수동 모델 코드 검색에서 브랜드/제품명 구조화
- 사진으로 Logitech MX Keys Mini 식별
- 사진에서 보이지 않는 KX700 모델 코드 추론 방지
- 매장가 입력 placeholder 오인 제거
- Google Search Grounding citation의 UTF-8 byte offset 처리
- 판매처별 source-domain 정합성 검사 및 불일치 source 제거
- 실패 응답의 일일 quota 환불
- 구형 캐시가 새로운 검증 규칙을 우회하지 않도록 cache migration 적용

## 현재 제출 전 체크
- 코드/배포: V100 Preview 배포 완료
- 비용 최적화: 단일 Search 패스 적용 완료
- 안전 정책: 출처 없는 가격·판매처 불일치 가격 fail-closed
- 남은 실제 E2E: 제출 직전 매장 가격검증 1회 + 리셀 1회만 수행
- V100은 아직 main에 merge하지 않음

## 데모 시나리오
1. 제품 사진 업로드
2. AI가 브랜드와 제품명을 식별하는 화면 확인
3. `맞아요` 선택
4. `매장 가격검증` 선택
5. 필요 시 매장가 입력
6. `실시간 가격 조사` 1회 실행
7. 출처가 검증된 가격과 실제 판매처 링크 확인
8. 리셀 제품은 같은 흐름에서 사이즈를 선택해 시세 확인

## 발표용 핵심 문장
> AI가 가격을 추측하는 서비스가 아니라, AI가 제품을 이해하고 실제 웹 출처가 가격을 증명하도록 설계한 가격 검증 도구입니다.

Preview: https://pricecheck-git-v100-ai-championship-haneulk1004s-projects.vercel.app/
