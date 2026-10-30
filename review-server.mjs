import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadReview} from './review-store.mjs';
const assets={'/':['review/index.html','text/html'],'/app.mjs':['review/app.mjs','text/javascript'],'/match.mjs':['review/match.mjs','text/javascript'],'/style.css':['review/style.css','text/css'],'/pdf.mjs':['node_modules/pdfjs-dist/build/pdf.mjs','text/javascript'],'/pdf.worker.mjs':['node_modules/pdfjs-dist/build/pdf.worker.mjs','text/javascript']};
createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'");
 try{
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  const path=new URL(req.url,'http://localhost').pathname;
  if(assets[path]){const [file,type]=assets[path];res.setHeader('Content-Type',type);return res.end(readFileSync(file));}
  const token=req.headers.authorization?.replace(/^Bearer /,'');const report=loadReview(token||'');
  if(!report){res.writeHead(404);return res.end('Report unavailable or expired');}
  if(path==='/api/report'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(report));}
  const match=path.match(/^\/api\/pdf\/(\d+)$/);if(match&&report.documents.some(d=>String(d.index)===match[1])){res.setHeader('Content-Type','application/pdf');return res.end(readFileSync(join('.local/reviews',token,match[1]+'.pdf')));}
  res.writeHead(404);res.end();
 }catch{res.writeHead(500);res.end('Unable to open report');}
}).listen(Number(process.env.REVIEW_PORT||21951),'127.0.0.1',()=>console.log('Review UI: http://127.0.0.1:'+(process.env.REVIEW_PORT||21951)));
