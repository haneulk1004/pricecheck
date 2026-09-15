export default async function handler(req,res){
  const imageUri='https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQElL80ZWsmaqakucvJsb563PHJ2gfV46gekua1bcluGo8xY9Av2ECTQfewdJ85rT5BgOkbJBM3D8QVj0FHGau9rG5SMckgE0p5RvgKaETGQe1CAElyPOsnDTNAmxPGcMTlnU-oGUEiGn_pBrpxINffLw6xqyEDwlBUDehXXySgcp4s_CUCALSV2r1GbJw==';
  try{
    const response=await fetch(imageUri,{redirect:'follow',signal:AbortSignal.timeout(10000)});
    return res.status(200).json({ok:response.ok&&String(response.headers.get('content-type')||'').startsWith('image/'),status:response.status,contentType:response.headers.get('content-type')||'',finalUrl:response.url});
  }catch(error){return res.status(500).json({ok:false,error:error?.message||'failed'});}
}
