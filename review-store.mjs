import {parseEnv} from 'node:util';
import {z} from 'zod';
import {randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {basename,join} from 'node:path';
const evidence=z.object({filename:z.string(),page:z.number().int().min(1).max(20),quote:z.string().min(1)}).nullable();
const sourceValue=z.string().nullable().transform(value=>value??'Not stated');
const financialReference=z.object({scope:z.enum(['line','document']),offerItemIds:z.array(z.string()).max(50),invoiceItemIds:z.array(z.string()).max(50),metric:z.enum(['subtotal_net','tax_amount','total_gross']).nullable()}).nullable().optional();
export const comparisonSchema=z.object({report:z.string().min(1),responseDraft:z.object({subject:z.string().min(1),body:z.string().min(1)}).optional(),findings:z.array(z.object({title:z.string().min(1),kind:z.enum(['difference','uncertainty','note']).default('uncertainty'),priority:z.enum(['high','medium','low']),explanation:z.string(),financialReference,offerValue:sourceValue,invoiceValue:sourceValue,offer:evidence,invoice:evidence})).max(100)});
export function parseComparison(text){return comparisonSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')));}
export async function createReview(journal,comparison,extraction){
 if(!process.env.REVIEW_BASE_URL)return null;
 const id=basename(journal).replace(/-session(?:\.json)?$/,'');
 if(!/^[a-f0-9-]{36}$/.test(id))return null;
 const assetDir=join('.local','review-assets',id);
 const assets=join(assetDir,'manifest.json');if(!existsSync(assets)&&!process.env.REVIEW_PUBLISH_URL)return null;
 mkdirSync(assetDir,{recursive:true,mode:0o700});
 const files=(existsSync(assets)?JSON.parse(readFileSync(assets,'utf8')):[]).map(f=>({...f,role:['offer','invoice'].find(k=>extraction?.[k]?.source_filename===f.name)||(comparison.comparisons?.some(c=>c.invoiceFilename===f.name)?'invoice':null)}));
 if(process.env.REVIEW_PUBLISH_URL){
  const receiptPath=join('.local','review-assets',id,'publication.json');
  let publication=existsSync(receiptPath)?JSON.parse(readFileSync(receiptPath,'utf8')):null;
  if(publication?.expiresAt)return {url:new URL('/#'+publication.id,process.env.REVIEW_BASE_URL).href,expiresAt:publication.expiresAt};
  if(!publication){publication={id:randomUUID(),...comparison,documents:files.map(f=>({name:f.name,role:f.role,base64:readFileSync(f.path).toString('base64')}))};writeFileSync(receiptPath,JSON.stringify(publication),{mode:0o600});}
  const secret=process.env.REVIEW_UPLOAD_KEY||parseEnv(readFileSync('.local/review-upload.env','utf8')).REVIEW_UPLOAD_KEY;
  if(!secret)throw Error('Review upload credential missing');
  const endpoint=new URL(process.env.REVIEW_PUBLISH_URL);if(endpoint.protocol!=='https:')throw Error('Hosted review publishing requires HTTPS');
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(publication),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('Review publishing failed: HTTP '+response.status);
  const saved=await response.json();if(saved.id!==publication.id||!Number.isSafeInteger(saved.expiresAt))throw Error('Invalid review publication response');
  writeFileSync(receiptPath,JSON.stringify({id:saved.id,expiresAt:saved.expiresAt}),{mode:0o600});
  return {url:new URL('/#'+saved.id,process.env.REVIEW_BASE_URL).href,expiresAt:saved.expiresAt};
 }
 return saveReview(comparison,files,process.env.REVIEW_BASE_URL);
}
export function saveReview(comparison,files,baseURL,root='.local/reviews'){
 const url=new URL(baseURL);if(!['http:','https:'].includes(url.protocol))throw Error('Invalid review base URL');
 const token=randomBytes(32).toString('hex'),dir=join(root,token);mkdirSync(dir,{recursive:true,mode:0o700});
 const documents=files.map((f,i)=>{copyFileSync(f.path,join(dir,`${i}.pdf`));return {name:f.name,index:i,role:f.role||null};});
 const expiresAt=Date.now()+24*60*60*1000;
 writeFileSync(join(dir,'report.json'),JSON.stringify({...comparison,documents,expiresAt}),{mode:0o600});
 return {url:new URL('/#'+token,url).href,expiresAt};
}
export function loadReview(token,root='.local/reviews',now=Date.now()){
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const path=join(root,token,'report.json');if(!existsSync(path))return null;
 const report=JSON.parse(readFileSync(path,'utf8'));return report.expiresAt>now?report:null;
}
