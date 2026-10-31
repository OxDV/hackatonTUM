import {z} from 'zod';
const decimal=z.string().regex(/^-?\d{1,18}(?:\.\d{1,12})?$/).nullable();
const reference=z.string().min(1);
const issue=z.object({code:z.string(),description:z.string(),source_reference:z.string().nullable(),affects_comparison:z.boolean()});
const line=z.object({item_id:z.string().min(1),description:z.string().min(1),quantity:decimal,unit_price:decimal,price_base_quantity:decimal,total_price:decimal,price_basis:z.enum(['net','gross','unknown']),discounts:z.array(z.unknown()),surcharges:z.array(z.unknown()),source_reference:reference,extraction_issues:z.array(issue)}).passthrough();
const document=z.object({document_type:z.enum(['offer','invoice']),language:z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/).optional(),vendor_email:z.string().email().nullable().optional(),customer_name:z.string().nullable().optional(),customer_contact_name:z.string().nullable().optional(),currency:z.string().regex(/^[A-Z]{3}$/).nullable(),line_items:z.array(line).min(1),adjustments:z.array(z.unknown()),totals:z.object({subtotal_net:decimal,tax_amount:decimal,total_gross:decimal,amount_due:decimal,tax_breakdown:z.array(z.object({rate:decimal,taxable_amount:decimal,tax_amount:decimal,source_reference:reference})),source_references:z.array(reference).min(1)}).passthrough(),extraction_issues:z.array(issue)}).passthrough().superRefine((d,c)=>{if(new Set(d.line_items.map(x=>x.item_id)).size!==d.line_items.length)c.addIssue({code:'custom',message:'Duplicate item identifiers'});});
export const extractionSchema=z.object({status:z.enum(['ready','needs_review','missing_document']),offer:document.nullable(),invoice:document.nullable(),extraction_issues:z.array(issue)}).superRefine((v,c)=>{if(v.status==='ready'&&(!v.offer||!v.invoice))c.addIssue({code:'custom',message:'Ready requires both documents'});for(const type of ['offer','invoice'])if(v[type]&&v[type].document_type!==type)c.addIssue({code:'custom',message:'Document type mismatch'});});
// Exact rational arithmetic: no floating-point money operations.
export function rational(s){const [a,b='']=s.split('.');return [BigInt(a+b),10n**BigInt(b.length)];}
export function add([a,b],[c,d]){return [a*d+c*b,b*d];}
export function mul([a,b],[c,d]){return [a*c,b*d];}
export function div([a,b],[c,d]){if(c===0n)throw Error('Zero price base');return [a*d,b*c];}
export function money([n,d],digits){if(d<0n){n=-n;d=-d;}const scale=10n**BigInt(digits);const sign=n<0n?'-':'';n=n<0n?-n:n;const rounded=(n*scale*2n+d)/(2n*d);return sign+(rounded/scale).toString()+(digits?'.'+(rounded%scale).toString().padStart(digits,'0'):'');}
export function verifyExtraction(data){
 const checks=[],limitations=[];
 for(const name of ['offer','invoice']){
  const doc=data[name];if(!doc){limitations.push(`${name}: document unavailable`);continue;}
  if(!['EUR','USD','GBP','CHF'].includes(doc.currency)){limitations.push(`${name}: unsupported or unknown currency precision`);continue;}
  const check=(label,actual,expected,source)=>{if(actual===null){limitations.push(`${name}: ${label} unavailable`);return;}const calculated=money(expected,2),stated=money(rational(actual),2);checks.push({document:name,label,stated,calculated,currency:doc.currency,matches:stated===calculated,source_reference:source});};
  for(const item of doc.line_items){
   if([item.quantity,item.unit_price,item.price_base_quantity].includes(null)||item.discounts.length||item.surcharges.length){limitations.push(`${name}/${item.item_id}: line calculation needs price base or adjustment rules`);continue;}
   if(rational(item.price_base_quantity)[0]<=0n){limitations.push(`${name}/${item.item_id}: invalid price base`);continue;}
   check(`line ${item.item_id}: quantity × unit price / price base`,item.total_price,div(mul(rational(item.quantity),rational(item.unit_price)),rational(item.price_base_quantity)),item.source_reference);
  }
  const t=doc.totals,source=t.source_references.join('; ');
  if(!doc.adjustments.length&&doc.line_items.every(x=>x.price_basis==='net'&&x.total_price!==null))check('sum of net lines',t.subtotal_net,doc.line_items.reduce((s,x)=>add(s,rational(x.total_price)),[0n,1n]),source);
  else limitations.push(`${name}: net subtotal requires adjustment or price-basis review`);
  for(const tax of t.tax_breakdown)if(tax.rate!==null&&tax.taxable_amount!==null)check('VAT: taxable amount × rate',tax.tax_amount,mul(rational(tax.rate),rational(tax.taxable_amount)),tax.source_reference);
  if(t.subtotal_net!==null&&t.tax_amount!==null)check('gross = net + VAT',t.total_gross,add(rational(t.subtotal_net),rational(t.tax_amount)),source);
 }
 const documentDifferences=[];
 if(data.offer&&data.invoice&&data.offer.currency===data.invoice.currency&&['EUR','USD','GBP','CHF'].includes(data.offer.currency)){
  for(const field of ['subtotal_net','tax_amount','total_gross']){
   const a=data.offer.totals[field],b=data.invoice.totals[field];
   if(a!==null&&b!==null){const [n,d]=rational(a);documentDifferences.push({field,offer:a,invoice:b,difference:money(add(rational(b),[-n,d]),2),currency:data.offer.currency,meaning:'Document total difference only; not proof of overcharge or equivalent scope',sources:[...data.offer.totals.source_references,...data.invoice.totals.source_references]});}
  }
 }
 return {checks,limitations,documentDifferences,scope:'Arithmetic checks only. Extraction, identity, scope and contractual interpretation still require source review.'};
}
export function verificationMarkdown(v,language='en'){
 if(!['en','de'].includes(language))return '';
 const de=language==='de';
 const escape=s=>String(s).replaceAll('|','\\|').replaceAll('\n',' ');
 const label=s=>de?String(s).replace(/offer/g,'Angebot').replace(/invoice/g,'Rechnung').replace(/quantity × unit price \/ price base/g,'Menge × Einzelpreis / Preisbasis').replace(/line /g,'Position ').replace(/sum of net lines/g,'Summe der Nettopositionen').replace(/VAT: taxable amount × rate/g,'USt.: Bemessungsgrundlage × Steuersatz').replace(/gross = net \+ VAT/g,'Brutto = Netto + USt.').replace(/net subtotal requires adjustment or price-basis review/g,'Nettosumme erfordert Prüfung der Zu- und Abschläge oder Preisbasis').replace(/line calculation needs price base or adjustment rules/g,'Positionsberechnung benötigt Preisbasis oder Regeln für Zu- und Abschläge').replace(/unsupported or unknown currency precision/g,'nicht unterstützte oder unbekannte Währungsgenauigkeit').replace(/document unavailable/g,'Dokument nicht verfügbar').replace(/unavailable/g,'nicht verfügbar').replace(/invalid price base/g,'ungültige Preisbasis'):s;
 return (de?'\n\n## Rechnerische Prüfung\n\nDie Prüfung verwendet extrahierte Werte und bestätigt nicht deren Erkennungsgenauigkeit.\n\n| Dokument / Prüfung | Angegeben | Berechnet | Ergebnis | Quelle |\n':'\n\n## Calculation evidence\n\nChecks use extracted values; they do not certify extraction accuracy.\n\n| Document / check | Stated | Calculated | Result | Source |\n')+'|---|---:|---:|---|---|\n'+v.checks.map(c=>`| ${escape(label(c.document+' / '+c.label))} | ${c.stated} ${c.currency} | ${c.calculated} ${c.currency} | ${c.matches?(de?'Stimmt überein':'Matches'):(de?'Abweichung prüfen':'Review mismatch')} | ${escape(c.source_reference)} |`).join('\n')+(v.documentDifferences?.length?(de?'\n\nDifferenzen der Dokumentsummen (Rechnung minus Angebot; nicht automatisch eine Überberechnung):\n':'\n\nDocument-total differences (invoice minus offer; not automatically an overcharge):\n')+v.documentDifferences.map(x=>'- '+(de?{subtotal_net:'Nettosumme',tax_amount:'Umsatzsteuer',total_gross:'Bruttosumme'}[x.field]:x.field)+': '+x.difference+' '+x.currency).join('\n'):'')+(v.limitations.length?(de?'\n\nNicht verifizierte Prüfungen:\n':'\n\nUnverified checks:\n')+v.limitations.map(x=>'- '+escape(label(x))).join('\n'):'');
}
