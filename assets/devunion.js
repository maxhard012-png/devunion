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
 if(picker)picker.value=lang;try{localStorage.setItem('devunion-lang',lang)}catch{};forkDemo(false)}
if(picker)picker.addEventListener('change',()=>language(picker.value));
// theme: light (default), dark, or the device's own; the <head> sets it before paint, this keeps the switch and the pond in step
const themePick=$('.theme'),html=document.documentElement;
function theme(m){m=['light','dark','system'].includes(m)?m:'light';html.dataset.theme=m;if(themePick)themePick.value=m;try{localStorage.setItem('devunion-theme',m)}catch{};dispatchEvent(new CustomEvent('pond:theme'))}
if(themePick){themePick.value=html.dataset.theme||'light';themePick.addEventListener('change',()=>theme(themePick.value))}
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
if(!reduced.matches&&'IntersectionObserver'in window){document.body.classList.add('motion-ready');const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');observer.unobserve(e.target)}}),{threshold:.05});$$('.reveal').forEach((el,i)=>{el.style.setProperty('--reveal-delay',(i%3)*80+'ms');observer.observe(el)})}
// contact us: the brief is assembled here and copied or saved; nothing leaves the browser. ?project= preselects a project
if($('#brief-form')){const form=$('#brief-form'),status=$('#brief-status'),pick=$('#brief-service');
 const want=new URLSearchParams(location.search).get('project');if(want&&[...pick.options].some(o=>o.value===want))pick.value=want;
 function brief(){if(!form.reportValidity())return null;const data=new FormData(form);return `DevUnion — ${T('b_head')}\n\n${T('f_project')}: ${pick.selectedOptions[0].textContent}\n${T('b_task')}: ${data.get('task')}\n${T('b_contact')}: ${data.get('contact')||'—'}\n`}
 form.addEventListener('submit',async e=>{e.preventDefault();const value=brief();if(!value)return;try{await navigator.clipboard.writeText(value);status.textContent=T('s_copied')}catch{status.textContent=T('s_noclip')}});
 $('#brief-download').addEventListener('click',()=>{const value=brief();if(!value)return;const url=URL.createObjectURL(new Blob([value],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='DevUnion-brief.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent=T('s_saved')})}
// home "what we do": a live fork example. 1/k + p below one is a fork; the edge is what a split bank returns before fees.
// When the sliders first cross into a fork, the pond gets a ripple beside the panel, as if something bit.
const fdK=$('#fd-k'),fdP=$('#fd-p');let forkWas=null;
function forkDemo(fromUser){if(!fdK)return;const k=+fdK.value,p=+fdP.value,s=1/k+p,fork=s<1,edge=(1/s-1)*100,fill=Math.min(s/1.4,1);
$('#fd-k-out').textContent=nf(k,2);$('#fd-p-out').textContent=nf(p,2);$('#fd-formula').textContent=`1 / ${nf(k,2)} + ${nf(p,2)} = ${nf(s,3)}`;
$('#fd-fill').style.width=fill*100+'%';$('.fork-demo').classList.toggle('is-fork',fork);
$('#fd-status').textContent=fork?T('fork_yes').replace('{e}',nf(edge,1)):T('fork_no');
if(fromUser&&fork&&forkWas===false){const r=$('.about-panel').getBoundingClientRect(),b=$('.fd-scale').getBoundingClientRect();dispatchEvent(new CustomEvent('pond:ripple',{detail:{x:r.right+70,y:b.top+b.height/2}}))}
forkWas=fork}
if(fdK)[fdK,fdP].forEach(el=>el.addEventListener('input',()=>forkDemo(true)));
// the explainer opens on hover or focus, and a tap on its chip pins it open: on a phone, touching a slider would otherwise
// move focus and close it mid-gesture. A tap anywhere else or Escape closes it.
const about=$('.about-panel');
if(about){$('.about-toggle').addEventListener('click',()=>about.classList.toggle('is-open'));document.addEventListener('pointerdown',e=>{if(!e.target.closest('.about-panel'))about.classList.remove('is-open')});about.addEventListener('keydown',e=>{if(e.key==='Escape'){about.classList.remove('is-open');about.blur()}})}
// home ring: hovering or focusing a station slides the lit arc round the dial to it, in that fish's colour
const arc=$('.ring-arc'),phone=matchMedia('(max-width:640px)');
if(arc)$$('.ring-item').forEach(it=>{const on=()=>{if(phone.matches&&it.closest('.ring-projects'))return;const cs=getComputedStyle(it),a=parseFloat(cs.getPropertyValue(phone.matches?'--am':'--a'));arc.style.setProperty('--arc-from',(a+90-20)+'deg');arc.style.setProperty('--arc-color',cs.getPropertyValue('--btn-fish')||'var(--fish)');arc.classList.add('is-lit')},off=()=>arc.classList.remove('is-lit');it.addEventListener('pointerenter',on);it.addEventListener('focus',on);it.addEventListener('pointerleave',off);it.addEventListener('blur',off)});
// "Our projects" turns the dial over to the projects instead of leaving the page; #projects keeps that view on reload and
// lets the browser's back button turn it back. Without script the station is an ordinary link to /projects
const ring=$('.ring');
if(ring){const main=$('.ring-main'),proj=$('.ring-projects'),opener=$('[aria-controls="ring-projects"]');
 const view=(v,focus)=>{const p=v==='projects';ring.dataset.view=v;main.inert=p;proj.inert=!p;opener.setAttribute('aria-expanded',String(p));arc.classList.remove('is-lit');
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
language(lang);
})();
