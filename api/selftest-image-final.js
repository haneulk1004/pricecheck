import { resolveProductImage } from './identify.js';

export default async function handler(req,res){
  try{
    const result=await resolveProductImage('갈아만든 배 340ml',fetch,{
      brand:'해태',
      query:'해태 갈아만든 배 340ml',
      apiKey:process.env.GEMINI_API_KEY
    });
    let imageStatus=0;
    let imageContentType='';
    if(result?.imageUrl){
      try{
        const r=await fetch(result.imageUrl,{redirect:'follow',signal:AbortSignal.timeout(8000),headers:{'User-Agent':'Mozilla/5.0'}});
        imageStatus=r.status;
        imageContentType=r.headers.get('content-type')||'';
      }catch{}
    }
    return res.status(200).json({
      provider:result?.imageProvider||'',
      hasImage:Boolean(result?.imageUrl),
      hasSource:Boolean(result?.imageSourceUrl),
      hasSearchSuggestions:Boolean(result?.imageSearchSuggestionsHtml),
      imageStatus,
      imageContentType
    });
  }catch(error){
    return res.status(500).json({error:error?.message||'failed'});
  }
}
