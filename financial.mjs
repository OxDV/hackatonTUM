import {rational,add,mul,div,money} from './verification.mjs';
const supported=new Set(['EUR','USD','GBP','CHF']);
const subtract=(a,b)=>add(a,[-b[0],b[1]]);
export function comparisonFinancial(data,reference,finding){
 if(finding.kind!=='difference'||!reference||!data.offer||!data.invoice||data.offer.currency!==data.invoice.currency||!supported.has(data.invoice.currency))return null;
 if(finding.offer&&finding.offer.filename!==data.offer.source_filename||finding.invoice&&finding.invoice.filename!==data.invoice.source_filename)throw Error('Finding evidence refers to another document');
 const currency=data.invoice.currency;
 if(reference.scope==='document'){
  const field=reference.metric;
  if(!['subtotal_net','tax_amount','total_gross'].includes(field))return null;
  const a=data.offer.totals[field],b=data.invoice.totals[field];if(a===null||b===null)return null;
  return {scope:'document',currency,basis:field==='total_gross'?'gross':'net',offerTotal:money(rational(a),2),invoiceTotal:money(rational(b),2),difference:money(subtract(rational(b),rational(a)),2),unitFrom:null,unitTo:null,percent:null,unit:null,offerMissing:false};
 }
 if(reference.scope!=='line')return null;
 const select=(doc,ids)=>{if(new Set(ids).size!==ids.length)throw Error('Duplicate financial item reference');return ids.map(id=>{const item=doc.line_items.find(x=>x.item_id===id);if(!item)throw Error('Unknown financial item reference');return item;});};
 const offers=select(data.offer,reference.offerItemIds),invoices=select(data.invoice,reference.invoiceItemIds);
 if(!offers.length&&!invoices.length)return null;
 const lines=[...offers,...invoices];const basis=lines[0].price_basis;
 if(!['net','gross'].includes(basis)||lines.some(l=>l.price_basis!==basis||l.total_price===null))return null;
 const sum=items=>items.reduce((total,item)=>add(total,rational(item.total_price)),[0n,1n]);
 const a=sum(offers),b=sum(invoices);
 const result={scope:'line',currency,basis,offerTotal:money(a,2),invoiceTotal:money(b,2),difference:money(subtract(b,a),2),unitFrom:null,unitTo:null,percent:null,unit:null,offerMissing:!offers.length};
 if(offers.length===1&&invoices.length===1){
  const [x]=offers,[y]=invoices;
  if(x.unit_price!==null&&y.unit_price!==null&&x.price_base_quantity!==null&&x.price_base_quantity===y.price_base_quantity&&x.unit&&x.unit===y.unit){
   result.unitFrom=x.unit_price;result.unitTo=y.unit_price;result.unit=x.price_base_quantity==='1'?'/'+x.unit:'/'+x.price_base_quantity+' '+x.unit;
   if(rational(x.unit_price)[0]!==0n)result.percent=money(mul(div(subtract(rational(y.unit_price),rational(x.unit_price)),rational(x.unit_price)),[100n,1n]),2);
  }
 }
 return result;
}
