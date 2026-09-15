export default async function handler(req,res){
  try{
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',{
      method:'POST',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
      body:JSON.stringify({contents:[{parts:[{text:'Use Google Image Search to find visual evidence for the exact Korean retail product 해태 갈아만든 배 340ml. Use only images that clearly show this exact drink and 340ml can. Reply only: exact product image found.'}]}],tools:[{google_search:{searchTypes:{webSearch:{},imageSearch:{}}}}],generationConfig:{responseModalities:['TEXT'],maxOutputTokens:100}})
    });
    const data=await response.json();const meta=data?.candidates?.[0]?.groundingMetadata||{};
    const image=(meta.groundingChunks||[]).map(c=>c?.image).find(i=>i?.imageUri&&i?.sourceUri&&/340\s*ml/i.test(String(i.title||'').replace(/<[^>]+>/g,' ')));
    if(!image)return res.status(422).json({ok:false,error:'no exact image chunk'});
    const imageResponse=await fetch(image.imageUri,{redirect:'follow',signal:AbortSignal.timeout(10000)});
    return res.status(200).json({ok:imageResponse.ok&&String(imageResponse.headers.get('content-type')||'').startsWith('image/'),imageStatus:imageResponse.status,imageContentType:imageResponse.headers.get('content-type')||'',title:image.title,domain:image.domain,sourceUri:image.sourceUri,imageUri:image.imageUri,hasSearchEntryPoint:Boolean(meta.searchEntryPoint?.renderedContent)});
  }catch(error){return res.status(500).json({ok:false,error:error?.message||'failed'});}
}
