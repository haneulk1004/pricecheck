export default async function handler(req,res) {
  try {
    const prompt = 'Find an exact public product page for 해태 갈아만든 배 340ml using Google Search. Prefer a Korean retailer product page that visibly matches 해태, 갈아만든 배, and 340ml. Reply with one short Korean sentence stating the current product name and cite the exact product page inline. Do not cite a search page or article.';
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
      method:'POST',signal:AbortSignal.timeout(20000),
      headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY,'Api-Revision':'2026-05-20'},
      body:JSON.stringify({model:process.env.GEMINI_MODEL || 'gemini-3.8-flash',store:false,input:prompt,tools:[{type:'google_search',search_types:['web_search']}],generation_config:{max_output_tokens:1200}})
    });
    const data = await response.json();
    const outputs = (data?.steps || []).filter(step=>step?.type==='model_output').flatMap(step=>step.content || []).filter(block=>block?.type==='text').map(block=>({text:block.text,annotations:(block.annotations || []).map(a=>({type:a.type,url:a.url,title:a.title}))}));
    const stepTypes=(data?.steps || []).map(step=>step?.type);
    return res.status(response.ok?200:response.status).json({ok:response.ok,status:data?.status,stepTypes,outputs});
  } catch(error) {
    return res.status(500).json({ok:false,error:error?.message || 'diagnostic failed'});
  }
}
