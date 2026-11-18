import { chromium } from 'playwright'; import fs from 'fs';
const svg = fs.readFileSync('public/icons/icon.svg','utf8');
const b = await chromium.launch(); 
for (const n of [192,512]) { const p = await b.newPage({viewport:{width:n,height:n}}); await p.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ',`<svg width="${n}" height="${n}" `)}</body>`); await p.screenshot({path:`public/icons/icon-${n}.png`, omitBackground:true}); }
await b.close(); console.log('ok');
