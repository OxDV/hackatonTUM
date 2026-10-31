import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inputFiles} from './task-files.mjs';
import {batchPlan,batchPrefix,answerBatch} from './task-batch.mjs';
const offer='1-Angebot_Musterhandwerker.pdf';
const invoices=['1-Correct-Musterrechnung.pdf','1-Reduced-Cost-Musterrechnung.pdf','1-More-Expensive-Musterrechnung.pdf'];
const plan={offer,invoices:invoices.map((filename,i)=>({filename,label:['August','September','October'][i]}))};
test('regression: Soko Bot task inputs must be accepted without including task outputs or silently using text when attachments are missing',()=>{
 const input={name:offer,origin:'USER_UPLOAD',uploader:{type:'sokoBot'}};
 assert.deepEqual(inputFiles([input,{origin:'TASK_OUTPUT'}],'Compare attached PDFs'),[input]);
 assert.throws(()=>inputFiles([input],`Compare\n\n--- ${offer} ---\ntext\n\n--- ${invoices[0]} ---\ntext`),/still being attached/);
 assert.throws(()=>inputFiles([],'Compare attached PDFs'),/No task input PDFs/);
 assert.throws(()=>inputFiles([{origin:'TASK_OUTPUT'}],'Compare'),/No task input PDFs/);
 assert.deepEqual(inputFiles([],'Compare the following extracted text'),[]);
});
test('regression: unordered batch attachments must map to exactly one offer and each selected invoice',()=>{
 assert.deepEqual(batchPlan('OIC_BATCH: '+JSON.stringify(plan),[...invoices,offer]),plan);
 assert.equal(batchPlan('Compare two PDFs',[offer,invoices[0]]),null);
 assert.equal(batchPlan('Compare all PDFs',[offer,...invoices]),null);
 assert.throws(()=>batchPlan('OIC_BATCH: '+JSON.stringify({...plan,offer:invoices[0]}),[offer,...invoices]),/exactly once/);
});
test('regression: one failed batch comparison must not hide other reports or rerun completed pairs on retry',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'invoice-batch-'));const journal=join(dir,'session.json');let calls=0;
 const input=batchPrefix+JSON.stringify({plan,documents:[offer,...invoices].map(name=>({name,text:'FILE: '+name}))});
 const answer=async(text,path)=>{calls++;const filename=invoices.find(f=>text.includes('FILE: '+f));if(filename===invoices[1])throw Error('Extraction unavailable');writeFileSync(path,JSON.stringify({phase:'answered',language:'en',outputPolicy:'structured-findings-v2',extraction:{status:'needs_review',offer:{source_filename:offer},invoice:{source_filename:filename}},findings:[],result:'English comparison report'}));};
 try{
  await answerBatch(input,journal,undefined,answer);
  const saved=JSON.parse(readFileSync(journal));assert.equal(saved.comparisons.length,3);assert.equal(saved.comparisons[1].status,'uncertain');assert.match(saved.comparisons[1].report,/could not be validated/);assert.match(readFileSync(join(dir,'session-batch-1-error.json'),'utf8'),/Extraction unavailable/);assert.equal(saved.comparisons[2].invoiceFilename,invoices[2]);
  await answerBatch(input,journal,undefined,answer);assert.equal(calls,4);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('regression: a plain Soko Bot task without OIC_BATCH must infer and validate all files once, then reuse its plan',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'invoice-plan-'));const journal=join(dir,'session.json');let planned=0;
 const input=batchPrefix+JSON.stringify({plan:null,instructions:'Compare the offer with all three invoice variants',documents:[offer,...invoices].map(name=>({name,text:'FILE: '+name}))});
 const infer=async(instructions,documents)=>{planned++;assert.equal(documents.length,4);return plan;};
 const answer=async(text,path)=>{const filename=invoices.find(f=>text.includes('FILE: '+f));writeFileSync(path,JSON.stringify({phase:'answered',outputPolicy:'structured-findings-v2',extraction:{status:'needs_review',offer:{source_filename:offer},invoice:{source_filename:filename}},findings:[],result:'Comparison'}));};
 try{await answerBatch(input,journal,undefined,answer,undefined,infer);await answerBatch(input,journal,undefined,answer,undefined,infer);assert.equal(planned,1);assert.equal(JSON.parse(readFileSync(journal)).comparisons.length,3);await assert.rejects(()=>answerBatch(input,join(dir,'invalid.json'),undefined,answer,undefined,async()=>({...plan,offer:'not-attached.pdf'})),/exactly once/);}finally{rmSync(dir,{recursive:true,force:true});}
});
