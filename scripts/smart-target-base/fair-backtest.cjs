const {usable,ideal,med}=require('./models.cjs');const {desc}=require('./load.cjs');
const fam=s=>{const d=(desc.get(s)||'').toUpperCase().replace(/\[.*$/,'').replace(/\b(PERU|KSA|NOT FOR EU|NEU)\b/g,' ').replace(/\s+/g,' ').trim();const m=/^(.*?\d+(?:\.\d+)?\s*(?:KG|G))\b/.exec(d);return m?m[1]:s};
const sample=s=>/^BLENDED|SAMPLE/.test(s);
const main=h=>{const by={};for(const i of h.items){const f=fam(i.sku);by[f]=(by[f]||0)+i.qty}return Object.entries(by).sort((a,b)=>b[1]-a[1])[0]};
const S=[...usable].filter(h=>!h.items.some(i=>sample(i.sku))).sort((a,b)=>(a.date+a.shift<b.date+b.shift?-1:1));for(const h of S){const [m,q]=main(h);h.m=m;h.pure=q/h.total>=0.999;h.big=q/h.total>=0.7;}
const stats={};const add=(n,l,p,a)=>{const k=stats[n]=stats[n]||{};(k[l]=k[l]||[]).push(Math.abs(p-a)/a*100)};
for(let i=0;i<S.length;i++){const h=S[i];if(h.date<'2026-09-15')continue;const P=S.slice(0,i).filter(x=>x.line===h.line);if(P.length<5)continue;
 const win=P.filter(x=>x.date>=new Date(Date.parse(h.date)-56*864e5).toISOString().slice(0,10));
 const line10=med(P.slice(-10).map(x=>x.total));
 const ms=h.items.slice().sort((a,b)=>b.qty-a.qty)[0].sku;
 const fs=win.filter(x=>x.items.every(k=>ideal(h.line,k.sku))).map(x=>x.items.reduce((a,k)=>a+k.qty/ideal(h.line,k.sku)*60,0)/x.avail);
 const A=ideal(h.line,ms)&&fs.length>=5?ideal(h.line,ms)*med(fs)*h.avail/60:null;
 const v={main:win.filter(x=>x.m===h.m),big:win.filter(x=>x.m===h.m&&x.big),pure:win.filter(x=>x.m===h.m&&x.pure)};
 for(const [n,arr] of Object.entries(v))for(const min of [2,3]){const has=arr.length>=min;const pred=has?med(arr.slice(-5).map(x=>x.total)):null;
  add(`${n}≥${min} else line avg`,h.line,pred??line10,h.total);if(A||pred)add(`${n}≥${min} else iTouch×factor`,h.line,pred??A??line10,h.total);if(has)add(`${n}≥${min} covered only`,h.line,pred,h.total);}
 if(A)add('today iTouch×factor',h.line,A,h.total);}
for(const [n,o] of Object.entries(stats).sort()){const all=Object.values(o).flat();console.log(n.padEnd(30),[1,2,3,4,5,6].map(l=>`L${l} ${o[l]?med(o[l]).toFixed(0):'-'}`).join(' '),' ALL',med(all).toFixed(1)+'%',all.length,'w15',Math.round(all.filter(x=>x<=15).length/all.length*100)+'%');}
