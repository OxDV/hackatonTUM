import{test}from'node:test';import assert from'node:assert/strict';import{locateQuote}from'./review/match.mjs';import{loadReview}from'./review-store.mjs';
test('regression: repeated PDF amounts must not select an arbitrary occurrence',()=>{assert.deepEqual(locateQuote([{str:'195,00 €'},{str:'195,00 €'}],'195,00 €'),[]);assert.deepEqual(locateQuote([{str:'195,00'},{str:' €'}],'195,00 €'),[0,1]);});
test('regression: invalid tokens cannot escape the report directory',()=>{assert.equal(loadReview('../report'),null);assert.equal(loadReview(''),null);});

test('regression: expired report access is denied for metadata and PDF authorization',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {saveReview}=await import('./review-store.mjs');
 const root=mkdtempSync(join(tmpdir(),'review-expiry-'));
 try{const saved=saveReview({report:'Fixture review',findings:[]},[{name:'1-Angebot_Musterhandwerker.pdf',path:'test_files/1-Angebot_Musterhandwerker.pdf'}],'http://127.0.0.1:21951',root);const token=new URL(saved.url).hash.slice(1);assert.ok(loadReview(token,root));assert.equal(loadReview(token,root,saved.expiresAt),null);assert.equal(loadReview('0'.repeat(64),root),null);}finally{rmSync(root,{recursive:true,force:true});}
});

test('regression: abbreviated quotes and continuation-page citations still locate the actual price row',async()=>{
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const{readFileSync}=await import('node:fs');const{locateEvidence}=await import('./review/match.mjs');
 const documents=[];
 for(const file of ['1-Angebot_Musterhandwerker.pdf','1-More-Expensive-Musterrechnung.pdf']){
  const doc=await getDocument({data:new Uint8Array(readFileSync('test_files/'+file)),useSystemFonts:true}).promise;
  const pages=[];for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n);pages[n]={items:(await page.getTextContent()).items.filter(i=>typeof i.str==='string')};}documents.push(pages);await doc.destroy();
 }
 const finding={title:'Position 3 — Korpusmaterial unit price raised',offerValue:'EUR 180.00/m², line total EUR 1,530.00 net',invoiceValue:'EUR 195.00/m², line total EUR 1,657.50 net',offer:{page:1,quote:'3 8,5 m² Korpusmaterial: Birke-Multiplex 18 mm ... 180,00 € 1530,00 €'},invoice:{page:2,quote:'...Vormontage in der Werkstatt (Preis angepasst)'}};
 for(const [i,kind] of ['offer','invoice'].entries()){const match=locateEvidence(documents[i],finding,kind);assert.equal(match.page,1);assert.equal(match.method,'value');assert.ok(match.indexes.length);}
});
