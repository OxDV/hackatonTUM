import{readFileSync,writeFileSync}from'node:fs';
const paths={'/':['review/index.html','text/html'],'/app.mjs':['review/app.mjs','text/javascript'],'/match.mjs':['review/match.mjs','text/javascript'],'/style.css':['review/style.css','text/css'],'/pdf.mjs':['node_modules/pdfjs-dist/build/pdf.mjs','text/javascript'],'/pdf.worker.mjs':['node_modules/pdfjs-dist/build/pdf.worker.mjs','text/javascript']};
const assets=Object.fromEntries(Object.entries(paths).map(([url,[file,type]])=>[url,{type,body:readFileSync(file,'utf8')}]));
const service=readFileSync('review-hosted.mjs','utf8').replace('export async function handle','async function handle');
writeFileSync('hosted-review/worker/index.js',service+'\nconst assets='+JSON.stringify(assets)+';\nexport default {fetch:(request,env)=>handle(request,env,assets)};\n');
