export default async function handler(req,res){
  try{
    const url='https://world.openfoodfacts.org/cgi/search.pl?search_terms='+encodeURIComponent('해태 갈아만든 배 340ml')+'&search_simple=1&action=process&json=1&page_size=8&fields=code,product_name,brands,quantity,image_front_url,image_url';
    const response=await fetch(url,{signal:AbortSignal.timeout(10000),headers:{'User-Agent':'PRICE_CHECK/1.0 (https://github.com/haneulk1004/pricecheck)'}});
    const data=await response.json();
    return res.status(response.ok?200:response.status).json({ok:response.ok,count:data?.count||0,products:(data?.products||[]).map(p=>({code:p.code,name:p.product_name,brands:p.brands,quantity:p.quantity,image:p.image_front_url||p.image_url||''})).slice(0,8)});
  }catch(error){return res.status(500).json({ok:false,error:error?.message||'failed'});}
}
