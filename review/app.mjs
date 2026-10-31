import * as pdfjs from '/pdf.mjs';
import {comparisonView} from '/data.mjs';
import {buildDraft,mailto} from '/draft.mjs';
import {locateEvidence} from '/match.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.mjs';
const token=location.hash.slice(1),headers={Authorization:'Bearer '+token},panes={},state={selected:-1},$=id=>document.getElementById(id);
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
let report,collection,dialogText='',viewGeneration=0;
const documents=new Map();
function tr(en,de){return (report?.language||collection?.language||'en').startsWith('de')?de:en;}
function periodLabel(label){const months=['January','February','March','April','May','June','July','August','September','October','November','December'];const i=months.indexOf(label);return i<0?label:new Intl.DateTimeFormat(collection.language||'en',{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(new Date().getUTCFullYear(),i,1)));}
function localizeChrome(){
 $('summary').querySelector('span').textContent=tr('Full report','Vollständiger Bericht');
 $('response-draft').querySelector('span').textContent=tr('Response draft','E-Mail-Entwurf');
 document.querySelector('.offer-document .panel-title b').textContent=tr('Offer','Angebot');
 document.querySelector('.invoice-document .panel-title b').textContent=tr('Invoice','Rechnung');
 document.querySelector('.findings-heading h2').textContent=tr('Findings','Feststellungen');
 $('prev').textContent=tr('← Prev','← Zurück');$('next').textContent=tr('Next →','Weiter →');
 for(const [id,en,de] of [['draft-to','To','An'],['draft-subject','Subject','Betreff'],['draft-body','Message','Nachricht']])$(id).parentElement.firstChild.textContent=tr(en,de);
 $('open-mail').textContent=tr('Open in mail app','Im E-Mail-Programm öffnen');
 $('draft-notice').textContent=tr('Opens your default mail app. Review the recipient and message before sending.','Öffnet Ihr E-Mail-Programm. Bitte Empfänger und Nachricht vor dem Versand prüfen.');
 document.querySelector('.findings-panel > .notice').textContent=tr('Review findings and supporting evidence in the report.','Bitte Feststellungen und Belege im Bericht prüfen.');
}
function formatMoney(value,currency){return new Intl.NumberFormat(report?.language||collection?.language||'en',{style:'currency',currency}).format(value);}
function signedMoney(value,currency){const text=String(value);return (text.startsWith('-')?'−':/^0(?:\.0*)?$/.test(text)?'':'+')+formatMoney(text.replace(/^-/,'') ,currency);}
function comparisonText(value,missing,currency){return missing?tr('Not present','Nicht vorhanden'):formatMoney(value,currency);}
async function render(kind){
 const p=panes[kind];if(!p||p.viewGeneration!==viewGeneration)return;p.generation=(p.generation||0)+1;const generation=p.generation;const root=$(kind);root.replaceChildren();p.pages=[];
 $(kind+'-zoom').textContent=Math.round(p.zoom*100)+'%';
 for(let n=1;n<=p.doc.numPages;n++){
  const page=await p.doc.getPage(n);if(generation!==p.generation||p.viewGeneration!==viewGeneration||panes[kind]!==p)return;
  const viewport=page.getViewport({scale:p.zoom});const div=node('div',undefined,'page');div.style.width=viewport.width+'px';div.style.height=viewport.height+'px';
  const canvas=node('canvas');canvas.width=viewport.width*devicePixelRatio;canvas.height=viewport.height*devicePixelRatio;canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';div.append(canvas);root.append(div);
  await page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[devicePixelRatio,0,0,devicePixelRatio,0,0]}).promise;
  const text=await page.getTextContent();if(generation!==p.generation||p.viewGeneration!==viewGeneration||panes[kind]!==p)return;p.pages[n]={div,viewport,items:text.items.filter(x=>typeof x.str==='string')};
 }
 highlight(kind,true);
}
function highlight(kind,scroll=true){
 const pane=panes[kind];if(!pane)return;pane.pages.forEach(p=>p.div.querySelectorAll('.hit').forEach(x=>x.remove()));
 const evidence=report.findings[state.selected]?.[kind];if(!evidence||evidence.filename!==pane.name)return;
 const located=locateEvidence(pane.pages,report.findings[state.selected],kind);
 const page=pane.pages[located?.page??evidence.page];if(!page)return;
 const matches=located?.indexes||[];let first;
 const card=document.querySelector('.finding.active');if(card)delete card.dataset[kind+'Warning'];
 for(const i of matches){const item=page.items[i];const tr=pdfjs.Util.transform(page.viewport.transform,item.transform);const height=Math.hypot(tr[2],tr[3]);const hit=node('div',undefined,'hit');Object.assign(hit.style,{left:tr[4]+'px',top:tr[5]-height+'px',width:item.width*pane.zoom+'px',height:height+'px'});hit.title=evidence.quote;page.div.append(hit);first??=hit;}
 if(scroll){const container=$(kind),target=first||page.div;const top=container.scrollTop+target.getBoundingClientRect().top-container.getBoundingClientRect().top-60;container.scrollTo({top:Math.max(0,top),behavior:'smooth'});}
 if(card&&!matches.length)card.dataset[kind+'Warning']=tr(kind+': no unique source match; showing cited page without a highlight.',(kind==='offer'?'Angebot':'Rechnung')+': Kein eindeutiger Beleg gefunden; die zitierte Seite wird ohne Markierung angezeigt.');
}
const helpTip=node('div',undefined,'finding-tooltip');helpTip.id='finding-tooltip';helpTip.setAttribute('role','tooltip');helpTip.hidden=true;document.body.append(helpTip);
let helpAnchor=null,helpTimer;
function closeHelp(){clearTimeout(helpTimer);helpAnchor?.removeAttribute('aria-describedby');helpAnchor=null;helpTip.hidden=true;}
function closeHelpSoon(){clearTimeout(helpTimer);helpTimer=setTimeout(()=>{if(!helpTip.matches(':hover')&&document.activeElement!==helpAnchor)closeHelp();},140);}
function showHelp(button,f){
 clearTimeout(helpTimer);helpAnchor?.removeAttribute('aria-describedby');helpAnchor=button;button.setAttribute('aria-describedby',helpTip.id);
 helpTip.replaceChildren(node('strong',f.title,'tooltip-title'),node('p',f.explanation,'finding-explanation'));
 const values=node('div',undefined,'source-values');values.append(node('p',tr('Offer: ','Angebot: ')+f.offerValue),node('p',tr('Invoice: ','Rechnung: ')+f.invoiceValue));helpTip.append(values);
 const evidence=node('div',undefined,'evidence-list');
 for(const kind of ['offer','invoice'])if(f[kind]){
  const row=node('div',undefined,'evidence-row'),label=node('span',kind==='offer'?tr('Offer','Angebot'):tr('Invoice','Rechnung'),'evidence-kind'),body=node('div',undefined,'evidence-body');
  body.append(node('span',`${f[kind].filename} · ${tr('page','Seite')} ${f[kind].page}`,'evidence-source'),node('q',f[kind].quote,'evidence-quote'));row.append(label,body);evidence.append(row);
  const warning=button.closest('.finding').dataset[kind+'Warning'];if(warning)evidence.append(node('p',warning,'notice'));
 }
 helpTip.append(evidence);helpTip.hidden=false;
 const anchor=button.getBoundingClientRect(),bounds=helpTip.getBoundingClientRect();
 const left=innerWidth>800?anchor.left-bounds.width-14:Math.min(anchor.left,innerWidth-bounds.width-16);
 const top=innerWidth>800?anchor.top-12:anchor.bottom+10;
 helpTip.style.left=Math.max(16,Math.min(left,innerWidth-bounds.width-16))+'px';
 helpTip.style.top=Math.max(12,Math.min(top,innerHeight-bounds.height-12))+'px';
}
helpTip.addEventListener('pointerenter',()=>clearTimeout(helpTimer));helpTip.addEventListener('pointerleave',closeHelpSoon);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeHelp();});
document.addEventListener('pointerdown',e=>{if(!helpTip.contains(e.target)&&!helpAnchor?.contains(e.target))closeHelp();});
document.addEventListener('scroll',e=>{if(!helpTip.contains(e.target))closeHelp();},true);window.addEventListener('resize',closeHelp);
function select(i){
 state.selected=Math.max(0,Math.min(i,report.findings.length-1));
 document.querySelectorAll('.finding').forEach((card,index)=>{card.classList.toggle('active',index===state.selected);card.setAttribute('aria-current',String(index===state.selected));});
 $('prev').disabled=state.selected<=0;$('next').disabled=state.selected>=report.findings.length-1;
 highlight('offer');highlight('invoice');
}
function draw(){
 closeHelp();
 $('count').textContent='· '+report.findings.length+' '+tr('findings','Feststellungen');$('findings').replaceChildren();
 if(!report.findings.length)$('findings').append(node('p',report.status==='matched'?tr('No differences found.','Keine Abweichungen gefunden.'):tr('No confirmed differences. Review the full report for remaining checks.','Keine bestätigten Abweichungen. Weitere Prüfpunkte stehen im vollständigen Bericht.'),'notice'));
 $('prev').disabled=state.selected<=0;$('next').disabled=state.selected>=report.findings.length-1;
 report.findings.forEach((f,i)=>{
  const data=f.financial||null,card=node('article',undefined,'finding'+(i===state.selected?' active':''));card.tabIndex=0;card.setAttribute('aria-current',i===state.selected?'true':'false');
  const top=node('div',undefined,'finding-top');top.append(node('span',String(i+1).padStart(2,'0'),'finding-index'),node('h3',f.title));
  const help=node('button','?','finding-help');help.type='button';help.setAttribute('aria-label',tr('Details and source evidence','Details und Quellenbelege'));
  help.onpointerenter=()=>showHelp(help,f);help.onpointerleave=closeHelpSoon;help.onfocus=()=>showHelp(help,f);help.onblur=closeHelpSoon;help.onclick=e=>{e.stopPropagation();showHelp(help,f);};
  top.append(help);card.append(top);
  if(f.kind)card.append(node('span',f.kind==='difference'?tr('Difference','Abweichung'):f.kind==='note'?tr('Context note','Hinweis'):tr('Needs review','Prüfung erforderlich'),'finding-kind'));
  if(data){
   const difference=Number(data.difference);
   const impact=node('div',undefined,'financial-impact '+(difference>0?'cost':difference<0?'saving':'neutral'));
   const primary=node('div',undefined,'impact-primary'),figure=node('div',undefined,'impact-figure');
   figure.append(node('strong',signedMoney(data.difference,data.currency),'impact-amount'),node('span',data.basis==='net'?tr('net','netto'):tr('gross','brutto'),'impact-net'));
   const label=data.scope==='document'?tr('Document total difference','Differenz der Dokumentsummen'):difference>0?tr('Additional cost on this line','Mehrkosten dieser Position'):difference<0?tr('Saving on this line','Ersparnis dieser Position'):tr('No net change','Keine Nettoänderung');
   primary.append(figure,node('span',label,'impact-label'));impact.append(primary);
   const comparison=node('div',undefined,'amount-comparison');
   comparison.append(node('span',tr('Offer ','Angebot ')+comparisonText(data.offerTotal,data.offerMissing,data.currency),'amount offer-amount'),node('span','→','comparison-arrow'),node('span',tr('Invoice ','Rechnung ')+formatMoney(data.invoiceTotal,data.currency),'amount invoice-amount'));impact.append(comparison);
   if(data.unitFrom!==null&&data.unitTo!==null){
    const unit=node('div',undefined,'unit-comparison');
    unit.append(node('span',formatMoney(data.unitFrom,data.currency)),node('span','→','unit-arrow'),node('span',formatMoney(data.unitTo,data.currency)+(data.unit||'')));
    if(data.percent!==null)unit.append(node('span',new Intl.NumberFormat(report.language||'en',{style:'percent',signDisplay:'always',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(data.percent)/100),'percentage'));
    impact.append(unit);
   }
   card.append(impact);
  }
  card.onclick=()=>select(i);card.onkeydown=e=>{if(e.target===card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();select(i);}};
  $('findings').append(card);
 });
}
$('prev').onclick=()=>select(state.selected-1);$('next').onclick=()=>select(state.selected+1);
let draftMode=false;
function updateMail(){
 const href=mailto($('draft-to').value.trim(),$('draft-subject').value,$('draft-body').value);
 $('open-mail').hidden=!draftMode||!href;
 if(href)$('open-mail').href=href;else $('open-mail').removeAttribute('href');
 dialogText=tr('Subject: ','Betreff: ')+$('draft-subject').value+'\n\n'+$('draft-body').value;
}
for(const id of ['draft-to','draft-subject','draft-body'])$(id).addEventListener('input',updateMail);
function openReport(mode){
 closeHelp();
 const draft=mode==='draft';draftMode=draft;dialogText=report.report;
 $('draft-fields').hidden=!draft;$('report-text').hidden=draft;$('open-mail').hidden=true;
 if(draft){const message=buildDraft(collection);$('draft-to').value=message.to;$('draft-subject').value=message.subject;$('draft-body').value=message.body;updateMail();}
 $('dialog-eyebrow').textContent=draft?tr('OIC / RESPONSE DRAFT','OIC / E-MAIL-ENTWURF'):tr('OIC / FULL REPORT','OIC / VERGLEICHSBERICHT');
 $('dialog-title').textContent=draft?tr('Supplier response draft','E-Mail-Entwurf an den Lieferanten'):tr('Comparison report','Vergleichsbericht');
 $('copy').textContent=draft?tr('Copy draft','Entwurf kopieren'):tr('Copy report','Bericht kopieren');
 $('report-text').textContent=dialogText;$('report').showModal();
}
$('summary').onclick=()=>openReport('full');$('response-draft').onclick=()=>openReport('draft');$('close').onclick=()=>$('report').close();$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(dialogText);$('copy').textContent='Copied';}catch{$('copy').textContent='Select and copy the text below';}};
document.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>{const [kind,direction]=b.dataset.zoom.split(',');if(panes[kind]){panes[kind].zoom=Math.max(.4,Math.min(2,panes[kind].zoom+Number(direction)*.15));render(kind).catch(showError);}});
function showError(e){if(!report){$('summary').disabled=true;$('response-draft').disabled=true;}$('status').replaceChildren(node('span','Unable to open report: '+e.message,'meta-item'));}
function showReady(expiresAt){
 const status=$('status');status.replaceChildren();
 status.append(node('span',tr('Expires ','Gültig bis ')+new Date(expiresAt).toLocaleString(collection?.language||undefined),'meta-item meta-expiry'));
}
function statusLabel(value){return {matched:tr('No differences found','Keine Abweichungen'),differences:tr('Differences found','Abweichungen gefunden'),uncertain:tr('Needs review','Prüfung erforderlich')}[value];}
async function openComparison(index){
 closeHelp();
 const generation=++viewGeneration;
 $('findings').replaceChildren();$('prev').disabled=true;$('next').disabled=true;report=null;
 for(const kind of ['offer','invoice']){if(panes[kind])panes[kind].generation++;delete panes[kind];$(kind).replaceChildren(node('p','Loading PDF…','notice'));}
 report=comparisonView(collection,index);
 state.selected=-1;$('summary').disabled=false;$('response-draft').disabled=false;localizeChrome();draw();
 document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.period)===index)));
 for(const kind of ['offer','invoice']){
  const filename=report[kind+'Filename'];const target=report.findings.map(f=>f[kind]).find(Boolean);
  const d=filename?report.documents.find(d=>d.name===filename):report.documents.find(d=>d.role===kind)||(target&&report.documents.find(d=>d.name===target.filename));
  if(!d){$(kind).textContent=tr('No source PDF identified for this document.','Für dieses Dokument wurde keine PDF-Quelle identifiziert.');continue;}
  if(!documents.has(d.index))documents.set(d.index,(async()=>{const r=await fetch('/api/pdf/'+d.index,{headers});if(!r.ok)throw Error('PDF unavailable');return pdfjs.getDocument({data:new Uint8Array(await r.arrayBuffer()),isEvalSupported:false}).promise;})());
  const doc=await documents.get(d.index);if(generation!==viewGeneration)return;
  panes[kind]={doc,viewGeneration:generation,name:d.name,zoom:Math.min(1,($(kind).clientWidth-24)/612),pages:[]};await render(kind);if(generation!==viewGeneration)return;
 }

}
try{
 if(!token){$('status').textContent='Open the private review link provided in your Sokosumi result. Links expire after 24 hours.';$('summary').disabled=true;$('response-draft').disabled=true;}
 else{
  const response=await fetch('/api/report',{headers});if(!response.ok)throw Error('Link unavailable or expired');collection=await response.json();localizeChrome();showReady(collection.expiresAt);
  if(collection.comparisons){
   $('periods').hidden=false;
   $('periods').title='Comparison status; payment warnings remain in the report.';
   collection.comparisons.forEach((c,i)=>{const b=node('button',periodLabel(c.label),'period '+c.status);b.title=statusLabel(c.status);b.setAttribute('aria-label',c.label+': '+statusLabel(c.status));b.dataset.period=i;b.setAttribute('aria-pressed','false');b.onclick=()=>openComparison(i).catch(showError);$('periods').append(b);});
  }
  await openComparison(0);
 }
}catch(e){showError(e);}
