const fs=require('fs');
const {usable,factors,ideal,rateW,fit,med,parse,fam}=require('./models.cjs');
const {cyc,desc,XLSX,D}=require('./load.cjs');
const wbk=XLSX.readFile(D+'Standard_Line_Targets_by_Flavour.xlsx');
const runs=XLSX.utils.sheet_to_json(wbk.Sheets['ALL RUNS'],{header:1,range:2,blankrows:false}).filter(r=>typeof r[5]==='number');
const byFill=new Map();for(const [p,f,fill,c,l,r] of runs){const k=[l,c,fill].join('|');(byFill.get(k)||byFill.set(k,[]).get(k)).push(r);}
const fills=[...new Set(runs.map(r=>r[2]))];const pc=new Map();const px=s=>{if(!pc.has(s))pc.set(s,parse(s));return pc.get(s)};
function rateF(l,s){const x=px(s);if(!x||!x.fill)return null;let best=null,d=1e9;for(const f of fills){const dd=Math.abs(Math.log(f/x.fill));if(dd<d&&dd<0.12&&byFill.has([l,x.cont,f].join('|'))){d=dd;best=f;}}return best===null?null:med(byFill.get([l,x.cont,best].join('|')));}
const fi=factors(usable,ideal);const a=(l,s)=>ideal(l,s)&&fi[l]?ideal(l,s)*fi[l]:null;
const fw=factors(usable,rateW);const w=(l,s)=>{const r=rateW(l,s);return r&&fw[l]?r*fw[l]:null};
const ff=factors(usable,rateF);const f=(l,s)=>{const r=rateF(l,s);return r&&ff[l]?r*ff[l]:null};
const chain=(l,s)=>w(l,s)||f(l,s)||a(l,s);const R=fit(usable,chain,4);
// shifts per line×family
const seen=new Map(),qty=new Map();for(const h of usable)for(const i of h.items){const k=h.line+'|'+fam(i.sku);seen.set(k,(seen.get(k)||0)+1);qty.set(k,(qty.get(k)||0)+i.qty);}
const skus=new Set();for(const h of usable)for(const i of h.items)if(i.sku!=='?')skus.add(h.line+'|'+i.sku);
for(const k of cyc.keys()){const [l,s]=k.split('|');if(seen.has(l+'|'+fam(s)))skus.add(k);}
const rows=[];for(const k of skus){const i=k.indexOf('|');const l=+k.slice(0,i),s=k.slice(i+1);const n=seen.get(l+'|'+fam(s))||0;const v={a:a(l,s),f:f(l,s),r:n?R(l,s):null};const vals=[v.a,v.f,v.r].filter(Boolean);if(!vals.length)continue;const b=Math.exp(vals.reduce((p,c)=>p+Math.log(c),0)/vals.length);const spread=vals.length>1?(Math.max(...vals)-Math.min(...vals))/b:null;
 const conf=n>=5&&vals.length>=2&&spread<=0.3?'High':n>=2&&vals.length>=2?'Medium':'Low';
 rows.push({line:l,sku:s,description:(desc.get(s)||'').replace(/\s*\[.*$/,''),perHour:Math.round(b),shifts:n,qty:qty.get(l+'|'+fam(s))||0,conf,fromItouch:v.a&&Math.round(v.a),fromReports:v.f&&Math.round(v.f),fromHistory:v.r&&Math.round(v.r),cycle:cyc.get(l+'|'+s)||null});}
rows.sort((x,y)=>x.line-y.line||y.qty-x.qty||(x.sku<y.sku?-1:1));
fs.writeFileSync('rows.json',JSON.stringify(rows));
const by=(p)=>rows.filter(p).length;
console.log('rows',rows.length,'High',by(r=>r.conf==='High'),'Medium',by(r=>r.conf==='Medium'),'Low',by(r=>r.conf==='Low'));
for(let l=1;l<=6;l++){const x=rows.filter(r=>r.line===l);console.log('L'+l,x.length,'H',x.filter(r=>r.conf==='High').length,'M',x.filter(r=>r.conf==='Medium').length,'L',x.filter(r=>r.conf==='Low').length);}
for(const s of ['PERUCRE500','CRE500','CRE250','PERUCRE250'])console.log(JSON.stringify(rows.find(r=>r.line===4&&r.sku===s)));
console.log('cycle implied for PERUCRE500 L4 at line ratio',fi[4].toFixed(3),'→',(3600/rows.find(r=>r.line===4&&r.sku==='PERUCRE500').perHour*fi[4]).toFixed(2),'s');
// top by line
for(let l=1;l<=6;l++)console.log('L'+l,rows.filter(r=>r.line===l).slice(0,3).map(r=>`${r.sku} ${r.perHour}/h (${r.shifts}, ${r.conf})`).join(' | '));
