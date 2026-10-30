import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSokosumiRuntime} from './sokosumi-runtime.mjs';
import {verifyRuntimeTask} from './task-target.mjs';
const run=promisify(execFile);
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
 if(!Array.isArray(files))throw Error('Invalid task attachment response');
 const inputs=files.filter(f=>f.origin==='USER_UPLOAD');
 if(!inputs.length)return description;
 if(inputs.length!==2)throw Error('Attach exactly one offer PDF and one invoice PDF');
 const parts=[description||'Compare the attached offer and invoice.'];
 for(const f of inputs){
  if(f.taskId!==taskId||f.status!=='READY'||f.mimeType!=='application/pdf')throw Error('Task PDFs must be ready before execution');
  const url=new URL(f.fileUrl);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.public.blob.vercel-storage.com')||url.username||url.password||url.port)throw Error('Unsupported attachment storage URL');
  if(f.size>10*1024*1024)throw Error('PDF exceeds 10 MB');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Attachment HTTP ${response.status}`);
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>10*1024*1024)throw Error('PDF exceeds 10 MB');chunks.push(chunk);}
  parts.push(await pdfText(Buffer.concat(chunks),f.name));
 }
 const input=parts.join('\n\n');
 if(input.length>16000)throw Error('Combined PDF text exceeds 16000 characters; split the documents into smaller tasks');
 return input;
}
