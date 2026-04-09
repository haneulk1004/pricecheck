# ⚡ PRICE_CHECK | V90 (User Key)

**PRICE_CHECK**는 Google Gemini API를 활용하여 이미지나 텍스트만으로 제품을 식별하고, 국내 주요 커머스 플랫폼의 시장 가격을 실시간으로 추정하여 비교해주는 AI 엔진 기반 가격 분석 도구입니다.

---

## 🚀 Key Features

* **AI Product Identification**: 이미지를 촬영하거나 업로드하면 Gemini AI가 제품명을 정확히 찾아냅니다.
* **Multi-Platform Price Estimation**: 네이버, KREAM, 쿠팡, 무신사 등 10개 이상의 주요 플랫폼 데이터를 기반으로 예상 가격을 산출합니다.
* **Visual Data Analytics**: Chart.js를 활용하여 플랫폼별 가격 차이를 한눈에 파악할 수 있는 막대 그래프를 제공합니다.
* **Favorites System**: 관심 있는 제품을 보관함에 저장하고 언제든 다시 확인할 수 있습니다. (LocalStorage 기반)
* **User API Key Management**: 사용자 본인의 Gemini API Key를 사용하여 보안성을 높이고 사용량을 직접 관리합니다.

---

## 🛠 Tech Stack

- **Frontend**: React (v18), Tailwind CSS
- **AI Engine**: Google Gemini 2.5 Flash
- **Data Visualization**: Chart.js
- **Icons**: Lucide Icons
- **Deployment**: HTML Single Page Application (Babel Standalone)

---

## 📖 How to Use

1.  **API Key 발급**: [Google AI Studio](https://aistudio.google.com/app/apikey)에서 API 키를 발급받습니다.
2.  **시스템 접속**: 앱 실행 후 첫 화면에서 발급받은 API 키를 입력합니다.
3.  **제품 검색**:
    * **Text Search**: 검색창에 제품명을 직접 입력합니다.
    * **Visual Search**: 카메라로 제품을 촬영하거나 이미지를 업로드합니다.
4.  **결과 확인**: AI가 분석한 제품명과 추정 가격 차트를 확인하고, 각 플랫폼 링크로 직접 이동하여 상세 가격을 비교합니다.
5.  **보관**: 하트 아이콘을 눌러 나만의 가격 리스트를 만듭니다.

---

## ⚠️ Important Note

* 본 앱에서 제공하는 가격은 AI의 지식 베이스를 기반으로 한 **추정가**입니다. 실제 실시간 판매가와 차이가 있을 수 있으므로 최종 구매 전 반드시 공식 판매처를 확인하십시오.
* 사용자의 API 키는 브라우저의 `localStorage`에만 안전하게 저장되며 외부 서버로 전송되지 않습니다.

---

## ⚖️ License

Copyright © 2026 PRICE_CHECK. All rights reserved.
