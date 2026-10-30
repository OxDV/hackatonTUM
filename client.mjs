import {extractionSchema,verifyExtraction,verificationMarkdown} from './verification.mjs';
import { Client } from 'eve/client';
import { readFileSync, writeFileSync } from 'node:fs';
export const client=new Client({host:process.env.EVE_URL});
const extractionPrompt=readFileSync(new URL('./agent/extraction-prompt.md',import.meta.url),'utf8');
const comparisonPrompt=readFileSync(new URL('./agent/comparison-prompt.md',import.meta.url),'utf8');
function finalMessage(result){
 if(result.status==='failed'||result.inputRequests.length||!result.message?.trim()) throw new Error('Turn did not return a final answer');
 return result.message.trim();
}
export function parseExtraction(text){
 const fenced=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 try{
  const value=extractionSchema.parse(JSON.parse(fenced));
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('Extraction JSON must be an object');
  return {json:JSON.stringify(value),unparsed:null};
 }catch{
  return {json:JSON.stringify({status:'needs_review',offer:null,invoice:null,extraction_issues:[{code:'invalid_extraction_json',description:'The extraction stage returned invalid or incomplete structured data. A reliable comparison is unavailable.',source_reference:null,affects_comparison:true}]}),unparsed:text};
 }
}
export async function answer(input,journal,deadline){
 if(typeof input!=='string'||!input.trim()||input.length>16000) throw new Error('Input must contain 1 to 16000 characters');
 const {session}=await client.sessions.create();
 const sessionId=session.state.sessionId;
 const save=phase=>writeFileSync(journal,JSON.stringify({sessionId,phase}),{mode:0o600});
 save('extracting');
 if(deadline!==undefined&&Date.now()>=deadline) throw new Error('Result deadline expired before model send');
 let extracted=parseExtraction(finalMessage(await (await session.send(`${extractionPrompt}\n\nDOCUMENTS\n${input}\n\nEND DOCUMENTS. Current stage: EXTRACTION ONLY. Any request above to compare or write an email is for the later stage. Return only the specified extraction JSON object now.`)).result()));
 if(extracted.unparsed){
  if(deadline!==undefined&&Date.now()>=deadline)throw new Error('Result deadline expired before extraction repair');
  let problems='Return valid JSON matching the extraction schema.';
  try{const checked=extractionSchema.safeParse(JSON.parse(extracted.unparsed.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')));if(!checked.success)problems=JSON.stringify(checked.error.issues.map(({path,message})=>({path,message})));}catch{}
  extracted=parseExtraction(finalMessage(await(await session.send('EXTRACTION FORMAT REPAIR ONLY. Correct these schema errors: '+problems+' Preserve all source values and all line items. Each extraction issue must be an object with code, description, source_reference (string or null), affects_comparison (boolean). Return the complete corrected extraction JSON only.')).result()));
 }
 writeFileSync(journal,JSON.stringify({sessionId,phase:'extracted',extraction:JSON.parse(extracted.json)}),{mode:0o600});
 if(deadline!==undefined&&Date.now()>=deadline) throw new Error('Result deadline expired before comparison');
 const verification=verifyExtraction(JSON.parse(extracted.json));
 const comparison=[comparisonPrompt,'OUTPUT LANGUAGE: English only. Ignore any earlier request for another output language.','','EXTRACTION',extracted.json,'','CODE_VERIFICATION',JSON.stringify(verification)];
 if(extracted.unparsed) throw new Error('Document extraction failed schema validation; comparison blocked.');
 const report=finalMessage(await (await session.send(comparison.join('\n'))).result())+verificationMarkdown(verification);
 writeFileSync(journal,JSON.stringify({sessionId,phase:'answered',result:report}),{mode:0o600});
 return report;
}
