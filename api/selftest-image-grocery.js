export default async function handler(req,res) {
  try {
    const prompt = 'Use Google Search to find the exact Korean retailer product page for 해태 갈아만든 배 340ml. The page must visibly match 해태, 갈아만든 배 and 340ml. In your answer write exactly two lines: first the exact product name, second the canonical destination URL beginning https:// as shown by the search result. Also cite the exact product page inline. Do not output a Google or vertexaisearch redirect URL.';
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
      method:'POST',signal:AbortSignal.timeout(20000),
      headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY,'Api-Revision':'2026-05-20'},
      body:JSON.stringify({model:process.env.GEMINI_MODEL || 'gemini-3.8-flash',store:false,input:prompt,tools:[{type:'google_search',search_types:['web_search']}],generation_config:{max_output_tokens:1200}})
    });
    const data = await response.json();
    const outputs = (data?.steps || []).filter(step=>step?.type==='model_output').flatMap(step=>step.content || []).filter(block=>block?.type==='text').map(block=>({text:block.text,annotations:(block.annotations || []).map(a=>({type:a.type,url:a.url,title:a.title}))}));
    return res.status(response.ok?200:response.status).json({ok:response.ok,status:data?.status,outputs});
  } catch(error) {
    return res.status(500).json({ok:false,error:error?.message || 'diagnostic failed'});
  }
}
