const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
export async function handle(request,env,assets){
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&assets[path]){const a=assets[path],body=a.encoding==='base64'?Uint8Array.from(atob(a.body),c=>c.charCodeAt(0)):a.body;return new Response(body,{headers:{...headers,'Content-Type':a.type}});}
 if(!env.BUCKET)return reply({error:'Storage unavailable'},503);
 if(path==='/api/publish'&&request.method==='POST'){
  if(!env.REVIEW_UPLOAD_KEY||request.headers.get('Authorization')!=='Bearer '+env.REVIEW_UPLOAD_KEY)return reply({error:'Unauthorized'},401);
  if(Number(request.headers.get('Content-Length'))>24*1024*1024)return reply({error:'Too large'},413);
  const chunks=[];let length=0;for await(const chunk of request.body){length+=chunk.byteLength;if(length>24*1024*1024)return reply({error:'Too large'},413);chunks.push(chunk);}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let input;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply({error:'Invalid JSON'},400);}
  const id=input.id;
  if(!uuid.test(id)||typeof input.report!=='string'||input.report.length>1000000||!Array.isArray(input.findings)||input.findings.length>100||!Array.isArray(input.documents)||![0,2,3,4].includes(input.documents.length))return reply({error:'Invalid report'},400);
  if(input.comparisons!==undefined){
   if(!Array.isArray(input.comparisons)||input.comparisons.length<1||input.comparisons.length>3||new Set(input.comparisons.map(c=>c.label)).size!==input.comparisons.length||input.comparisons.some(c=>typeof c.label!=='string'||!c.label||c.label.length>80||!['matched','differences','uncertain'].includes(c.status)||typeof c.report!=='string'||c.report.length>1000000||!Array.isArray(c.findings)||c.findings.length>100||!input.documents.some(d=>d.name===c.offerFilename&&d.role==='offer')||!input.documents.some(d=>d.name===c.invoiceFilename&&d.role==='invoice')))return reply({error:'Invalid batch comparisons'},400);
  }else if(input.documents.length>2)return reply({error:'Batch comparisons required'},400);
  if(input.responseDraft!==undefined&&(typeof input.responseDraft?.subject!=='string'||typeof input.responseDraft?.body!=='string'||input.responseDraft.subject.length>1000||input.responseDraft.body.length>20000))return reply({error:'Invalid supplier draft'},400);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const previous=await env.BUCKET.get(id+'/report.json');
  if(previous){const r=await previous.json();if(r.digest!==digest)return reply({error:'Report ID already used'},409);if(r.expiresAt<=Date.now())return reply({error:'Report expired'},410);return reply({id,expiresAt:r.expiresAt});}
  const documents=[];let pdfBytes=0;
  for(let i=0;i<input.documents.length;i++){
   const d=input.documents[i];if(typeof d.name!=='string'||d.name.length>512||typeof d.base64!=='string'||d.base64.length>14000000||!['offer','invoice',null].includes(d.role))return reply({error:'Invalid PDF'},400);
   let raw;try{raw=Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0));}catch{return reply({error:'Invalid PDF'},400);}
   if(raw.length>10*1024*1024||new TextDecoder().decode(raw.slice(0,5))!=='%PDF-')return reply({error:'Invalid PDF'},400);
   pdfBytes+=raw.length;if(pdfBytes>15*1024*1024)return reply({error:'Combined PDFs exceed 15 MB'},413);
   documents.push({name:d.name,role:d.role,index:i,raw});
  }
  const expiresAt=Date.now()+86400000;
  for(const d of documents)await env.BUCKET.put(id+'/'+d.index+'.pdf',d.raw,{httpMetadata:{contentType:'application/pdf'}});
  const report={report:input.report,findings:input.findings,status:['matched','differences','uncertain'].includes(input.status)?input.status:null,language:input.language||null,customerName:input.customerName||null,customerCompany:input.customerCompany||null,...(input.responseDraft?{responseDraft:input.responseDraft}:{}),supplierEmail:typeof input.supplierEmail==='string'?input.supplierEmail:null,...(input.comparisons?{comparisons:input.comparisons}:{}),documents:documents.map(({raw,...d})=>d),expiresAt,digest};
  await env.BUCKET.put(id+'/report.json',JSON.stringify(report),{httpMetadata:{contentType:'application/json'}});
  return reply({id,expiresAt},201);
 }
 if(request.method!=='GET')return reply({error:'Method not allowed'},405);
 const id=request.headers.get('Authorization')?.replace(/^Bearer /,'');if(!uuid.test(id||''))return reply({error:'Report unavailable or expired'},404);
 const object=await env.BUCKET.get(id+'/report.json');if(!object)return reply({error:'Report unavailable or expired'},404);
 const report=await object.json();if(report.expiresAt<=Date.now()){await env.BUCKET.delete([id+'/report.json',...report.documents.map(d=>id+'/'+d.index+'.pdf')]);return reply({error:'Report unavailable or expired'},404);}
 if(path==='/api/report'){delete report.digest;return reply(report);}
 const pdf=path.match(/^\/api\/pdf\/(\d+)$/);if(pdf&&report.documents.some(d=>String(d.index)===pdf[1])){const file=await env.BUCKET.get(id+'/'+pdf[1]+'.pdf');if(file)return new Response(file.body,{headers:{...headers,'Content-Type':'application/pdf'}});}
 return reply({error:'Not found'},404);
}
