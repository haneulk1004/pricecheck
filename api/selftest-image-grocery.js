export default async function handler(req,res) {
  try {
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',{
      method:'POST',signal:AbortSignal.timeout(30000),
      headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
      body:JSON.stringify({
        contents:[{parts:[{text:'Use Google Image Search to find visual evidence for the exact Korean retail product 해태 갈아만든 배 340ml. Use only images that clearly show this exact drink and 340ml can, not another flavor or size. Reply only: exact product image found.'}]}],
        tools:[{google_search:{searchTypes:{webSearch:{},imageSearch:{}}}}],
        generationConfig:{responseModalities:['TEXT'],maxOutputTokens:100}
      })
    });
    const data=await response.json();
    const meta=data?.candidates?.[0]?.groundingMetadata || {};
    const chunks=(meta.groundingChunks || []).map(chunk=>({
      web:chunk.web?{uri:chunk.web.uri,title:chunk.web.title}:null,
      image:chunk.image?{uri:chunk.image.uri,image_uri:chunk.image.image_uri||chunk.image.imageUri,title:chunk.image.title}:null
    }));
    return res.status(response.ok?200:response.status).json({ok:response.ok,error:data?.error?.message||'',finishReason:data?.candidates?.[0]?.finishReason,imageSearchQueries:meta.imageSearchQueries||[],hasSearchEntryPoint:Boolean(meta.searchEntryPoint?.renderedContent),chunks});
  } catch(error){return res.status(500).json({ok:false,error:error?.message||'failed'});}
}
