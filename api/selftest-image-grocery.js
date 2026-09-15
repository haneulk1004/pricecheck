import { resolveProductImage } from './identify.js';

export default async function handler(req,res){
  try{
    const image=await resolveProductImage('갈아만든 배 340ml',fetch,{brand:'해태',query:'해태 갈아만든 배 340ml',apiKey:process.env.GEMINI_API_KEY});
    let status=0,contentType='';
    if(image.imageUrl){
      const response=await fetch(image.imageUrl,{redirect:'follow',signal:AbortSignal.timeout(8000)});
      status=response.status;contentType=response.headers.get('content-type')||'';
    }
    const ok=Boolean(image.imageUrl&&status>=200&&status<400&&contentType.startsWith('image/'));
    return res.status(ok?200:422).json({ok,provider:image.imageProvider,imageUrl:image.imageUrl,imageSourceUrl:image.imageSourceUrl,imageStatus:status,imageContentType:contentType});
  }catch(error){return res.status(500).json({ok:false,error:error?.message||'failed'});}
}
