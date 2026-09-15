import { createIdentifyHandler } from './identify.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  let statusCode=200;
  let payload=null;
  const innerRes={
    setHeader(){},
    status(code){statusCode=code;return this;},
    json(data){payload=data;return this;}
  };
  const identify=createIdentifyHandler();
  await identify({method:'POST',body:{query:'아이폰 17 프로'}},innerRes);
  return res.status(statusCode).json({ok:statusCode===200,product:payload});
}
