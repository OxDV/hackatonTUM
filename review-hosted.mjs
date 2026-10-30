const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
export async function handle(request,env,assets){
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&assets[path]){const a=assets[path],body=a.encoding==='base64'?Uint8Array.from(atob(a.body),c=>c.charCodeAt(0)):a.body;return new Response(body,{headers:{...headers,'Content-Type':a.type}});}
 if(!env.BUCKET)return reply({error:'Storage unavailable'},503);
 if(path==='/api/publish'&&request.method==='POST'){
  if(!env.REVIEW_UPLOAD_KEY||request.headers.get('Authorization')!=='Bearer '+env.REVIEW_UPLOAD_KEY)return reply({error:'Unauthorized'},401);
  if(Number(request.headers.get('Content-Length'))>30*1024*1024)return reply({error:'Too large'},413);
  const chunks=[];let length=0;for await(const chunk of request.body){length+=chunk.byteLength;if(length>30*1024*1024)return reply({error:'Too large'},413);chunks.push(chunk);}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let input;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply({error:'Invalid JSON'},400);}
  const id=input.id;
  if(!uuid.test(id)||typeof input.report!=='string'||input.report.length>1000000||!Array.isArray(input.findings)||input.findings.length>100||!Array.isArray(input.documents)||![0,2].includes(input.documents.length))return reply({error:'Invalid report'},400);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const previous=await env.BUCKET.get(id+'/report.json');
  if(previous){const r=await previous.json();if(r.digest!==digest)return reply({error:'Report ID already used'},409);if(r.expiresAt<=Date.now())return reply({error:'Report expired'},410);return reply({id,expiresAt:r.expiresAt});}
  const documents=[];
  for(let i=0;i<input.documents.length;i++){
   const d=input.documents[i];if(typeof d.name!=='string'||d.name.length>512||typeof d.base64!=='string'||d.base64.length>14000000||!['offer','invoice',null].includes(d.role))return reply({error:'Invalid PDF'},400);
   let raw;try{raw=Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0));}catch{return reply({error:'Invalid PDF'},400);}
   if(raw.length>10*1024*1024||new TextDecoder().decode(raw.slice(0,5))!=='%PDF-')return reply({error:'Invalid PDF'},400);
   documents.push({name:d.name,role:d.role,index:i,raw});
  }
  const expiresAt=Date.now()+86400000;
  for(const d of documents)await env.BUCKET.put(id+'/'+d.index+'.pdf',d.raw,{httpMetadata:{contentType:'application/pdf'}});
  const report={report:input.report,findings:input.findings,documents:documents.map(({raw,...d})=>d),expiresAt,digest};
  await env.BUCKET.put(id+'/report.json',JSON.stringify(report),{httpMetadata:{contentType:'application/json'}});
  return reply({id,expiresAt},201);
 }
 if(request.method!=='GET')return reply({error:'Method not allowed'},405);
 const id=request.headers.get('Authorization')?.replace(/^Bearer /,'');if(!uuid.test(id||''))return reply({error:'Report unavailable or expired'},404);
 const object=await env.BUCKET.get(id+'/report.json');if(!object)return reply({error:'Report unavailable or expired'},404);
 const report=await object.json();if(report.expiresAt<=Date.now()){await env.BUCKET.delete([id+'/report.json',id+'/0.pdf',id+'/1.pdf']);return reply({error:'Report unavailable or expired'},404);}
 if(path==='/api/report'){delete report.digest;return reply(report);}
 const pdf=path.match(/^\/api\/pdf\/([01])$/);if(pdf){const file=await env.BUCKET.get(id+'/'+pdf[1]+'.pdf');if(file)return new Response(file.body,{headers:{...headers,'Content-Type':'application/pdf'}});}
 return reply({error:'Not found'},404);
}
