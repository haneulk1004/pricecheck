import { resolveProductImage } from './identify.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  const image=await resolveProductImage('iPhone 17 Pro');
  if(!image?.imageUrl) return res.status(422).json({ok:false,image});
  let imageStatus=0,contentType='';
  try{
    const response=await fetch(image.imageUrl,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(7000),headers:{Range:'bytes=0-1023','User-Agent':'PRICE_CHECK/1.0 image-selftest'}});
    imageStatus=response.status;
    contentType=response.headers.get('content-type') || '';
  }catch{}
  return res.status(imageStatus>=200 && imageStatus<400 && contentType.startsWith('image/')?200:422).json({ok:imageStatus>=200 && imageStatus<400 && contentType.startsWith('image/'),image,imageStatus,contentType});
}
