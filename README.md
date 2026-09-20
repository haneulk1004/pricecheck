# PRICE_CHECK V100

> 사진이나 제품명으로 상품을 확인하고, 공개 출처가 뒷받침하는 온라인·리셀 가격만 보여주는 AI 가격 검증 서비스

[서비스 실행하기](https://pricecheck-git-v100-ai-championship-haneulk1004s-projects.vercel.app/) · [최종 제출 기록](https://github.com/haneulk1004/pricecheck/blob/v100-ai-championship/docs/submission/PRICE_CHECK_V100_FINAL_HANDOFF_2026-09-20.md)

![PRICE_CHECK V100 홈 화면](https://raw.githubusercontent.com/haneulk1004/pricecheck/v100-ai-championship/docs/submission/screenshots/pricecheck-submit-01-home-16x9.jpg)

## 서비스가 해결하는 문제

매장에서 본 제품의 정확한 온라인 가격을 확인하려면 모델과 옵션을 다시 찾고 여러 판매처를 비교해야 합니다. 검색 결과에는 다른 용량·수량·사이즈와 유사 상품이 섞이기 때문에 실제 구매 가능한 가격을 빠르게 판단하기 어렵습니다.

PRICE_CHECK는 제품 식별부터 가격 근거 확인까지 하나의 흐름으로 연결합니다.

## 주요 기능

- **사진 기반 제품 식별**: 촬영하거나 업로드한 사진에서 브랜드·제품명·용량을 확인합니다.
- **직접 검색**: 사진 없이 제품명이나 모델명을 직접 입력할 수 있습니다.
- **사용자 확인 단계**: AI가 찾은 정보를 사용자가 확인하고 필요한 경우 수정합니다.
- **매장 가격검증**: 매장에서 본 가격과 공개된 온라인 판매가를 비교합니다.
- **리셀 시세 확인**: 선택한 사이즈와 일치하는 공개 리셀 가격을 조사합니다.
- **근거 기반 결과**: 가격 숫자를 뒷받침하는 출처와 판매처가 일치하는 결과만 표시합니다.
- **즐겨찾기**: 확인한 제품을 브라우저에 보관할 수 있습니다.

## 이용 흐름

1. 제품 사진을 촬영·업로드하거나 제품명을 입력합니다.
2. Gemini가 브랜드·제품명·용량과 확인 가능한 모델 정보를 식별합니다.
3. 사용자가 식별 결과를 확인합니다.
4. `매장 가격검증` 또는 `리셀 시세`를 선택합니다.
5. Google Search Grounding이 현재 공개된 가격과 출처를 조사합니다.
6. 서버 검증을 통과한 가격만 판매처 링크와 함께 표시합니다.

## 가격을 다루는 원칙

PRICE_CHECK는 모든 제품의 최저가를 보장하거나 AI가 가격을 추정하는 서비스가 아닙니다.

- 제품명·브랜드·모델·용량·수량·사이즈가 요청과 일치해야 합니다.
- 가격 숫자를 직접 뒷받침하는 공개 출처가 있어야 합니다.
- 판매처 이름과 출처 도메인이 일치해야 합니다.
- 검색 결과, 카테고리, 종료된 행사, 다른 옵션 페이지는 가격 근거에서 제외합니다.
- 조건을 검증할 수 없으면 잘못된 가격 대신 `확인된 결과 없음`을 표시합니다.

## 검색 제한

- 새 실시간 가격 조사: IP당 하루 10회
- 서비스 전체 새 조사: 하루 300회
- 초기화: 한국시간 자정
- 동일 제품·모드·사이즈의 성공 결과: 24시간 재사용하며 횟수를 추가 차감하지 않음

사진 인식과 제품 정보 확인은 위 가격 조사 횟수와 별개입니다. 실제 가격, 배송비, 옵션, 재고와 거래 조건은 연결된 판매처에서 최종 확인해야 합니다.

## 기술 구성

| 영역 | 사용 기술 |
| --- | --- |
| 프런트엔드 | React 18, Tailwind CSS, Lucide Icons |
| AI | Gemini 3.8 Flash |
| 이미지 검색 보조 | Gemini 3.1 Flash Image |
| 검색 근거 | Google Search Grounding |
| 백엔드 | Vercel Serverless Functions |
| 캐시·사용량 제한 | Upstash Redis |
| 보안 | 서버 측 API 키, HMAC 기반 IP 해시 |
| 개발·검증 지원 | ChatGPT Codex |
| 배포 | Vercel |

## 검증 상태

- 자동 테스트 **87개 통과, 실패 0개**
- 잘못된 이미지 형식과 과도하게 큰 파일 차단
- 사진에서 보이지 않는 모델/SKU의 임의 추론 방지
- 다른 제품·용량·수량·사이즈의 가격 차단
- 가격 근거가 없는 citation과 판매처 불일치 차단
- 리셀 exact-size 근거가 없는 가격 차단
- 성공 결과 24시간 캐시 및 한국시간 기준 사용량 초기화 검증
- 비로그인 공개 서비스 접속 확인

테스트 실행:

```bash
pnpm install --frozen-lockfile
pnpm test
```

## 서버 환경 변수

배포 환경에서 다음 값을 설정해야 합니다. 실제 비밀 값은 저장소에 커밋하지 않습니다.

```text
GEMINI_API_KEY
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
IP_HASH_SECRET
```

조사 횟수와 모델은 환경 변수로 조정할 수 있습니다. 자세한 내용은 [가격 조사 설계 및 운영 문서](https://github.com/haneulk1004/pricecheck/blob/v100-ai-championship/docs/PRICE_RESEARCH.md)를 참고하세요.

## 현재 한계

- 외부 검색과 판매처 페이지 상태에 따라 응답이 지연되거나 결과가 없을 수 있습니다.
- 검증 규칙이 엄격해 잘못된 가격 대신 빈 결과가 표시될 수 있습니다.
- 모든 제품군을 대상으로 상용 수준의 검색 성공률을 보장하지 않습니다.
- 공식 쇼핑 API와 판매처별 정식 API 연동은 후속 개선 과제입니다.

## 저장소 안내

- 실제 서비스 코드: [`v100-ai-championship`](https://github.com/haneulk1004/pricecheck/tree/v100-ai-championship)
- 제출 문서와 16:9 이미지: [`docs/submission`](https://github.com/haneulk1004/pricecheck/tree/v100-ai-championship/docs/submission)
- 공개 서비스: [PRICE_CHECK V100](https://pricecheck-git-v100-ai-championship-haneulk1004s-projects.vercel.app/)

## License

Copyright © 2026 PRICE_CHECK. All rights reserved.
