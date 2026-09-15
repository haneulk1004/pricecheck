import researchHandler from './research.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  const syntheticReq = {
    method: 'POST',
    body: { mode: 'store', brand: 'Logitech', productName: 'MX Keys Mini', modelCode: '', size: '' },
    headers: req.headers,
    socket: req.socket
  };
  return researchHandler(syntheticReq, res);
}
