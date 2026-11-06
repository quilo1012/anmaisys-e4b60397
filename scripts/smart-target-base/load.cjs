const fs=require('fs');const XLSX=require('xlsx');
// A JSON file {rows:[{data}]}: data is line|date|D or N|sku|qty joined by ';', from production_sessions and production_items.
const TR=process.env.SMART_TARGET_SHIFTS;
const raw=JSON.parse(fs.readFileSync(TR,'utf8'));
const data=(raw.rows||JSON.parse(raw[0].text).rows)[0].data;
const shifts=new Map();
for(const rec of data.split(';')){const [l,d,s,sku,q]=rec.split('|');const k=d+'|'+s+'|'+l;const h=shifts.get(k)||{k,line:+l,date:d,shift:s,items:[]};const it=h.items.find(x=>x.sku===sku);if(it)it.qty+=+q;else h.items.push({sku,qty:+q});shifts.set(k,h);}
const mix=l=>l>=5?40:30;
for(const h of shifts.values()){h.total=h.items.reduce((a,b)=>a+b.qty,0);h.setup=mix(h.line)+(h.items.length-1)*(25+mix(h.line));h.avail=645-h.setup;}
// Folder holding Itouch/Itouch 02.11.2026.xlsx and Standard_Line_Targets_by_Flavour.xlsx.
const D=process.env.SMART_TARGET_REPORTS;
const cyc=new Map();const desc=new Map();{const wb=XLSX.readFile(D+'Itouch/Itouch 02.11.2026.xlsx');const r=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);for(const x of r){const m=/Filler Line ([1-6])/.exec(x['Machine']||'');const c=Number(x['Standard Cycle Time']);const sku=String(x['Part Number']||'').trim().toUpperCase();if(sku&&x['Description'])desc.set(sku,String(x['Description']));if(!m||!sku||!(c>=1.5&&c<=20))continue;cyc.set(m[1]+'|'+sku,c);}}
module.exports={shifts:[...shifts.values()],cyc,desc,XLSX,D};
