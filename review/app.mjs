import * as pdfjs from '/pdf.mjs';
import {locateEvidence} from '/match.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.mjs';
const token=location.hash.slice(1),headers={Authorization:'Bearer '+token},panes={},state={selected:-1},$=id=>document.getElementById(id);
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
let report,dialogText='';
const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'EUR',minimumFractionDigits:2});
function number(value){return Number(String(value).replaceAll(',',''));}
function amount(text,preferTotal=true){
 const source=String(text||'');const total=source.match(/line total\s+EUR\s*([\d,.]+)/i);
 const first=source.match(/EUR\s*([\d,.]+)/i);const match=preferTotal&&total?total:first;
 return match?number(match[1]):null;
}
function financial(finding){
 const offerMissing=/not present|no matching/i.test(finding.offerValue);
 const offerTotal=amount(finding.offerValue),invoiceTotal=amount(finding.invoiceValue);
 const stated=finding.explanation.match(/\b(increas\w*|decreas\w*|reduc\w*)\b[^.]*?\bline\b[^.]*?\b(?:by|of)\s+EUR\s*([\d,.]+)/i);
 let difference=stated?number(stated[2])*(/^increas/i.test(stated[1])?1:-1):null;
 if(difference===null&&invoiceTotal!==null&&(offerTotal!==null||offerMissing))difference=invoiceTotal-(offerTotal||0);
 const unit=finding.title.match(/from EUR\s*([\d,.]+)\s+to EUR\s*([\d,.]+)/i);
 const unitSuffix=String(finding.invoiceValue).match(/EUR\s*[\d,.]+\s*([^,]+?)(?:,\s*line total|$)/i)?.[1]?.trim()||'';
 const unitFrom=unit?number(unit[1]):null,unitTo=unit?number(unit[2]):null;
 const percent=unitFrom&&unitTo?(unitTo-unitFrom)/unitFrom*100:null;
 return {offerMissing,offerTotal,invoiceTotal,difference,unitFrom,unitTo,unitSuffix,percent};
}
function signedMoney(value){if(value===null)return 'Difference not quantified';return (value>0?'+':value<0?'−':'')+money.format(Math.abs(value));}
function comparisonText(value,missing){return missing?'Not present':value===null?'Not quantified':money.format(value);}
async function render(kind){
 const p=panes[kind];if(!p)return;p.generation=(p.generation||0)+1;const generation=p.generation;const root=$(kind);root.replaceChildren();p.pages=[];
 $(kind+'-zoom').textContent=Math.round(p.zoom*100)+'%';
 for(let n=1;n<=p.doc.numPages;n++){
  const page=await p.doc.getPage(n);if(generation!==p.generation)return;
  const viewport=page.getViewport({scale:p.zoom});const div=node('div',undefined,'page');div.style.width=viewport.width+'px';div.style.height=viewport.height+'px';
  const canvas=node('canvas');canvas.width=viewport.width*devicePixelRatio;canvas.height=viewport.height*devicePixelRatio;canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';div.append(canvas);root.append(div);
  await page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[devicePixelRatio,0,0,devicePixelRatio,0,0]}).promise;
  const text=await page.getTextContent();p.pages[n]={div,viewport,items:text.items.filter(x=>typeof x.str==='string')};
 }
 highlight(kind,true);
}
function highlight(kind,scroll=true){
 const pane=panes[kind];if(!pane)return;pane.pages.forEach(p=>p.div.querySelectorAll('.hit').forEach(x=>x.remove()));
 const evidence=report.findings[state.selected]?.[kind];if(!evidence||evidence.filename!==pane.name)return;
 const located=locateEvidence(pane.pages,report.findings[state.selected],kind);
 const page=pane.pages[located?.page??evidence.page];if(!page)return;
 const matches=located?.indexes||[];let first;
 const card=document.querySelector('.finding.active');card?.querySelector(`[data-warning="${kind}"]`)?.remove();
 for(const i of matches){const item=page.items[i];const tr=pdfjs.Util.transform(page.viewport.transform,item.transform);const height=Math.hypot(tr[2],tr[3]);const hit=node('div',undefined,'hit');Object.assign(hit.style,{left:tr[4]+'px',top:tr[5]-height+'px',width:item.width*pane.zoom+'px',height:height+'px'});hit.title=evidence.quote;page.div.append(hit);first??=hit;}
 if(scroll){const container=$(kind),target=first||page.div;const top=container.scrollTop+target.getBoundingClientRect().top-container.getBoundingClientRect().top-60;container.scrollTo({top:Math.max(0,top),behavior:'smooth'});}
 if(card&&!matches.length){const warning=node('p',kind+': no unique source match; showing cited page without a highlight.','notice');warning.dataset.warning=kind;card.querySelector(`[data-warning="${kind}"]`)?.remove();card.append(warning);}
}
function select(i){state.selected=i===state.selected?-1:Math.max(0,Math.min(i,report.findings.length-1));draw();highlight('offer');highlight('invoice');}
function draw(){
 $('count').textContent='· '+report.findings.length+' findings';$('findings').replaceChildren();
 $('prev').disabled=state.selected<=0;$('next').disabled=state.selected>=report.findings.length-1;
 report.findings.forEach((f,i)=>{
  const data=financial(f),card=node('article',undefined,'finding'+(i===state.selected?' active':''));card.tabIndex=0;card.setAttribute('aria-current',i===state.selected?'true':'false');
  const top=node('div',undefined,'finding-top');top.append(node('span',String(i+1).padStart(2,'0'),'finding-index'),node('h3',f.title));card.append(top);
  const impact=node('div',undefined,'financial-impact '+(data.difference===null?'unquantified':data.difference>0?'cost':data.difference<0?'saving':'neutral'));const primary=node('div',undefined,'impact-primary');
  const figure=node('div',undefined,'impact-figure');figure.append(node('strong',signedMoney(data.difference),'impact-amount'));if(data.difference!==null)figure.append(node('span','net','impact-net'));
  primary.append(figure,node('span',data.difference===null?'Review the documented values':data.difference>0?'Additional cost on this line':data.difference<0?'Saving on this line':'No net change','impact-label'));impact.append(primary);
  if(data.offerTotal!==null||data.invoiceTotal!==null){
   const comparison=node('div',undefined,'amount-comparison');
   comparison.append(node('span','Offer '+comparisonText(data.offerTotal,data.offerMissing),'amount offer-amount'),node('span','→','comparison-arrow'),node('span','Invoice '+comparisonText(data.invoiceTotal,false),'amount invoice-amount'));impact.append(comparison);
  }
  if(data.unitFrom!==null&&data.unitTo!==null){
   const unit=node('div',undefined,'unit-comparison');
   unit.append(node('span',money.format(data.unitFrom)),node('span','→','unit-arrow'),node('span',money.format(data.unitTo)+data.unitSuffix),node('span',(data.percent>=0?'+':'')+data.percent.toFixed(2)+'%','percentage'));impact.append(unit);
  }
  card.append(impact);card.onclick=()=>select(i);card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(i);}};
  if(i===state.selected){
   card.append(node('p',f.explanation,'finding-explanation'));
   const evidence=node('div',undefined,'evidence-list');
   for(const kind of ['offer','invoice'])if(f[kind]){
    const row=node('div',undefined,'evidence-row'),label=node('span',kind,'evidence-kind'),body=node('div',undefined,'evidence-body');
    body.append(node('span',`${f[kind].filename} · page ${f[kind].page}`,'evidence-source'),node('q',f[kind].quote,'evidence-quote'));row.append(label,body);evidence.append(row);
   }
   card.append(evidence);
  }
  $('findings').append(card);
 });
}
$('prev').onclick=()=>select(state.selected-1);$('next').onclick=()=>select(state.selected+1);
function responseDraft(text){
 const heading=/^##\s+Supplier Email Draft\s*$/mi.exec(text);if(!heading)return text;
 const rest=text.slice(heading.index+heading[0].length),next=/^##\s+/m.exec(rest);
 return rest.slice(0,next?.index??rest.length).trim();
}
function openReport(mode){
 const draft=mode==='draft';dialogText=draft?responseDraft(report.report):report.report;
 $('dialog-eyebrow').textContent=draft?'OIC / RESPONSE DRAFT':'OIC / FULL REPORT';
 $('dialog-title').textContent=draft?'Supplier response draft':'Comparison report';
 $('copy').textContent=draft?'Copy draft':'Copy report';
 $('report-text').textContent=dialogText;$('report').showModal();
}
$('summary').onclick=()=>openReport('full');$('response-draft').onclick=()=>openReport('draft');$('close').onclick=()=>$('report').close();$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(dialogText);$('copy').textContent='Copied';}catch{$('copy').textContent='Select and copy the text below';}};
document.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>{const [kind,direction]=b.dataset.zoom.split(',');if(panes[kind]){panes[kind].zoom=Math.max(.4,Math.min(2,panes[kind].zoom+Number(direction)*.15));render(kind).catch(showError);}});
function showError(e){$('status').replaceChildren(node('span','Unable to open report: '+e.message,'meta-item'));}
function showReady(expiresAt){
 const status=$('status');status.replaceChildren();
 status.append(node('span','Expires '+new Date(expiresAt).toLocaleString(),'meta-item meta-expiry'));
}
try{
 const response=await fetch('/api/report',{headers});if(!response.ok)throw Error('Link unavailable or expired');report=await response.json();showReady(report.expiresAt);draw();
 for(const kind of ['offer','invoice']){const target=report.findings.map(f=>f[kind]).find(Boolean);const d=report.documents.find(d=>d.role===kind)||(target&&report.documents.find(d=>d.name===target.filename));if(!d){$(kind).textContent='No source PDF identified for this document.';continue;}const r=await fetch('/api/pdf/'+d.index,{headers});if(!r.ok)throw Error('PDF unavailable');const doc=await pdfjs.getDocument({data:new Uint8Array(await r.arrayBuffer()),isEvalSupported:false}).promise;panes[kind]={doc,name:d.name,zoom:Math.min(1,($(kind).clientWidth-24)/612),pages:[]};await render(kind);}
 if(!report.findings.length)$('findings').append(node('p','No structured findings. Read the full report.','notice'));
}catch(e){showError(e);}
