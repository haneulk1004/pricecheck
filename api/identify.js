const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const IMAGE_SEARCH_MODEL = 'gemini-3.1-flash-image';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const IMAGE_SEARCH_URL = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_SEARCH_MODEL}:generateContent`;

function extractJson(text='') {
  const cleaned = String(text).replace(/```json/gi,'').replace(/```/g,'').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 응답에서 JSON을 찾지 못했습니다.');
  return JSON.parse(match[0]);
}

function clean(value, max=160) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/gu,' ').trim().slice(0,max) : '';
}

function outputBlocks(data) {
  return (data?.steps || []).flatMap(step => step?.type === 'model_output' ? (step.content || []) : []).filter(item => item?.type === 'text');
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === '::1') return null;
    return url;
  } catch {
    return null;
  }
}

function normalizedLabel(value='') {
  return String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
}

function fileBaseTitle(title='') {
  return String(title).replace(/^File:/i,'').replace(/\.[a-z0-9]{2,5}$/i,'').trim();
}

function decodeHtml(value='') {
  return String(value).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}

function stripHtml(value='') {
  return decodeHtml(String(value).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
}

function metaImage(html='') {
  const tags = String(html).match(/<meta\b[^>]*>/gi) || [];
  for (const wanted of ['og:image','twitter:image','twitter:image:src']) {
    for (const tag of tags) {
      const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (key !== wanted) continue;
      const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
      if (content) return decodeHtml(content);
    }
  }
  return '';
}

async function imageFromOfficialPage(pageUrl, fetchImpl, provider='official') {
  const page = safeHttpsUrl(pageUrl);
  if (!page) return null;
  try {
    const response = await fetchImpl(page.href, {
      method:'GET', redirect:'follow', signal:AbortSignal.timeout(4500),
      headers:{'User-Agent':'Mozilla/5.0 (compatible; PRICE_CHECK/1.0; +https://github.com/haneulk1004/pricecheck)','Accept':'text/html,application/xhtml+xml'}
    });
    if (!response?.ok || !String(response.headers?.get?.('content-type') || '').toLowerCase().includes('text/html') || typeof response.text !== 'function') return null;
    const finalUrl = safeHttpsUrl(response.url || page.href);
    if (!finalUrl) return null;
    const candidate = metaImage((await response.text()).slice(0,1500000));
    if (!candidate) return null;
    const image = safeHttpsUrl(new URL(candidate, finalUrl).href);
    return image ? {imageUrl:image.href,imageSourceUrl:finalUrl.href,imageProvider:provider} : null;
  } catch {
    return null;
  }
}

async function wikidataProductImage(productName, fetchImpl) {
  const name = clean(productName,160);
  if (!name) return null;
  try {
    const searchUrl = new URL(WIKIDATA_API);
    searchUrl.search = new URLSearchParams({action:'wbsearchentities',search:name,language:'en',uselang:'en',type:'item',limit:'8',format:'json',origin:'*'}).toString();
    const searchResponse = await fetchImpl(searchUrl.href,{signal:AbortSignal.timeout(4000),headers:{'User-Agent':'PRICE_CHECK/1.0 product-preview'}});
    if (!searchResponse?.ok) return null;
    const searchData = await searchResponse.json();
    const target = normalizedLabel(name);
    const match = (searchData?.search || []).find(item => normalizedLabel(item?.label) === target || (item?.aliases || []).some(alias => normalizedLabel(alias) === target));
    if (!match?.id) return null;

    const entityUrl = new URL(WIKIDATA_API);
    entityUrl.search = new URLSearchParams({action:'wbgetentities',ids:match.id,props:'claims|labels|aliases',languages:'en',format:'json',origin:'*'}).toString();
    const entityResponse = await fetchImpl(entityUrl.href,{signal:AbortSignal.timeout(4000),headers:{'User-Agent':'PRICE_CHECK/1.0 product-preview'}});
    if (!entityResponse?.ok) return null;
    const entity = (await entityResponse.json())?.entities?.[match.id];
    const labels = [entity?.labels?.en?.value,...(entity?.aliases?.en || []).map(item => item?.value)].filter(Boolean);
    if (!entity || !labels.some(label => normalizedLabel(label) === target)) return null;

    const official = entity?.claims?.P856?.map(claim => claim?.mainsnak?.datavalue?.value).find(Boolean);
    if (official) {
      const officialImage = await imageFromOfficialPage(official,fetchImpl,'official');
      if (officialImage) return officialImage;
    }

    const filename = entity?.claims?.P18?.map(claim => claim?.mainsnak?.datavalue?.value).find(Boolean);
    if (typeof filename === 'string' && filename.trim()) {
      const encoded = encodeURIComponent(filename.replace(/ /g,'_'));
      return {
        imageUrl:`https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/${encoded}&width=900`,
        imageSourceUrl:`https://commons.wikimedia.org/wiki/File:${encoded}`,
        imageProvider:'wikidata'
      };
    }
  } catch {}
  return null;
}

async function commonsProductImage(productName, fetchImpl) {
  const name = clean(productName,160);
  const target = normalizedLabel(name);
  if (!name || target.length < 4) return null;
  try {
    const url = new URL(COMMONS_API);
    url.search = new URLSearchParams({
      action:'query', generator:'search', gsrsearch:`intitle:\"${name.replace(/[\"\\]/g,' ')}\"`,
      gsrnamespace:'6', gsrlimit:'12', prop:'imageinfo', iiprop:'url|mime', iiurlwidth:'900', format:'json', origin:'*'
    }).toString();
    const response = await fetchImpl(url.href,{signal:AbortSignal.timeout(5000),headers:{'User-Agent':'PRICE_CHECK/1.0 product-preview'}});
    if (!response?.ok) return null;
    const pages = Object.values((await response.json())?.query?.pages || {});
    const candidates = pages.map(page => {
      const info = page?.imageinfo?.[0];
      const base = fileBaseTitle(page?.title);
      const normalized = normalizedLabel(base);
      const imageUrl = safeHttpsUrl(info?.thumburl || info?.url);
      const sourceUrl = safeHttpsUrl(info?.descriptionurl);
      const mime = String(info?.mime || '').toLowerCase();
      const exact = normalized === target;
      const close = normalized.startsWith(target) && !/(logo|wordmark|screen|case|comparison|backside|back$)/i.test(base.slice(name.length));
      return {exact,close,imageUrl,sourceUrl,mime,base};
    }).filter(item => item.imageUrl && item.sourceUrl && item.mime.startsWith('image/') && (item.exact || item.close));
    candidates.sort((a,b) => Number(b.exact)-Number(a.exact) || Number(/jpe?g|png/.test(b.mime))-Number(/jpe?g|png/.test(a.mime)) || a.base.length-b.base.length);
    const best = candidates[0];
    return best ? {imageUrl:best.imageUrl.href,imageSourceUrl:best.sourceUrl.href,imageProvider:'wikimedia-commons'} : null;
  } catch {
    return null;
  }
}

function variantTokens(value='') {
  return [...String(value).normalize('NFKC').matchAll(/\b\d+(?:[.,]\d+)?\s*(?:ML|L|MG|G|KG|GB|TB|MM|CM|INCH|인치|개|입)\b/giu)].map(match => normalizedLabel(match[0]));
}

function imageTitleScore(title, query) {
  const visible = stripHtml(title);
  const normalizedTitle = normalizedLabel(visible);
  const variants = variantTokens(query);
  if (variants.some(token => !normalizedTitle.includes(token))) return -1;
  const words = clean(query,220).split(/\s+/u)
    .map(word => normalizedLabel(word))
    .filter(word => word.length >= 2 && !variants.includes(word));
  const uniqueWords = [...new Set(words)];
  const matched = uniqueWords.filter(word => normalizedTitle.includes(word)).length;
  const required = Math.min(2, uniqueWords.length);
  return matched >= required ? matched + variants.length * 4 : -1;
}

async function verifiedGroundedImage(image, fetchImpl) {
  const imageUri = safeHttpsUrl(image?.imageUri);
  const sourceUri = safeHttpsUrl(image?.sourceUri);
  if (!imageUri || !sourceUri) return null;
  try {
    const response = await fetchImpl(imageUri.href,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(7000)});
    const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
    const finalImage = safeHttpsUrl(response?.url || imageUri.href);
    if (!response?.ok || !contentType.startsWith('image/') || !finalImage) return null;
    return {imageUrl:finalImage.href,imageSourceUrl:sourceUri.href,imageProvider:'google-image-search'};
  } catch {
    return null;
  }
}

async function googleImageSearchProduct({productName,brand,query,apiKey}, fetchImpl) {
  if (!apiKey) return null;
  const exactQuery = clean(query,220) || [clean(brand,80),clean(productName,160)].filter(Boolean).join(' ');
  if (!exactQuery) return null;
  const prompt = [
    'Use Google Image Search to find visual evidence for this exact retail product.',
    'Only use images whose result title matches the same product and every explicit model, capacity, volume, size, pack count, edition or other price-defining variant in the query.',
    'Reject accessories, logos, screenshots, articles and different variants.',
    'Reply only: exact product image found.',
    `Product query: ${JSON.stringify(exactQuery)}`
  ].join(' ');
  try {
    const response = await fetchImpl(IMAGE_SEARCH_URL,{
      method:'POST',signal:AbortSignal.timeout(18000),
      headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
      body:JSON.stringify({
        contents:[{parts:[{text:prompt}]}],
        tools:[{google_search:{searchTypes:{webSearch:{},imageSearch:{}}}}],
        generationConfig:{responseModalities:['TEXT'],maxOutputTokens:100}
      })
    });
    if (!response?.ok) return null;
    const data = await response.json();
    const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const candidates = chunks.map(chunk => chunk?.image).filter(Boolean)
      .map(image => ({image,score:imageTitleScore(image.title,exactQuery)}))
      .filter(item => item.score >= 0)
      .sort((a,b) => b.score-a.score);
    for (const {image} of candidates.slice(0,4)) {
      const verified = await verifiedGroundedImage(image,fetchImpl);
      if (verified) return verified;
    }
  } catch {}
  return null;
}

export async function resolveProductImage(productName, fetchImpl=fetch, context={}) {
  const [wikidata,commons] = await Promise.all([
    wikidataProductImage(productName,fetchImpl),
    commonsProductImage(productName,fetchImpl)
  ]);
  return wikidata || commons ||
    (await googleImageSearchProduct({productName,...context},fetchImpl)) ||
    {imageUrl:'',imageSourceUrl:'',imageProvider:''};
}

export function createIdentifyHandler({ env = process.env, fetchImpl = fetch, log = console.info } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control','no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow','POST');
      return res.status(405).json({ error:'POST 요청만 지원합니다.' });
    }
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error:'서버의 GEMINI_API_KEY가 설정되지 않았습니다.' });
    const query = clean(req.body?.query, 160);
    if (!query) return res.status(400).json({ error:'검색어를 확인해주세요.' });

    const prompt = `
You are the product-identification engine for PRICE_CHECK, a Korean shopping price verification service.
The user entered a manual product query. Normalize it into structured product data.
Use only information strongly implied by the query. Do not invent a brand or model code.
If the query is itself a model/style/SKU code and you can confidently identify the commercial product from your knowledge, return the likely brand/product/model. Otherwise preserve the query as productName and leave uncertain fields empty.
Prefer the product's canonical English commercial name in productName when it is well known, because PRICE_CHECK uses exact public metadata matching for the preview image.
Preserve price-defining variants explicitly written by the user, including storage/capacity, volume, pack count, size, edition, generation, color when it changes the SKU, and model suffix. Never drop an explicit variant from productName or searchQuery.
Return JSON ONLY in this exact shape:
{
  "brand":"",
  "productName":"",
  "modelCode":"",
  "category":"",
  "confidence":0,
  "searchQuery":""
}
Rules:
- confidence integer 0-100.
- modelCode must never be fabricated.
- searchQuery should be concise and prioritize brand + product + model code + any explicit price-defining variant.
- Do not return prices or image URLs.
Manual query: ${JSON.stringify(query)}
`;

    try {
      const response = await fetchImpl(INTERACTIONS_URL, {
        method:'POST',
        signal:AbortSignal.timeout(30000),
        headers:{'Content-Type':'application/json','x-goog-api-key':apiKey,'Api-Revision':'2026-05-20'},
        body:JSON.stringify({model:env.GEMINI_MODEL || MODEL,store:false,input:prompt})
      });
      const data = await response.json();
      if (!response.ok) {
        log(JSON.stringify({event:'pricecheck_identify',outcome:'provider_error',status:response.status}));
        return res.status(502).json({ error:'제품 정보를 확인하지 못했습니다. 직접 수정해서 계속 진행할 수 있습니다.' });
      }
      const rawText = data?.output_text || outputBlocks(data)[0]?.text;
      if (!rawText) throw new Error('empty');
      const parsed = extractJson(rawText);
      const productName = clean(parsed.productName,160) || query;
      const brand = clean(parsed.brand,80);
      const searchQuery = clean(parsed.searchQuery,200) || query;
      const image = await resolveProductImage(productName,fetchImpl,{brand,query:[query,searchQuery].filter(Boolean).join(' '),apiKey});
      const result = {
        brand,
        productName,
        modelCode:clean(parsed.modelCode,80),
        category:clean(parsed.category,80),
        confidence:Math.max(0,Math.min(100,Math.round(Number(parsed.confidence)||0))),
        searchQuery,
        imageUrl:image.imageUrl,
        imageSourceUrl:image.imageSourceUrl,
        imageProvider:image.imageProvider
      };
      log(JSON.stringify({event:'pricecheck_identify',outcome:'success',imageProvider:result.imageProvider || 'none'}));
      return res.status(200).json(result);
    } catch (error) {
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      log(JSON.stringify({event:'pricecheck_identify',outcome:timeout?'TIMEOUT':'IDENTIFY_FAILED'}));
      return res.status(timeout?504:502).json({ error:'제품 정보를 자동 확인하지 못했습니다. 직접 수정해서 계속 진행할 수 있습니다.' });
    }
  };
}

export default createIdentifyHandler();
