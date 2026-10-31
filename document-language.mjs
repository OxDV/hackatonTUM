export function documentLanguage(extraction){
 const language=extraction?.invoice?.language||extraction?.offer?.language;
 return typeof language==='string'&&/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language)?language:'en';
}
export function customerIdentity(extraction){
 const customer=extraction?.invoice?.customer_name?.trim()||'';
 const person=extraction?.invoice?.customer_contact_name?.trim()||'';
 return {customerName:person||customer,customerCompany:person&&customer!==person?customer:''};
}
export function periodLabel(label,language){
 const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 const index=months.indexOf(label);
 return index<0?label:new Intl.DateTimeFormat(language,{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(new Date().getUTCFullYear(),index,1)));
}
