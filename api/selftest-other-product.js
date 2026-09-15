import { createIdentifyHandler } from './identify.js';
import researchHandler from './research.js';

function captureRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.payload = data; return data; }
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const identifyReq = { method: 'POST', body: { query: 'CW2288-111' }, headers: {} };
  const identifyRes = captureRes();
  await createIdentifyHandler()(identifyReq, identifyRes);
  const identified = identifyRes.payload || {};

  let imageStatus = 0;
  let imageContentType = '';
  if (identified.imageUrl) {
    try {
      const imageResponse = await fetch(identified.imageUrl, {
        method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(7000),
        headers: { Range: 'bytes=0-1023', 'User-Agent': 'PRICE_CHECK/1.0 cross-product-selftest' }
      });
      imageStatus = imageResponse.status;
      imageContentType = imageResponse.headers.get('content-type') || '';
    } catch {}
  }
  const imageOk = Boolean(identified.imageUrl) && imageStatus >= 200 && imageStatus < 400 && imageContentType.startsWith('image/');

  const researchReq = {
    method: 'POST',
    body: {
      mode: 'store',
      brand: identified.brand || 'Nike',
      productName: identified.productName || "Air Force 1 '07",
      modelCode: identified.modelCode || 'CW2288-111',
      size: ''
    },
    headers: { 'x-forwarded-for': '203.0.113.77' },
    socket: { remoteAddress: '203.0.113.77' }
  };
  const researchRes = captureRes();
  await researchHandler(researchReq, researchRes);
  const research = researchRes.payload || {};
  const offers = Array.isArray(research.offers) ? research.offers : [];
  const priceOk = researchRes.statusCode === 200 && offers.length > 0 && offers.every(o => Number.isFinite(Number(o.priceKRW)) && Array.isArray(o.sources) && o.sources.length > 0);

  const ok = identifyRes.statusCode === 200 && imageOk && priceOk;
  return res.status(ok ? 200 : 422).json({
    ok,
    identification: {
      status: identifyRes.statusCode,
      brand: identified.brand || '',
      productName: identified.productName || '',
      modelCode: identified.modelCode || '',
      imageProvider: identified.imageProvider || '',
      imageOk,
      imageStatus,
      imageContentType
    },
    research: {
      status: researchRes.statusCode,
      code: research.code || '',
      offerCount: offers.length,
      offers: offers.map(o => ({ seller: o.seller, priceKRW: o.priceKRW, sourceCount: o.sources?.length || 0 }))
    }
  });
}
