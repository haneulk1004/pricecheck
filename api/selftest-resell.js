import researchHandler from './research.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  const syntheticReq = {
    method: 'POST',
    body: { mode: 'resell', brand: 'Nike', productName: "Air Force 1 '07", modelCode: 'CW2288-111', size: '260' },
    headers: req.headers,
    socket: req.socket
  };
  return researchHandler(syntheticReq, res);
}
