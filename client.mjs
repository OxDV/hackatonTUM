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
  const value=JSON.parse(fenced);
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('Extraction JSON must be an object');
  return {json:JSON.stringify(value),unparsed:null};
 }catch{
  return {json:JSON.stringify({status:'needs_review',offer:null,invoice:null,extraction_issues:[{code:'invalid_extraction_json',description:'The extraction stage did not return valid JSON.',source_reference:null,affects_comparison:true}]}),unparsed:text};
 }
}
export async function answer(input,journal,deadline){
 if(typeof input!=='string'||!input.trim()||input.length>16000) throw new Error('Input must contain 1 to 16000 characters');
 const {session}=await client.sessions.create();
 const sessionId=session.state.sessionId;
 const save=phase=>writeFileSync(journal,JSON.stringify({sessionId,phase}),{mode:0o600});
 save('extracting');
 if(deadline!==undefined&&Date.now()>=deadline) throw new Error('Result deadline expired before model send');
 const extracted=parseExtraction(finalMessage(await (await session.send(`${extractionPrompt}\n\nDOCUMENTS\n${input}`)).result()));
 save('comparing');
 if(deadline!==undefined&&Date.now()>=deadline) throw new Error('Result deadline expired before comparison');
 const comparison=[comparisonPrompt,'','EXTRACTION',extracted.json];
 if(extracted.unparsed) comparison.push('','UNPARSED_EXTRACTION',extracted.unparsed);
 const report=finalMessage(await (await session.send(comparison.join('\n'))).result());
 writeFileSync(journal,JSON.stringify({sessionId,phase:'answered',result:report}),{mode:0o600});
 return report;
}
