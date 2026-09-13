import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../../..');
const data = async (file) => `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
const logo = await data(path.join(root, 'docs/brand/2026-09-11-original-assets/masters/pathfinder-v2/erudoza-logo-patch-v2.png'));
const qr = JSON.parse(await readFile(path.join(root, 'docs/brand/2026-09-13-profile-characters/landing-qr.json'), 'utf8'));
if(qr.url !== 'https://erudoza.com/' || qr.quietZone !== 4) throw new Error('Unexpected QR destination or margin');
const n = qr.modules.length;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="white"/>${qr.modules.flatMap((row,y)=>row.map((v,x)=>v?`<rect x="${x}" y="${y}" width="1" height="1"/>`:'')).join('')}</svg>`;
await writeFile(path.join(dir, 'erudoza-qr.svg'), svg);
const qrData = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const specs = [
 { id:'01-pbe-training', title:'Your next chapter starts here.', copy:'Bible study and team practice for PBE.', label:'Pathfinder Bible Experience', art:path.join(root,'docs/brand/2026-09-12-landing-expedition/masters/expedition-hero.png'), position:'right center', cta:'Explore Erudoza', detail:'Students join through their coach.', qr:true },
 { id:'02-coach-your-team', title:'Give your team a plan.', copy:'Assign passages. Guide their next practice.', label:'For PBE coaches', art:path.join(dir,'artwork/coach.png'), position:'right center', cta:'Prepare your PBE team', detail:'Visit Erudoza to create your club.', qr:true },
 { id:'03-scripture-study', title:'Keep your study close.', copy:'Read, highlight and save private notes.', label:'Scripture study', art:path.join(dir,'artwork/study.png'), position:'center 72%', cta:'Make time for Scripture', detail:'Explore erudoza.com', qr:false },
];
const css = `*{box-sizing:border-box}body{margin:0;background:#e4e7e5;font-family:Arial,Helvetica,sans-serif;color:#102e47}.ad{width:1080px;height:1350px;background:#f6f4ee;overflow:hidden;display:flex;flex-direction:column}.top{height:296px;flex-shrink:0;padding:42px 60px 32px}.brandrow{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:42px}.brand{display:flex;align-items:center;gap:14px;font:36px Georgia,serif}.brand img{width:58px;height:58px;object-fit:contain}.eyebrow{font-size:18px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#596c79}h1{font-size:48px;line-height:1.15;letter-spacing:-1.5px;font-weight:650;margin:0 0 17px}p{margin:0;font-size:28px;line-height:1.4;color:#405363}.art{display:block;width:1080px;height:754px;object-fit:cover;flex-shrink:0}.bottom{height:300px;display:flex;align-items:center;justify-content:space-between;padding:30px 48px 30px 60px;background:#102e47;color:#fff9ed;gap:24px}.bottom strong{display:block;font-size:30px;font-weight:600;margin-bottom:18px}.bottom p{font-size:24px;color:#c1d7de;max-width:620px}.url{display:block;margin-top:24px;font-size:25px;font-weight:600;color:#fff9ed;letter-spacing:.2px}.qrwrap{width:198px;flex-shrink:0;text-align:center}.qrwrap img{width:198px;height:198px;display:block}.qrwrap span{display:block;font-size:18px;color:#c1d7de;margin-top:12px}.noqr .art{height:834px}.noqr .bottom{height:220px}.rule{width:48px;height:4px;background:#6bbdb6;margin-bottom:23px}.noqr .url{display:none}`;
await mkdir(path.join(dir,'exports'),{recursive:true});
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1080,height:1350},deviceScaleFactor:1});
const manifest = [];
for (const spec of specs) {
 const art = await data(spec.art);
 for(const hasQR of spec.qr ? [true,false] : [false]) {
  const id=spec.id+(hasQR?'-qr':'');
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><title>${spec.title} — Erudoza</title><style>${css}</style><article class="ad ${hasQR?'':'noqr'}"><header class="top"><div class="brandrow"><div class="brand"><img src="${logo}" alt="">Erudoza</div><span class="eyebrow">${spec.label}</span></div><h1>${spec.title}</h1><p>${spec.copy}</p></header><img class="art" src="${art}" style="object-position:${spec.position}" alt="Illustrated Bible study in an alpine setting"><footer class="bottom"><div><div class="rule"></div><strong>${spec.cta} →</strong><p>${spec.detail}</p><span class="url">erudoza.com</span></div>${hasQR?`<div class="qrwrap"><img src="${qrData}" alt="QR code to https://erudoza.com/"><span>Scan to explore</span></div>`:''}</footer></article></html>`;
  await page.setContent(html);
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
  const valid=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>1080,headlineHeight:document.querySelector('h1').getBoundingClientRect().height,images:[...document.images].every(i=>i.complete&&i.naturalWidth>0)}));
  if(valid.overflow||!valid.images||valid.headlineHeight>60) throw new Error(JSON.stringify({id,...valid}));
  await page.screenshot({path:path.join(dir,'exports',id+'.png')});
  manifest.push({file:'exports/'+id+'.png',width:1080,height:1350,headlinePx:48,qr:hasQR?qr.url:null,copy:[spec.title,spec.copy,spec.cta,spec.detail],validation:valid});
 }
}
const cards=manifest.map(m=>`<figure><a href="${m.file}"><img src="${m.file}" alt="${m.copy[0]}${m.qr?' with QR code':''}"></a><figcaption>${m.file.split('/')[1]} · 1080 × 1350</figcaption></figure>`).join('');
await writeFile(path.join(dir,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Erudoza advertisement collection</title><style>body{margin:40px;background:#f6f4ee;color:#102e47;font:16px Arial,sans-serif}h1{font-size:28px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}figure{margin:0}img{width:100%;display:block}figcaption{padding:12px 0;font-size:13px}a{color:inherit}</style><h1>Erudoza · Advertisement collection</h1><p>Smaller headlines, one benefit per creative. Two QR versions link to https://erudoza.com/.</p><main>${cards}</main></html>`);
await writeFile(path.join(dir,'manifest.json'),JSON.stringify({created:'2026-09-13',qr:{url:qr.url,quietZone:4,moduleCount:n,errorCorrection:qr.errorCorrection},assets:manifest},null,2)+'\n');
await browser.close();
console.log(`Rendered ${manifest.length} advertisements; all headline/layout/image checks passed.`);
