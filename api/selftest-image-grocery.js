import { resolveProductImage } from './identify.js';

export default async function handler(req,res){
  try{
    const image=await resolveProductImage('갈아만든 배 340ml',fetch,{brand:'해태',query:'해태 갈아만든 배 340ml',apiKey:process.env.GEMINI_API_KEY});
    const ok=Boolean(image.imageUrl&&image.imageSourceUrl&&image.imageProvider&&image.imageSearchSuggestionsHtml);
    return res.status(ok?200:422).json({ok,provider:image.imageProvider,imageUrl:image.imageUrl,imageSourceUrl:image.imageSourceUrl,hasSearchSuggestions:Boolean(image.imageSearchSuggestionsHtml)});
  }catch(error){return res.status(500).json({ok:false,error:error?.message||'failed'});}
}
