import {z} from 'zod';
import {createHash} from 'node:crypto';
import {documentLanguage,customerIdentity,periodLabel} from './document-language.mjs';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {verifyExtraction} from './verification.mjs';
import {createReview} from './review-store.mjs';
import {supplierEmail} from './review/draft.mjs';

const planSchema=z.object({offer:z.string().min(1),invoices:z.array(z.object({filename:z.string().min(1),label:z.string().min(1).max(80)})).min(1).max(3)});
export const batchPrefix='OIC_BATCH_INPUT\n';
export function batchPlan(description,names){
 const line=String(description).split('\n').find(line=>line.startsWith('OIC_BATCH:'));
 if(!line)return null;
 const plan=planSchema.parse(JSON.parse(line.slice('OIC_BATCH:'.length)));
 const selected=[plan.offer,...plan.invoices.map(i=>i.filename)];
 if(new Set(selected).size!==selected.length||new Set(plan.invoices.map(i=>i.label)).size!==plan.invoices.length||new Set(names).size!==names.length||names.length!==selected.length||selected.some(n=>!names.includes(n)))throw Error('Batch mapping must identify every attached PDF exactly once with unique labels');
 return plan;
}
export function comparisonStatus(extraction,findings){
 if(!extraction?.offer||!extraction?.invoice)return 'uncertain';
 const v=verifyExtraction(extraction);
 if(findings.some(f=>f.kind==='difference')||v.checks.some(c=>!c.matches)||v.documentDifferences.some(d=>Number(d.difference)!==0))return 'differences';
 const issues=[...(extraction.extraction_issues||[]),...['offer','invoice'].flatMap(k=>[...(extraction[k]?.extraction_issues||[]),...(extraction[k]?.line_items||[]).flatMap(l=>l.extraction_issues||[])])];
 if(extraction.status!=='ready'||issues.some(i=>i.affects_comparison)||v.limitations.length||!v.checks.length||findings.some(f=>!f.kind||f.kind==='uncertainty'))return 'uncertain';
 return 'matched';
}
export async function answerBatch(input,journal,deadline,answerPair,createDraft,inferPlan){
 const payload=JSON.parse(input.slice(batchPrefix.length));
 if(!Array.isArray(payload.documents)||payload.documents.length<2||payload.documents.length>4||payload.documents.some(d=>typeof d.name!=='string'||typeof d.text!=='string'))throw Error('Invalid batch documents');
 let plan=payload.plan;
 if(!plan){
  if(!inferPlan)throw Error('Automatic batch planning is unavailable');
  const key=createHash('sha256').update(JSON.stringify({instructions:payload.instructions,documents:payload.documents})).digest('hex');
  const path=journal.replace(/\.json$/,'-plan.json');
  const previous=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
  plan=previous?.key===key?previous.plan:await inferPlan(payload.instructions||'',payload.documents,deadline);
  plan=batchPlan('OIC_BATCH: '+JSON.stringify(plan),payload.documents.map(d=>d.name));
  writeFileSync(path,JSON.stringify({key,plan}),{mode:0o600});
 }
 plan=planSchema.parse(plan);
 if(payload.documents.length!==plan.invoices.length+1)throw Error('Invalid batch documents');
 batchPlan('OIC_BATCH: '+JSON.stringify(plan),payload.documents.map(d=>d.name));
 const offer=payload.documents.find(d=>d.name===plan.offer);
 for(const invoice of plan.invoices){const source=payload.documents.find(d=>d.name===invoice.filename);if(offer.text.length+source.text.length>15000)throw Error('Each offer/invoice pair must fit within 15000 extracted characters');}
 const comparisons=[];
 for(const [i,invoice] of plan.invoices.entries()){
  const pairJournal=journal.replace(/\.json$/,`-batch-${i}.json`);
  try{
   if(deadline!==undefined&&Date.now()>=deadline)throw Error('Batch result deadline expired');
   let saved=existsSync(pairJournal)?JSON.parse(readFileSync(pairJournal,'utf8')):null;
   const source=payload.documents.find(d=>d.name===invoice.filename);
   if(saved?.phase!=='answered'||saved.outputPolicy!=='structured-findings-v2'){
    await answerPair(['Compare the attached offer and invoice in the language of the invoice. The reporting period label is '+JSON.stringify(invoice.label)+'; it is user-provided metadata, not a verified document date.',offer.text,source.text].join('\n\n'),pairJournal,deadline,{publish:false});
    saved=JSON.parse(readFileSync(pairJournal,'utf8'));
   }
   // Do not publish an incorrectly identified pair under a selected month.
   if(saved.extraction?.offer?.source_filename!==plan.offer||saved.extraction?.invoice?.source_filename!==invoice.filename)throw Error('Extracted document roles do not match the selected PDFs');
   comparisons.push({label:invoice.label,offerFilename:plan.offer,invoiceFilename:invoice.filename,supplierEmail:supplierEmail(saved.extraction),language:documentLanguage(saved.extraction),...customerIdentity(saved.extraction),status:comparisonStatus(saved.extraction,saved.findings),report:saved.result,findings:saved.findings});
  }catch(e){
   writeFileSync(pairJournal.replace(/\.json$/,'-error.json'),JSON.stringify({error:String(e.message),at:new Date().toISOString()}),{mode:0o600});
   comparisons.push({label:invoice.label,offerFilename:plan.offer,invoiceFilename:invoice.filename,status:'uncertain',report:'Comparison unavailable. Source extraction or comparison could not be validated reliably. Review the original PDFs or retry this period.',findings:[]});
  }
 }
 const language=comparisons.find(c=>c.status==='differences')?.language||comparisons[0]?.language||'en';
 const de=language==='de';
 const summary=(de?'# Vergleich der Rechnungen\n\nDie Monatsangaben stammen aus der Aufgabenauswahl und bestätigen keine Rechnungsdaten.\n\n':'# Invoice batch review\n\nPeriod labels come from the task selection; they do not verify the billing dates.\n\n')+comparisons.map(c=>`- ${periodLabel(c.label,language).replace(/[\r\n]/g,' ')}: ${de?{matched:'Übereinstimmung',differences:'Abweichungen',uncertain:'Prüfung erforderlich'}[c.status]:c.status} (${c.findings.length} ${de?'Feststellungen':'findings'})`).join('\n');
 let responseDraft;
 if(createDraft){
  const key=createHash('sha256').update(JSON.stringify({comparisons,language})).digest('hex');
  const draftPath=journal.replace(/\.json$/,'-draft.json');
  const previous=existsSync(draftPath)?JSON.parse(readFileSync(draftPath,'utf8')):null;
  responseDraft=previous?.key===key?previous.responseDraft:await createDraft({comparisons,language},deadline);
  writeFileSync(draftPath,JSON.stringify({key,responseDraft}),{mode:0o600});
 }
 const structured={report:summary,findings:[],comparisons,language,...(responseDraft?{responseDraft}:{})};
 const review=await createReview(journal,structured,{offer:{source_filename:plan.offer}});
 const result=summary+(review?`\n\n[${de?'Interaktiven PDF-Vergleich öffnen':'Open interactive PDF review'}](${review.url}) — ${de?'verfügbar bis':'available until'} ${new Date(review.expiresAt).toISOString()}.`:'\n\n'+comparisons.map(c=>'## '+c.label+'\n\n'+c.report).join('\n\n'));
 writeFileSync(journal,JSON.stringify({phase:'answered',comparisons,language,responseDraft,result}),{mode:0o600});
 return result;
}
