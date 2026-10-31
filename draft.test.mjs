import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildDraft,mailto,supplierEmail} from './review/draft.mjs';
test('regression: response draft must list changed periods rather than fall back to the full report or payment notes',()=>{
 const finding={kind:'difference',title:'Position 4: lower unit price',offerValue:'120.00 EUR',invoiceValue:'110.00 EUR'};
 const result=buildDraft({report:'FULL REPORT MUST NOT APPEAR',comparisons:[{label:'August',status:'matched',findings:[]},{label:'September',status:'differences',supplierEmail:'info@musterhandwerker.de',findings:[finding,{kind:'note',title:'Sample invoice label'},{title:'Invoice is labelled sample invoice',offerValue:'Offer total 8982.12 EUR',invoiceValue:'Sample total 8568.00 EUR'}]},{label:'October',status:'differences',supplierEmail:'info@musterhandwerker.de',findings:[{...finding,title:'Position 4: higher unit price',invoiceValue:'135.00 EUR'}]}]});
 assert.match(result.body,/September and October/);assert.match(result.body,/110.00 EUR/);assert.match(result.body,/135.00 EUR/);assert.doesNotMatch(result.body,/August|FULL REPORT|Sample invoice label|deposit/i);assert.equal(result.to,'info@musterhandwerker.de');
 const url=new URL(mailto(result.to,result.subject,result.body));assert.equal(url.searchParams.get('body'),result.body);assert.equal(url.searchParams.get('subject'),result.subject);
 assert.equal(mailto('x@example.com?bcc=attacker@example.com','Subject','Body'),null);
 const conflict=buildDraft({comparisons:[{status:'differences',supplierEmail:'first@example.com',findings:[finding]},{status:'differences',supplierEmail:'second@example.com',findings:[finding]}]});assert.equal(conflict.to,'');
});
test('regression: recipient must use the AI-extracted supplier field and never the customer field',()=>{
 assert.equal(supplierEmail({invoice:{vendor_email:'info@musterhandwerker.de',customer_email:'customer@example.com'}}),'info@musterhandwerker.de');
 assert.equal(supplierEmail({invoice:{vendor_email:null,customer_email:'customer@example.com'}}),null);
 assert.equal(supplierEmail({invoice:{vendor_email:'invalid?bcc=someone@example.com'}}),null);
});
test('regression: invoice customer must sign the letter and a localized draft must not be replaced with English boilerplate',async()=>{
 const {customerIdentity,documentLanguage}=await import('./document-language.mjs');
 const invoice={customer_name:'Musterkunde AG',customer_contact_name:'Sandra Musterfrau',language:'de'};
 const identity=customerIdentity({invoice},'Rechnung an\nMusterkunde AG\nz. Hd. Frau Sandra Musterfrau\nProjekt: Meetingraum');
 assert.deepEqual(identity,{customerName:'Sandra Musterfrau',customerCompany:'Musterkunde AG'});
 assert.equal(documentLanguage({offer:{language:'en'},invoice}), 'de');
 const draft=buildDraft({comparisons:[{...identity,supplierEmail:'info@musterhandwerker.de',status:'differences',findings:[{kind:'difference',title:'Einzelpreis',offerValue:'120 EUR',invoiceValue:'135 EUR'}]}],responseDraft:{subject:'Abweichungen zum Angebot',body:'Sehr geehrte Damen und Herren,\n\nMit freundlichen Grüßen\nSandra Musterfrau\nMusterkunde AG'}});
 assert.match(draft.body,/Mit freundlichen Grüßen\nSandra Musterfrau/);assert.doesNotMatch(draft.body,/Kind regards|Dear Sir/);
 assert.deepEqual(customerIdentity({invoice:{customer_name:'Musterkunde AG'}},''),{customerName:'Musterkunde AG',customerCompany:''});
});
