# PRICE_CHECK V100

Working branch for the Wanted AI Championship 2026 version of PRICE_CHECK.

Current focus:
- Server-side Gemini product identification
- No client-side API key entry
- Grounded price research using Gemini 3.8 Flash and Google Search
- Upstash 24-hour cache and atomic daily limits (5/IP, 300 total, KST reset)
- HMAC-only IP storage and source-backed price validation
- Store price verification mode
- Resell price lookup mode
- Live research button, per-price citations and Google Search Suggestions

This file also marks the first Vercel Preview deployment trigger after the repository was connected to Vercel.
