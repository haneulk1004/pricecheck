function strip(value=''){return String(value).replace(/<[^>]+>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim();}
export default async function handler(req,res) {
  try {
    const url='https://search.danawa.com/dsearch.php?query='+encodeURIComponent('해태 갈아만든 배 340ml');
    const response=await fetch(url,{signal:AbortSignal.timeout(10000),headers:{'User-Agent':'Mozilla/5.0 (compatible; PRICE_CHECK/1.0)','Accept':'text/html'}});
    const html=await response.text();
    const blocks=[...html.matchAll(/<li\b[^>]*class=["'][^"']*prod_item[^"']*["'][^>]*>[\s\S]*?<\/li>/gi)].slice(0,8).map(m=>m[0]);
    const items=blocks.map(block=>{
      const name=strip(block.match(/<p\b[^>]*class=["'][^"']*prod_name[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]||'');
      const img=block.match(/<img\b[^>]*(?:data-original|data-src|src)=["']([^"']+)["'][^>]*>/i)?.[1]||'';
      const link=block.match(/<p\b[^>]*class=["'][^"']*prod_name[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["']/i)?.[1]||'';
      return {name,img,link};
    });
    return res.status(200).json({ok:response.ok,status:response.status,contentType:response.headers.get('content-type'),htmlLength:html.length,blockCount:blocks.length,items});
  } catch(error){return res.status(500).json({ok:false,error:error?.message||'failed'});}
}
