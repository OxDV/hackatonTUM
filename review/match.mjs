export const normalize=s=>s.normalize('NFKC').replace(/\s/g,'').toLowerCase();
// Never choose an arbitrary occurrence when a quote is repeated on a page.
export function locateQuote(items,quote){
 const parts=items.map(i=>normalize(i.str));const text=parts.join(''),needle=normalize(quote);if(!needle)return [];
 const start=text.indexOf(needle);if(start<0||text.indexOf(needle,start+1)>=0)return [];
 const end=start+needle.length;let offset=0;const indexes=[];
 for(let i=0;i<parts.length;i++){if(offset<end&&offset+parts[i].length>start)indexes.push(i);offset+=parts[i].length;}
 return indexes;
}

function amounts(value){
 return [...String(value).matchAll(/-?\d[\d.,]*[.,]\d{2}(?!\d)/g)].map(m=>{
  const raw=m[0],last=Math.max(raw.lastIndexOf(','),raw.lastIndexOf('.'));
  return raw.slice(0,last).replace(/[.,]/g,'')+'.'+raw.slice(last+1);
 });
}
// Prefer a unique monetary row across the document, not an unreliable model page.
export function locateEvidence(pages,finding,kind){
 const evidence=finding?.[kind];if(!evidence)return null;
 const expected=[...new Set(amounts(finding[kind+'Value']))];
 if(expected.length){
  const candidates=[];
  pages.forEach((page,pageNumber)=>{
   if(!page)return;
   const rows=[];
   page.items.forEach((item,index)=>{const y=item.transform?.[5];if(!Number.isFinite(y))return;let row=rows.find(r=>Math.abs(r.y-y)<3);if(!row){row={y,indexes:[]};rows.push(row);}row.indexes.push(index);});
   for(const row of rows){const found=row.indexes.flatMap(i=>amounts(page.items[i].str));if(expected.every(a=>found.includes(a))){const indexes=row.indexes.filter(i=>amounts(page.items[i].str).some(a=>expected.includes(a)));candidates.push({page:pageNumber,indexes,row});}}
  });
  if(candidates.length===1)return {...candidates[0],method:'value'};
  // Disambiguate repeated amounts only with a position number on that same row.
  const position=finding.title.match(/\b(?:position|pos\.?)\s*(\d+)\b/i)?.[1]||evidence.quote.match(/^\s*(\d+)\s/)?.[1];
  if(position){const scoped=candidates.filter(c=>{const items=pages[c.page].items;const left=Math.min(...c.row.indexes.map(i=>items[i].transform[4]));return c.row.indexes.some(i=>items[i].str.trim()===position&&Math.abs(items[i].transform[4]-left)<3);});if(scoped.length===1)return {...scoped[0],method:'value'};}
 }
 // Literal quotes remain useful for non-monetary findings and scanned text layers.
 const fragments=evidence.quote.split(/\.{3}|…/).map(x=>x.trim()).filter(x=>normalize(x).length>=8);
 for(const quote of [evidence.quote,...fragments.sort((a,b)=>b.length-a.length)]){
  const matches=[];pages.forEach((p,n)=>{if(!p)return;const indexes=locateQuote(p.items,quote);if(indexes.length)matches.push({page:n,indexes,method:'quote'});});
  if(matches.length===1)return matches[0];
 }
 return null;
}
