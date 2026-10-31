import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSokosumiRuntime} from './sokosumi-runtime.mjs';
import {verifyRuntimeTask} from './task-target.mjs';
import {batchPlan,batchPrefix} from './task-batch.mjs';
const run=promisify(execFile);
export function inputFiles(files,description){
 if(!Array.isArray(files))throw Error('Invalid task attachment response');
 const inputs=files.filter(f=>f.origin==='USER_UPLOAD');
 if(!inputs.length&&(files.length||/OIC_BATCH:|\b(?:attached|attachment|fileIds)\b/i.test(description||'')))throw Error('No task input PDFs received; attach saved Files as task inputs before starting');
 const expected=[...new Set([...String(description||'').matchAll(/(?:^|\n\n)--- ([^\r\n]+?\.pdf) ---\r?\n/g)].map(m=>m[1]))];
 if(expected.some(name=>!inputs.some(f=>f.name===name)))throw Error('Task PDFs are still being attached; waiting for all expected files');
 return inputs;
}
export async function pdfText(bytes,name){
 if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Attachment is not a PDF');
 const dir=await mkdtemp(join(tmpdir(),'invoice-pdf-'));
 try{
  const path=join(dir,'document.pdf');await writeFile(path,bytes,{mode:0o600});
  let text;
  if(process.platform==='darwin'){
   const result=await run('swift',['-module-cache-path',join(tmpdir(),'invoice-swift-cache'),fileURLToPath(new URL('./scripts/extract-pdf.swift',import.meta.url)),path],{timeout:180000,maxBuffer:1024*1024});
   text=result.stdout.replace(/^FILE:.*\n/,'');
  }else{
   const result=await run('pdftotext',['-layout',path,'-'],{timeout:60000,maxBuffer:1024*1024});
   const pages=result.stdout.split('\f');if(!pages.at(-1)?.trim())pages.pop();
   if(!pages.length||pages.length>20)throw Error('PDF must contain 1 to 20 pages');
   const extracted=[];
   for(let i=0;i<pages.length;i++){
    if(pages[i].replace(/\s/g,'').length>=30){extracted.push(`PAGE ${i+1} [TEXT]\n${pages[i]}`);continue;}
    const prefix=join(dir,`page-${i+1}`);
    await run('pdftoppm',['-f',String(i+1),'-l',String(i+1),'-scale-to','3000','-singlefile','-png',path,prefix],{timeout:60000,maxBuffer:1024*1024});
    const ocr=await run('tesseract',[prefix+'.png','stdout','-l','deu+eng','tsv'],{timeout:60000,maxBuffer:1024*1024});
    const words=ocr.stdout.split('\n').slice(1).map(x=>x.split('\t')).filter(x=>x[0]==='5'&&x[11]?.trim());
    const mean=words.reduce((n,w)=>n+Number(w[10]),0)/words.length;
    const content=words.map(w=>w[11]).join(' ');
    if(content.replace(/\s/g,'').length<30||!Number.isFinite(mean)||mean<80)throw Error(`Unreadable or low-confidence OCR on page ${i+1}; upload a clearer scan before payment`);
    const uncertain=words.filter(w=>Number(w[10])<50).map(w=>w[11]).join('; ');
    extracted.push(`${uncertain?'OCR UNCERTAINTY page '+(i+1)+': low-confidence segments: '+uncertain+'\n':''}PAGE ${i+1} [OCR; mean confidence ${(mean/100).toFixed(2)}; verify numbers against source]\n${content}`);
   }
   text=extracted.join('\n');
  }
  if(text.replace(/PAGE \d+/g,'').trim().length<30)throw Error('PDF has no readable text; OCR is required');
  return `FILE: ${name.replace(/[\r\n]/g,' ')}\n${text}`;
 }finally{await rm(dir,{recursive:true,force:true});}
}
export async function taskInput(taskId,description,target){
 const {readRuntimeCredential,createCoworkerHttpClient}=await loadSokosumiRuntime();
 const core=createCoworkerHttpClient({apiKey:readRuntimeCredential(target.coworkerId)});
 await verifyRuntimeTask(core,taskId,target);
 const {data:files}=await core.get(`/v1/tasks/${encodeURIComponent(taskId)}/files`,AbortSignal.timeout(30000));
 const inputs=inputFiles(files,description);
 if(!inputs.length)return description;
 if(inputs.length<2||inputs.length>4)throw Error('Attach one offer and one to three invoice PDFs');
 const plan=batchPlan(description,inputs.map(f=>f.name));
 const snapshot=join('.local','review-assets',taskId);await mkdir(snapshot,{recursive:true,mode:0o700});const manifest=[];
 // Core appends Files' extracted text to the description. Use our downloaded
 // PDFs as the source, rather than counting that duplicate text a second time.
 const appended=inputs.map(f=>(description||'').indexOf('\n\n--- '+f.name+' ---')).filter(i=>i>=0);
 const instruction=appended.length?description.slice(0,Math.min(...appended)):description;
 const parts=[instruction||'Compare the attached offer and invoice.'],documents=[];let totalBytes=0;
 for(const f of inputs){
  if(f.taskId!==taskId||f.status!=='READY'||f.mimeType!=='application/pdf')throw Error('Task PDFs must be ready before execution');
  const url=new URL(f.fileUrl);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.public.blob.vercel-storage.com')||url.username||url.password||url.port)throw Error('Unsupported attachment storage URL');
  if(f.size>10*1024*1024)throw Error('PDF exceeds 10 MB');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Attachment HTTP ${response.status}`);
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>10*1024*1024)throw Error('PDF exceeds 10 MB');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  totalBytes+=bytes.length;if(totalBytes>15*1024*1024)throw Error('Combined PDFs exceed 15 MB');
  const text=await pdfText(bytes,f.name);parts.push(text);documents.push({name:f.name,text});
  const path=join(snapshot,`${manifest.length}.pdf`);await writeFile(path,bytes,{mode:0o600});manifest.push({name:f.name,path});
 }
 const batch=!!plan||inputs.length>2;
 const input=batch?batchPrefix+JSON.stringify({plan,instructions:instruction,documents}):parts.join('\n\n');
 if(batch&&input.length>64000)throw Error('Batch PDF text exceeds 64000 characters; split the documents into smaller tasks');
 if(plan){const offer=documents.find(d=>d.name===plan.offer);for(const invoice of plan.invoices){if(offer.text.length+documents.find(d=>d.name===invoice.filename).text.length>15000)throw Error('Each offer/invoice pair must fit within 15000 extracted characters');}}
 else if(!batch&&input.length>16000)throw Error('Combined PDF text exceeds 16000 characters; split the documents into smaller tasks');
 await writeFile(join(snapshot,'manifest.json'),JSON.stringify(manifest),{mode:0o600});
 return input;
}
