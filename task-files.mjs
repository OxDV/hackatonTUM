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
   const result=await run('swift',['-module-cache-path',join(tmpdir(),'invoice-swift-cache'),fileURLToPath(new URL('./scripts/extract-pdf.swift',import.meta.url)),path],{timeout:60000,maxBuffer:1024*1024});
   text=result.stdout.replace(/^FILE:.*\n/,'');
  }else{
   const result=await run('pdftotext',['-layout',path,'-'],{timeout:60000,maxBuffer:1024*1024});
   text=result.stdout.split('\f').filter(x=>x.trim()).map((x,i)=>`PAGE ${i+1}\n${x}`).join('\n');
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
