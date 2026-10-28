(()=>{'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
// languages: the page ships in English; the dictionary (assets/i18n.js) holds every language, keyed by data-i
const DICT=window.DU_I18N||{en:{}},LOCALE={en:'en-US',ru:'ru-RU',zh:'zh-CN',ko:'ko-KR',es:'es-ES'};
let lang='en';try{const s=localStorage.getItem('devunion-lang');if(DICT[s])lang=s}catch{}
const T=k=>(DICT[lang]&&DICT[lang][k])??DICT.en[k]??k;
const nf=(v,d)=>new Intl.NumberFormat(LOCALE[lang],{minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
const picker=$('.lang');
function language(next){lang=DICT[next]?next:'en';document.documentElement.lang=lang;
 $$('[data-i]').forEach(el=>el.innerHTML=T(el.dataset.i));
 $$('[data-i-aria]').forEach(el=>el.setAttribute('aria-label',T(el.dataset.iAria)));
 const tt=$('title[data-i-title]');if(tt)document.title=T(tt.dataset.iTitle)+' — DevUnion';
 if(picker)picker.value=lang;themeLabel();try{localStorage.setItem('devunion-lang',lang)}catch{}}
if(picker)picker.addEventListener('change',()=>language(picker.value));
// theme: light (default) or dark, one sun/moon switch; the <head> sets it before paint, this keeps the button and the pond in step
const themeBtn=$('.theme-toggle'),html=document.documentElement;
function themeLabel(){if(themeBtn)themeBtn.setAttribute('aria-checked',String(html.dataset.theme==='dark'))}
function theme(m){html.dataset.theme=m==='dark'?'dark':'light';themeLabel();try{localStorage.setItem('devunion-theme',html.dataset.theme)}catch{};dispatchEvent(new CustomEvent('pond:theme'))}
if(themeBtn)themeBtn.addEventListener('click',()=>theme(html.dataset.theme==='dark'?'light':'dark'));
// path bar: a chevron opens what lies under its step; one menu at a time; a click outside or Escape closes it,
// arrow keys walk the links inside
const crumbMenus=$$('.crumb-more');
function crumbClose(except,refocus){crumbMenus.forEach(b=>{if(b===except)return;const open=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded','false');document.getElementById(b.getAttribute('aria-controls')).hidden=true;if(open&&refocus)b.focus()})}
crumbMenus.forEach(b=>{const m=document.getElementById(b.getAttribute('aria-controls'));
 b.addEventListener('click',()=>{const open=b.getAttribute('aria-expanded')!=='true';crumbClose(b);b.setAttribute('aria-expanded',String(open));m.hidden=!open;if(open){const r=m.getBoundingClientRect();m.style.translate=r.right>innerWidth-8?`${innerWidth-8-r.right}px 0`:'';const f=m.querySelector('a');if(f&&b.matches(':focus-visible'))f.focus()}});
 m.addEventListener('keydown',e=>{const items=[...m.querySelectorAll('a')],i=items.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const n=items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length];if(n)n.focus()}})});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.crumb-step'))crumbClose()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('.crumb-more[aria-expanded="true"]')){crumbClose(null,true);e.stopImmediatePropagation()}});
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
if(!reduced.matches&&'IntersectionObserver'in window){document.body.classList.add('motion-ready');const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');observer.unobserve(e.target)}}),{threshold:.05});$$('.reveal').forEach((el,i)=>{el.style.setProperty('--reveal-delay',(i%3)*80+'ms');observer.observe(el)})}
// contact us: the brief is laid out on an A4 page and saved as a PDF the visitor sends to Sharif; nothing leaves the
// browser. The page is drawn on a canvas, so every language prints in the site's own fonts without shipping a font into the
// PDF, and wrapped in a one-page PDF around a JPEG of it. ?project= preselects a project
if($('#brief-form')){const form=$('#brief-form'),status=$('#brief-status'),pick=$('#brief-service');
 const want=new URLSearchParams(location.search).get('project');if(want&&[...pick.options].some(o=>o.value===want))pick.value=want;
 const FIELDS=[['name','f_name'],['service','f_project'],['task','f_task'],['have','f_have'],['result','f_result'],['budget','f_budget']];
 function page(){const W=1240,H=1754,M=110,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');
  const disp=getComputedStyle(html).getPropertyValue('--display'),mono=getComputedStyle(html).getPropertyValue('--mono');
  x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#15171a';x.textBaseline='top';
  x.font=`600 30px ${mono}`;x.fillText('</> DevUnion',M,M);x.font=`400 22px ${mono}`;x.fillStyle='#5b6066';x.fillText(new Date().toLocaleDateString(LOCALE[lang]),W-M-220,M+6);
  x.fillStyle='#15171a';x.font=`300 64px ${disp}`;const head=T('b_head');x.fillText(head[0].toUpperCase()+head.slice(1),M,M+90);
  let y=M+210;const data=new FormData(form);
  for(const [k,key] of FIELDS){const v=k==='service'?pick.selectedOptions[0].textContent:(data.get(k)||'').trim()||'—';
   x.fillStyle='#5b6066';x.font=`500 22px ${mono}`;x.fillText(T(key).toUpperCase(),M,y);y+=38;
   x.fillStyle='#15171a';x.font=`400 30px ${disp}`;
   // wrap by words, and by characters where a script has no spaces
   for(const para of v.split('\n')){let line='';for(const ch of para.split(/(\s+)/).flatMap(w=>x.measureText(w).width>W-2*M?[...w]:[w])){const t=line+ch;if(x.measureText(t).width>W-2*M&&line){x.fillText(line.trim(),M,y);y+=42;line=ch.trimStart()}else line=t}x.fillText(line.trim(),M,y);y+=42}
   y+=30;x.strokeStyle='#e3e3e0';x.beginPath();x.moveTo(M,y-14);x.lineTo(W-M,y-14);x.stroke();if(y>H-M)break}
  return c}
 function pdf(c){// a one-page A4 PDF holding the page as a JPEG
  const jpg=atob(c.toDataURL('image/jpeg',0.92).split(',')[1]),w=595.28,h=841.89,obj=[],enc=new TextEncoder();
  const parts=[];let len=0;const put=s=>{const b=typeof s==='string'?Uint8Array.from(s,ch=>ch.charCodeAt(0)&255):s;parts.push(b);len+=b.length};
  const img=Uint8Array.from(jpg,ch=>ch.charCodeAt(0)),draw=`q ${w} 0 0 ${h} 0 0 cm /I Do Q`;
  put('%PDF-1.4\n');
  const o=(n,body)=>{obj[n]=len;put(`${n} 0 obj\n`);if(typeof body==='string')put(body);else body();put('\nendobj\n')};
  o(1,'<< /Type /Catalog /Pages 2 0 R >>');o(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  o(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /I 4 0 R >> >> /Contents 5 0 R >>`);
  o(4,()=>{put(`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`);put(img);put('\nendstream')});
  o(5,`<< /Length ${enc.encode(draw).length} >>\nstream\n${draw}\nendstream`);
  const xref=len;put(`xref\n0 6\n0000000000 65535 f \n${[1,2,3,4,5].map(n=>String(obj[n]).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts,{type:'application/pdf'})}
 form.addEventListener('submit',async e=>{e.preventDefault();if(!form.reportValidity())return;if(document.fonts)await document.fonts.ready;
  const url=URL.createObjectURL(pdf(page())),link=document.createElement('a'),who=(new FormData(form).get('name')||'').trim().replace(/[^\p{L}\p{N}]+/gu,'-').slice(0,40);
  link.href=url;link.download=`DevUnion-brief${who?'-'+who:''}.pdf`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);status.textContent=T('s_pdf')})}
// home ring: hovering or focusing a station slides the lit arc round the dial to it, in that fish's colour
const arc=$('.ring-arc'),phone=matchMedia('(max-width:640px)');
if(arc)$$('.ring-item').forEach(it=>{const on=()=>{if(phone.matches&&it.closest('.ring-projects'))return;const cs=getComputedStyle(it),a=parseFloat(cs.getPropertyValue(phone.matches?'--am':'--a'));arc.style.rotate=(a+90-20)+'deg';arc.style.setProperty('--arc-color',cs.getPropertyValue('--btn-fish')||'var(--fish)');arc.classList.add('is-lit')},off=()=>arc.classList.remove('is-lit');it.addEventListener('pointerenter',on);it.addEventListener('focus',on);it.addEventListener('pointerleave',off);it.addEventListener('blur',off)});
// "Our projects" turns the dial over to the projects instead of leaving the page; #projects keeps that view on reload and
// lets the browser's back button turn it back. Without script the station is an ordinary link to /projects
const ring=$('.ring');
if(ring){const main=$('.ring-main'),proj=$('.ring-projects'),opener=$('[aria-controls="ring-projects"]');
 const view=(v,focus)=>{const p=v==='projects';ring.dataset.view=v;document.body.classList.toggle('view-projects',p);main.inert=p;proj.inert=!p;opener.setAttribute('aria-expanded',String(p));arc.classList.remove('is-lit');
  if(focus)(p?proj.querySelector('a'):opener).focus({preventScroll:true})};
 opener.addEventListener('click',e=>{if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();e.stopImmediatePropagation();history.pushState(null,'','#projects');view('projects',e.detail===0)});
 let refocus=false;   // the back button hides itself, so focus goes to the station that opened the view
 $('.ring-back').addEventListener('click',()=>{if(location.hash==='#projects'){refocus=true;history.back()}else view('main',true)});
 addEventListener('popstate',()=>{view(location.hash==='#projects'?'projects':'main',refocus);refocus=false});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&ring.dataset.view==='projects')$('.ring-back').click()});
 view(location.hash==='#projects'?'projects':'main',false);
 // number keys, as in a terminal menu: 1–4 pick a section, 1–5 a project on the turned dial; each station shows its key
 const keyed=nav=>[...nav.querySelectorAll('a.ring-item')];
 for(const nav of [main,proj])keyed(nav).forEach((a,i)=>{const k=a.querySelector('.ring-key');if(k)k.textContent=i+1});
 document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,textarea,select,[contenteditable]'))return;
  const n=+e.key;if(!(n>=1&&n<=9))return;const a=keyed(ring.dataset.view==='projects'?proj:main)[n-1];if(!a)return;
  e.preventDefault();a.focus({preventScroll:true});a.click()})}
// team portraits in ASCII: a photo (data-src) or a person's initial (data-letter) is sampled onto a square grid, and each
// cell becomes a character dense in proportion to how dark it is, in the page's ink; strongly coloured cells keep a muted
// tint of their colour. Hovering a card makes the characters shimmer for a moment. Redrawn when the theme or size changes
const faces=$$('.ascii-face');
if(faces.length){const N=44,RAMP=' .,:;-=+*%#@';
 const sample=src=>{const c=document.createElement('canvas');c.width=c.height=N;const x=c.getContext('2d',{willReadFrequently:true});
  x.fillStyle='#fff';x.fillRect(0,0,N,N);
  if(src.tagName){x.drawImage(src,0,0,N,N)}else{x.fillStyle='#000';x.font=`700 ${N*0.82}px 'JetBrains Mono',monospace`;x.textAlign='center';x.textBaseline='middle';x.fillText(src,N/2,N*0.54)}
  const d=x.getImageData(0,0,N,N).data,cells=[],votes=new Map();
  for(let i=0;i<N*N;i++){const r=d[i*4],g=d[i*4+1],b=d[i*4+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);cells.push({r,g,b,sat:mx?(mx-mn)/mx:0});
   // the backdrop is the commonest colour along the border: on a red poster that is the red, on a sticker the white
   const cx=i%N,cy=(i/N)|0;if(cx<2||cy<2||cx>N-3||cy>N-3){const k=(r>>5)<<6|(g>>5)<<3|(b>>5);votes.set(k,(votes.get(k)||0)+1)}}
  const top=[...votes].sort((p,q)=>q[1]-p[1])[0][0],bg=[((top>>6)&7)*32+16,((top>>3)&7)*32+16,(top&7)*32+16];
  // a cell is as dense as it is dark, and fades out where it is close to the backdrop's colour, so a coloured poster drops away
  // and only the figure is drawn; then the range is stretched
  let hi=0;for(const c of cells){const dist=Math.hypot(c.r-bg[0],c.g-bg[1],c.b-bg[2])/441,lum=(0.299*c.r+0.587*c.g+0.114*c.b)/255,keep=Math.min(1,Math.max(0,(dist-0.08)/0.17));c.dark=(1-lum)*keep;hi=Math.max(hi,c.dark)}
  for(const c of cells)c.dark=Math.min(1,c.dark/Math.max(.05,hi*0.9));return cells};
 const draw=(cv,cells,jitter)=>{const s=cv.clientWidth;if(!s)return;const dpr=Math.min(devicePixelRatio||1,2);cv.width=cv.height=Math.round(s*dpr);
  const x=cv.getContext('2d'),cs=getComputedStyle(cv),ink=cs.color,step=s/N;x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,s,s);
  x.font=`600 ${step*1.25}px 'JetBrains Mono',monospace`;x.textAlign='center';x.textBaseline='middle';
  cells.forEach((c,i)=>{let k=Math.round(c.dark*(RAMP.length-1));if(jitter&&k>0)k=Math.max(1,Math.min(RAMP.length-1,k+((Math.random()*3)|0)-1));if(!k)return;
   x.fillStyle=c.sat>.45&&c.dark>.15?`rgb(${c.r},${c.g},${c.b})`:ink;x.globalAlpha=.45+.55*c.dark;
   x.fillText(RAMP[k],(i%N+.5)*step,(((i/N)|0)+.5)*step)});x.globalAlpha=1};
 const all=[];
 faces.forEach(cv=>{const ready=cells=>{const f={cv,cells};all.push(f);draw(cv,cells);
   const card=cv.closest('.member,.brief-card');let t=0;card&&card.addEventListener('pointerenter',()=>{if(reduced.matches)return;let n=0;clearInterval(t);t=setInterval(()=>{draw(cv,cells,++n<8);if(n>=8)clearInterval(t)},70)})};
  if(cv.dataset.src){const img=new Image();img.onload=()=>ready(sample(img));img.src=cv.dataset.src}
  else (document.fonts?document.fonts.ready:Promise.resolve()).then(()=>ready(sample(cv.dataset.letter)))});
 const redraw=()=>all.forEach(f=>draw(f.cv,f.cells));addEventListener('pond:theme',redraw);addEventListener('resize',redraw)}
language(lang);
})();
