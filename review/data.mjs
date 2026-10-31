export function visibleFindings(report){
 if(report.status==='matched')return [];
 return (report.findings||[]).filter(f=>f.kind==='difference'||f.kind==='uncertainty');
}
export function comparisonView(collection,index){
 const selected=collection.comparisons?collection.comparisons[index]:collection;
 if(!selected)throw Error('Unknown comparison');
 // Reject mixed payloads instead of showing another invoice's findings.
 for(const f of selected.findings||[])for(const kind of ['offer','invoice']){
  if(selected[kind+'Filename']&&f[kind]&&f[kind].filename!==selected[kind+'Filename'])throw Error('Finding source does not match the selected document');
 }
 return {...selected,findings:visibleFindings(selected),documents:collection.documents,expiresAt:collection.expiresAt};
}
