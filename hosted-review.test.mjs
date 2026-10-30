import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{handle}from'./review-hosted.mjs';
test('hosted reports require upload credentials and isolate expiring UUID capabilities',async()=>{
 const storage=new Map();const BUCKET={put:async(k,v)=>storage.set(k,v),get:async k=>{const v=storage.get(k);return v===undefined?null:{json:async()=>JSON.parse(v),body:v};},delete:async keys=>keys.forEach(k=>storage.delete(k))};const env={BUCKET,REVIEW_UPLOAD_KEY:'test-only-upload-key'};
 const id='11111111-1111-4111-8111-111111111111';const payload={id,report:'Review of the existing PDF fixtures',findings:[],documents:['1-Angebot_Musterhandwerker.pdf','1-More-Expensive-Musterrechnung.pdf'].map((name,i)=>({name,role:i?'invoice':'offer',base64:readFileSync('test_files/'+name).toString('base64')}))};
 const upload=()=>new Request('https://example.test/api/publish',{method:'POST',headers:{Authorization:'Bearer '+env.REVIEW_UPLOAD_KEY},body:JSON.stringify(payload)});
 assert.equal((await handle(new Request('https://example.test/api/publish',{method:'POST'}),env,{})).status,401);
 const first=await handle(upload(),env,{});assert.equal(first.status,201);const saved=await first.json();const retry=await(await handle(upload(),env,{})).json();assert.equal(saved.expiresAt,retry.expiresAt);
 const get=(path,token=id)=>handle(new Request('https://example.test'+path,{headers:{Authorization:'Bearer '+token}}),env,{});
 assert.equal((await get('/api/report')).status,200);assert.equal((await get('/api/pdf/0')).status,200);assert.equal((await get('/api/pdf/0','22222222-2222-4222-8222-222222222222')).status,404);
 const report=JSON.parse(storage.get(id+'/report.json'));report.expiresAt=Date.now()-1;storage.set(id+'/report.json',JSON.stringify(report));assert.equal((await get('/api/pdf/0')).status,404);assert.equal(storage.size,0);
});
