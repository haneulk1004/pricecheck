import { cacheKey, normalizeInput, redisCommand } from '../lib/price-research.js';
import { alignOfferSources } from './research.js';

function host(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const input = normalizeInput({ mode: 'store', brand: 'Logitech', productName: 'MX Keys Mini', modelCode: '', size: '' });
  const key = cacheKey(input);
  const raw = await redisCommand(['GET', key], process.env, fetch, console.info);
  if (!raw) return res.status(404).json({ cached: false });
  const payload = JSON.parse(raw);
  const before = (payload.offers || []).map(offer => ({ seller: offer.seller, hosts: (offer.sources || []).map(source => host(source.url)) }));
  const aligned = alignOfferSources(payload);
  const after = (aligned.offers || []).map(offer => ({ seller: offer.seller, hosts: (offer.sources || []).map(source => host(source.url)) }));
  return res.status(200).json({ cached: true, before, after });
}
