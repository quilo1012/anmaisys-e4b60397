const {shifts,cyc,desc,XLSX,D}=require('./load.cjs');
const med=v=>{const s=[...v].sort((a,b)=>a-b);const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
const usable=shifts.filter(h=>h.avail>0&&h.total>0);
const wb=XLSX.readFile(D+'Standard_Line_Targets_by_Flavour.xlsx');
const runs=XLSX.utils.sheet_to_json(wb.Sheets['ALL RUNS'],{header:1,range:2,blankrows:false}).filter(r=>typeof r[5]==='number');
const norm=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9.+ ]+/g,' ').replace(/\bBODYFUEL\b/g,'BODY FUEL').replace(/\s+/g,' ').trim();
const toks=s=>norm(s).split(' ').filter(Boolean);
// workbook index
const prods=[...new Set(runs.map(r=>r[0]))].map(p=>({p,t:toks(p.replace(/-/g,' '))}));
const byPFL=new Map(),byPFFL=new Map();
for(const [p,f,fill,c,l,r] of runs){const a=[p,fill,c,l].join('|');(byPFL.get(a)||byPFL.set(a,[]).get(a)).push(r);const b=[p,f,fill,c,l].join('|');(byPFFL.get(b)||byPFFL.set(b,[]).get(b)).push(r);}
const flavoursOf=new Map();for(const [p,f] of runs){(flavoursOf.get(p)||flavoursOf.set(p,new Set()).get(p)).add(f);}
function parse(sku){const d=desc.get(sku);if(!d)return null;const clean=d.replace(/\[.*$/,'').replace(/-/g,' ');const n=norm(clean);const set=new Set(n.split(' '));
 let fill=null;const m=/(\d+(?:\.\d+)?)\s*(KG|G)\b/.exec(n);if(m)fill=m[2]==='KG'?+m[1]:+(+m[1]/1000).toFixed(3);
 const cont=(/^BAG/.test(sku)||set.has('BAG')||set.has('BAGS'))?'BAGS':'TUBS';
 let best=[];for(const x of prods){if(x.t.every(t=>set.has(t))){if(!best.length||x.t.length>best[0].t.length)best=[x];else if(x.t.length===best[0].t.length)best.push(x);}}
 if(best.length!==1)return {fill,cont,prod:null};
 const prod=best[0].p;let fl=null,cands=[];for(const f of flavoursOf.get(prod)||[]){const t=toks(f.replace(/-/g,' '));if(t.length&&t.every(x=>set.has(x)))cands.push({f,n:t.length});}
 if(cands.length){cands.sort((a,b)=>b.n-a.n);if(cands.length===1||cands[0].n>cands[1].n)fl=cands[0].f;}
 return {fill,cont,prod,fl};}
const parsed=new Map();
function rateW(l,sku){if(!parsed.has(sku))parsed.set(sku,parse(sku));const x=parsed.get(sku);if(!x||!x.prod||!x.fill)return null;
 const a=byPFFL.get([x.prod,x.fl,x.fill,x.cont,l].join('|'));if(x.fl&&a&&a.length>=2)return med(a);
 const b=byPFL.get([x.prod,x.fill,x.cont,l].join('|'));if(b&&b.length)return med(b);return null;}
// canonical family: drop market prefixes
const fam=s=>s.replace(/^(PERU|KSA|NEU|EU|BAG)+/,'').replace(/\s*-\s*\d+$/,'');
function split(CUT){const train=usable.filter(h=>h.date<CUT),test=usable.filter(h=>h.date>=CUT);return{train,test};}
function factors(tr,rate){const f={};for(let l=1;l<=6;l++){const rs=[];for(const h of tr.filter(x=>x.line===l)){const t=h.items.reduce((a,i)=>{const r=rate(l,i.sku);return a===null||!r?null:a+i.qty/r*60},0);if(t===null)continue;const ratio=t/h.avail;if(ratio<=1.6&&ratio>0.1)rs.push(ratio);}f[l]=rs.length>=5?med(rs):null;}return f;}
const ideal=(l,s)=>cyc.has(l+'|'+s)?3600/cyc.get(l+'|'+s):null;
// hierarchical estimator: secs per container per (line,family), fitted on all shifts incl. mixed, shrunk to prior
function fit(tr,prior,k=2,iters=8){const s=new Map();const key=(l,sku)=>l+'|'+fam(sku);const pri=(l,sku)=>{const r=prior(l,sku);return r?3600/r:null};
 const obs=new Map();for(const h of tr)for(const i of h.items){const K=key(h.line,i.sku);if(!obs.has(K))obs.set(K,[]);obs.get(K).push(h);}
 const P=new Map();for(const h of tr)for(const i of h.items){const K=key(h.line,i.sku);const p=pri(h.line,i.sku);if(p&&!P.has(K))P.set(K,p);}
 for(const K of obs.keys())if(P.has(K))s.set(K,P.get(K));
 for(let it=0;it<iters;it++){for(const [K,hs] of obs){const est=[];for(const h of hs){let other=0,q=0,ok=true;for(const i of h.items){if(key(h.line,i.sku)===K)q+=i.qty;else{const v=s.get(key(h.line,i.sku));if(!v){ok=false;break;}other+=i.qty*v;}}if(!ok||!q)continue;const left=h.avail*60-other;const share=q/h.total;if(left>0)est.push({v:left/q,share});}
  if(!est.length)continue;const pure=est.filter(e=>e.share>=0.5).map(e=>e.v);const use=pure.length?pure:est.map(e=>e.v);const m=med(use);const p=P.get(K);const n=use.length;let v=p?(n*m+k*p)/(n+k):(n>=2?m:null);if(v&&p){v=Math.min(Math.max(v,p*0.4),p*2.5);}if(v)s.set(K,v);}}
 return (l,sku)=>{const v=s.get(key(l,sku));return v?3600/v:null};}
function score(test,rate,name){const rows={};for(const h of test){const mins=h.items.map(i=>{const r=rate(h.line,i.sku);return r?i.qty/r*60:null});if(mins.some(x=>x===null))continue;const t=mins.reduce((a,b)=>a+b,0);const pred=h.total*h.avail/t;(rows[h.line]=rows[h.line]||[]).push(Math.abs(pred-h.total)/h.total*100);}
 const out=[];let all=[];for(let l=1;l<=6;l++){const e=rows[l]||[];all=all.concat(e);const w10=e.filter(x=>x<=10).length,w20=e.filter(x=>x<=20).length;out.push(`L${l} ${e.length?med(e).toFixed(0):'-'}%/${e.length?Math.round(w20/e.length*100):'-'}(${e.length}/${test.filter(h=>h.line===l).length})`);}console.log(name.padEnd(26),out.join(' '),' ALL',all.length?med(all).toFixed(1)+'%':'-',all.length);}
module.exports={usable,split,factors,ideal,rateW,fit,score,med,parsed,parse,fam};
if(require.main===module){const {train,test}=split('2026-10-01');
 const made=new Set();for(const h of usable)for(const i of h.items)made.add(i.sku);let m=0,mf=0;for(const s of made){const x=parse(s);if(x&&x.prod&&x.fill){m++;if(x.fl)mf++;}}console.log('SKUs made',made.size,'mapped to workbook product+fill',m,'+flavour',mf);
 const fi=factors(train,ideal);const A=(l,s)=>ideal(l,s)&&fi[l]?ideal(l,s)/fi[l]*1/1:null;
 // factors() returns time ratio ideal/avail → rate = ideal × ratio
 const a=(l,s)=>ideal(l,s)&&fi[l]?ideal(l,s)*fi[l]:null;
 const fw=factors(train,rateW);const w=(l,s)=>{const r=rateW(l,s);return r&&fw[l]?r*fw[l]:null};
 console.log('iTouch ratio',JSON.stringify(fi));console.log('workbook ratio',JSON.stringify(fw));
 score(test,a,'A iTouch×factor');score(test,rateW,'W workbook raw');score(test,w,'W workbook×line ratio');
 const wa=(l,s)=>w(l,s)||a(l,s);score(test,wa,'workbook>iTouch');
 const R=fit(train,a);score(test,R,'R fit prior=iTouch');
 const R2=fit(train,wa);score(test,R2,'R fit prior=wb>iTouch');
 const R3=(l,s)=>R2(l,s)||wa(l,s);score(test,R3,'R2 + fallback');
 // naive: line median total per shift
 const lm={};for(let l=1;l<=6;l++)lm[l]=med(train.filter(h=>h.line===l).map(h=>h.total));const e={};let al=[];for(const h of test){const x=Math.abs(lm[h.line]-h.total)/h.total*100;(e[h.line]=e[h.line]||[]).push(x);al.push(x);}console.log('naive line median'.padEnd(26),Object.keys(e).map(l=>`L${l} ${med(e[l]).toFixed(0)}%`).join(' '),' ALL',med(al).toFixed(1)+'%');
}
