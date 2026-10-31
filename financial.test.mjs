import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparisonFinancial} from './financial.mjs';
import {comparisonView,visibleFindings} from './review/data.mjs';
// Position 4 values transcribed from the existing offer and invoice fixtures.
const offerName='1-Angebot_Musterhandwerker.pdf',expensive='1-More-Expensive-Musterrechnung.pdf',reduced='1-Reduced-Cost-Musterrechnung.pdf',correct='1-Correct-Musterrechnung.pdf';
const line=(price,total)=>({item_id:'4',quantity:'12',unit:'Stk.',unit_price:price,total_price:total,price_base_quantity:'1',price_basis:'net'});
const doc=(name,price,total)=>({source_filename:name,currency:'EUR',line_items:[line(price,total)]});
const finding=(invoice)=>({kind:'difference',title:'Einzelpreis geändert',offerValue:'120,00 €/Stk.',invoiceValue:'135,00 €/Stk.',offer:{filename:offerName},invoice:{filename:invoice}});
const ref={scope:'line',offerItemIds:['4'],invoiceItemIds:['4'],metric:null};
test('regression: German values must produce exact numeric cards from AI item references, without parsing report text',()=>{
 const a=doc(offerName,'120','1440');
 const up=comparisonFinancial({offer:a,invoice:doc(expensive,'135','1620')},ref,finding(expensive));
 assert.equal(up.difference,'180.00');assert.equal(up.percent,'12.50');assert.equal(up.offerTotal,'1440.00');assert.equal(up.invoiceTotal,'1620.00');assert.equal(up.unit,'/Stk.');
 const down=comparisonFinancial({offer:a,invoice:doc(reduced,'110','1320')},ref,{...finding(reduced),offerValue:'Any localized description',invoiceValue:'No machine-parsable numbers'});
 assert.equal(down.difference,'-120.00');assert.equal(down.percent,'-8.33');
 assert.equal(comparisonFinancial({offer:a,invoice:doc(expensive,'135','1620')},null,finding(expensive)),null);
 assert.throws(()=>comparisonFinancial({offer:a,invoice:doc(expensive,'135','1620')},{...ref,invoiceItemIds:['unknown']},finding(expensive)),/Unknown financial/);
});
test('regression: a matching invoice must have zero cards and period switching must reject another invoice source',()=>{
 const matched={status:'matched',invoiceFilename:correct,findings:[{kind:'note',title:'All totals match'},{kind:'uncertainty',title:'Payment status not recorded'}]};
 assert.deepEqual(visibleFindings(matched),[]);
 const september={status:'differences',invoiceFilename:reduced,findings:[finding(reduced),{kind:'note'}]};
 const october={status:'differences',invoiceFilename:expensive,findings:[finding(expensive)]};
 const collection={comparisons:[matched,september,october],documents:[],expiresAt:1};
 assert.equal(comparisonView(collection,1).findings.length,1);assert.equal(comparisonView(collection,2).findings[0].invoice.filename,expensive);
 assert.throws(()=>comparisonView({...collection,comparisons:[{...october,findings:[finding(reduced)]}]},0),/does not match/);
});
