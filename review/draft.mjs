export function validEmail(value){return typeof value==='string'&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value)&&!/[\r\n?&#]/.test(value);}
export function supplierEmail(extraction){
 const email=extraction?.invoice?.vendor_email;
 return validEmail(email)?email:null;
}
export function mailto(to,subject,body){return validEmail(to)?'mailto:'+encodeURIComponent(to)+'?subject='+encodeURIComponent(subject.replace(/[\r\n]/g,' '))+'&body='+encodeURIComponent(body):null;}
function isDifference(f){return f.kind==='difference';}
export function buildDraft(collection){
 const comparisons=collection.comparisons||[collection];
 const changed=comparisons.filter(c=>c.status!=='matched'&&(c.findings||[]).some(isDifference));
 const emails=[...new Set(changed.map(c=>c.supplierEmail).filter(validEmail))];
 const to=emails.length===1&&changed.every(c=>c.supplierEmail===emails[0])?emails[0]:'';
 if(collection.responseDraft?.subject&&collection.responseDraft?.body)return {to,subject:collection.responseDraft.subject,body:collection.responseDraft.body};
 const subject='Clarification of invoice differences against the agreed offer';
 let body='Dear Sir or Madam,\n\n';
 if(!changed.length)body+='I have compared the supplied invoice documents with the offer and have not identified confirmed differences to raise. Please see the comparison report for any remaining checks.\n';
 else{
  const labels=changed.map(c=>c.label||c.invoiceFilename||'the invoice');
  body+='I have compared '+(changed.length>1?'the invoices':'the invoice')+' with the previously agreed offer and noticed differences for '+labels.join(' and ')+'. Could you please clarify the following changes?\n\n';
  for(const c of changed){
   body+=(c.label||'Invoice')+(c.invoiceFilename?' ('+c.invoiceFilename+')':'')+':\n';
   for(const f of c.findings.filter(isDifference))body+='- '+f.title+'\n  Offer: '+f.offerValue+'\n  Invoice: '+f.invoiceValue+'\n';
   body+='\n';
  }
  body+='Please explain the basis for these changes and confirm the agreed amounts. If any differences are errors, please provide a corrected invoice. Lower amounts are noted as differences, not as overcharges.\n';
 }
 body+='\nThank you for your clarification.\n\nKind regards';
 const names=[...new Set(comparisons.map(c=>c.customerName).filter(Boolean))];
 const companies=[...new Set(comparisons.map(c=>c.customerCompany).filter(Boolean))];
 if(names.length===1)body+='\n'+names[0]+(companies.length===1?'\n'+companies[0]:'');
 return {to,subject,body};
}
