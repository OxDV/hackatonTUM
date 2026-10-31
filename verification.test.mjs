import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyExtraction} from './verification.mjs';
import {comparisonStatus} from './task-batch.mjs';
// Values transcribed from the four existing test_files PDFs; no synthetic documents.
const offer=[['1','650','650'],['1','350','350'],['8.5','180','1530'],['12','120','1440'],['1','680','680'],['1','950','950'],['1','420','420'],['1','280','280'],['16','78','1248'],['1','0','0']];
const expensive=[...offer.map(x=>[...x])];expensive[2]=['8.5','195','1657.50'];expensive[3]=['12','135','1620'];expensive[8]=['16','88','1408'];expensive[9]=['1','260','260'];expensive.push(['1','120','120']);
const reduced=offer.map(x=>[...x]);reduced[3]=['12','110','1320'];reduced[5]=['1','880','880'];reduced[6]=['1','390','390'];reduced[8]=['16','70','1120'];
function doc(rows,filename,net,tax,gross){return {currency:'EUR',adjustments:[],line_items:rows.map(([quantity,unit_price,total_price],i)=>({item_id:String(i+1),quantity,unit_price,total_price,price_base_quantity:'1',price_basis:'net',discounts:[],surcharges:[],source_reference:`${filename}, position ${i+1}`})),totals:{subtotal_net:net,tax_amount:tax,total_gross:gross,tax_breakdown:[{rate:'0.19',taxable_amount:net,tax_amount:tax,source_reference:`${filename}, totals`}],source_references:[`${filename}, totals`]}};}
test('regression: PDF decimal quantities and half-cent VAT round exactly for all three invoices',()=>{
 const base=doc(offer,'1-Angebot_Musterhandwerker.pdf','7548','1434.12','8982.12');
 for(const [rows,file,net,tax,gross] of [[offer,'1-Correct-Musterrechnung.pdf','7548','1434.12','8982.12'],[expensive,'1-More-Expensive-Musterrechnung.pdf','8395.50','1595.15','9990.65'],[reduced,'1-Reduced-Cost-Musterrechnung.pdf','7200','1368','8568']]){
 const result=verifyExtraction({offer:base,invoice:doc(rows,file,net,tax,gross)});
 assert.equal(result.documentDifferences.find(x=>x.field==='total_gross').difference,file.includes('More-Expensive')?'1008.53':file.includes('Reduced')?'-414.12':'0.00');assert.deepEqual(result.limitations,[]);assert.equal(result.checks.every(x=>x.matches),true,file);
 }
});
test('regression: non-blocking sample-invoice notes must not color a matching month red',()=>{
 const extraction={status:'ready',extraction_issues:[{code:'sample_invoice',affects_comparison:false}],offer:doc(offer,'1-Angebot_Musterhandwerker.pdf','7548','1434.12','8982.12'),invoice:doc(offer,'1-Correct-Musterrechnung.pdf','7548','1434.12','8982.12')};
 assert.equal(comparisonStatus(extraction,[{kind:'note'}]),'matched');
 assert.equal(comparisonStatus(extraction,[{kind:'uncertainty'}]),'uncertain');
 assert.equal(comparisonStatus({...extraction,extraction_issues:[{affects_comparison:true}]},[{kind:'uncertainty'}]),'uncertain');
 assert.equal(comparisonStatus(extraction,[{kind:'difference'}]),'differences');
 assert.equal(comparisonStatus(extraction,[{}]),'uncertain');
});
