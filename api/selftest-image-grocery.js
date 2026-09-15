import { resolveProductImage } from './identify.js';

export default async function handler(req,res) {
  try {
    const image = await resolveProductImage('갈아만든 배 340ml', fetch, {
      brand:'해태',
      query:'해태 갈아만든 배 340ml',
      apiKey:process.env.GEMINI_API_KEY,
      model:process.env.GEMINI_MODEL || 'gemini-3.8-flash'
    });
    let imageStatus = 0;
    let imageContentType = '';
    if (image.imageUrl) {
      const response = await fetch(image.imageUrl,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(8000)});
      imageStatus = response.status;
      imageContentType = response.headers.get('content-type') || '';
    }
    return res.status(image.imageUrl && imageStatus >= 200 && imageStatus < 400 && imageContentType.startsWith('image/') ? 200 : 422).json({
      ok:Boolean(image.imageUrl && imageStatus >= 200 && imageStatus < 400 && imageContentType.startsWith('image/')),
      provider:image.imageProvider,
      imageUrl:image.imageUrl,
      imageSourceUrl:image.imageSourceUrl,
      imageStatus,
      imageContentType
    });
  } catch (error) {
    return res.status(500).json({ok:false,error:error?.message || 'selftest failed'});
  }
}
