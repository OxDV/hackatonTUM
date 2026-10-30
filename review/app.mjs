import * as pdfjs from '/pdf.mjs';
import {locateEvidence} from '/match.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.mjs';
const token=location.hash.slice(1),headers={Authorization:'Bearer '+token},panes={},state={selected:0},$=id=>document.getElementById(id);
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
let report,marks={};try{marks=JSON.parse(localStorage.getItem('review:'+token)||'{}');}catch{}
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
function select(i){state.selected=Math.max(0,Math.min(i,report.findings.length-1));draw();highlight('offer');highlight('invoice');}
function draw(){
 $('count').textContent=report.findings.length+' findings';$('findings').replaceChildren();
 report.findings.forEach((f,i)=>{const card=node('article',undefined,'finding'+(i===state.selected?' active':''));card.tabIndex=0;card.append(node('span',f.priority+' · '+(marks[i]||'pending'),'tag'),node('h3',f.title));card.onclick=()=>select(i);card.onkeydown=e=>{if(e.key==='Enter')select(i);};
 if(i===state.selected){card.append(node('p',f.explanation));const values=node('div',undefined,'values');values.append(node('div','Offer: '+f.offerValue),node('div','Invoice: '+f.invoiceValue));card.append(values);for(const kind of ['offer','invoice'])if(f[kind])card.append(node('p',`${kind}: ${f[kind].filename}, page ${f[kind].page} · “${f[kind].quote}”`));const actions=node('div',undefined,'review-actions');for(const label of ['Reviewed','Needs clarification']){const b=node('button',label);b.onclick=e=>{e.stopPropagation();marks[i]=label;try{localStorage.setItem('review:'+token,JSON.stringify(marks));}catch{}draw();};actions.append(b);}card.append(actions);}$('findings').append(card);});
}
$('prev').onclick=()=>select(state.selected-1);$('next').onclick=()=>select(state.selected+1);
$('summary').onclick=()=>$('report').showModal();$('close').onclick=()=>$('report').close();$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(report.report);$('copy').textContent='Copied';}catch{$('copy').textContent='Select and copy the report below';}};
document.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>{const [kind,direction]=b.dataset.zoom.split(',');if(panes[kind]){panes[kind].zoom=Math.max(.4,Math.min(2,panes[kind].zoom+Number(direction)*.15));render(kind).catch(showError);}});
function showError(e){$('status').textContent='Unable to open report: '+e.message;}
try{
 const response=await fetch('/api/report',{headers});if(!response.ok)throw Error('Link unavailable or expired');report=await response.json();$('report-text').textContent=report.report;$('status').textContent='Evidence-based review · Expires '+new Date(report.expiresAt).toLocaleString();draw();
 for(const kind of ['offer','invoice']){const target=report.findings.map(f=>f[kind]).find(Boolean);const d=report.documents.find(d=>d.role===kind)||(target&&report.documents.find(d=>d.name===target.filename));if(!d){$(kind).textContent='No source PDF identified for this document.';continue;}const r=await fetch('/api/pdf/'+d.index,{headers});if(!r.ok)throw Error('PDF unavailable');const doc=await pdfjs.getDocument({data:new Uint8Array(await r.arrayBuffer()),isEvalSupported:false}).promise;panes[kind]={doc,name:d.name,zoom:Math.min(1,($(kind).clientWidth-24)/612),pages:[]};await render(kind);}
 if(!report.findings.length)$('findings').append(node('p','No structured findings. Read the full report.','notice'));
}catch(e){showError(e);}
