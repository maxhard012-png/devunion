(()=>{'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let lang='ru';try{lang=localStorage.getItem('devunion-language')||'ru'}catch{}
$$('[data-en]').forEach(el=>el.dataset.ru=el.innerHTML);
function language(next){lang=next==='en'?'en':'ru';document.documentElement.lang=lang;$$('[data-en]').forEach(el=>el.innerHTML=el.dataset[lang]);$('.lang').textContent=lang==='ru'?'EN':'RU';$('.lang').setAttribute('aria-label',lang==='ru'?'Switch to English':'Переключить на русский');try{localStorage.setItem('devunion-language',lang)}catch{};if($('#calculator'))calculate(false);forkDemo(false)}
$('.lang').addEventListener('click',()=>language(lang==='ru'?'en':'ru'));
const menu=$('#mobile-menu'),toggle=$('.menu-toggle');
toggle.addEventListener('click',()=>{menu.showModal();toggle.setAttribute('aria-expanded','true');document.body.style.overflow='hidden';$('.menu-close').focus()});
$('.menu-close').addEventListener('click',()=>menu.close());menu.addEventListener('close',()=>{toggle.setAttribute('aria-expanded','false');document.body.style.overflow='';toggle.focus()});
menu.addEventListener('click',e=>{if(e.target.closest('a'))menu.close()});
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
if(!reduced.matches&&'IntersectionObserver'in window){document.body.classList.add('motion-ready');const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');observer.unobserve(e.target)}}),{threshold:.05});$$('.reveal').forEach((el,i)=>{el.style.setProperty('--reveal-delay',(i%3)*80+'ms');observer.observe(el)})}
function calculate(report=true){const odds=Number($('#c-odds')?.value),price=Number($('#c-price')?.value),bank=Number($('#c-bank')?.value);const fields=[['odds',odds>1&&Number.isFinite(odds),'Коэффициент должен быть больше 1','Odds must be greater than 1'],['price',price>0&&price<1&&Number.isFinite(price),'Цена должна быть между 0 и 1','Price must be between 0 and 1'],['bank',bank>0&&bank<=1e12&&Number.isFinite(bank),'Банк должен быть больше 0 и не больше 1 трлн','Bank must be greater than 0 and no more than 1 trillion']];let valid=true;fields.forEach(([id,ok,ru,en])=>{const input=$('#c-'+id),error=$('#e-'+id);if(!input)return;if(!ok)valid=false;input.setAttribute('aria-invalid',String(!ok));error.textContent=ok?'':(lang==='ru'?ru:en)});if(!valid){$$('[data-result]').forEach(el=>el.textContent='—');$('#calc-status').textContent=lang==='ru'?'Проверьте параметры расчёта.':'Check the input values.';return false}
 const payout=bank/(1/odds+price),book=payout/odds,pred=payout*price,profit=payout-bank;const values={profit,payout,book,pred,roi:profit/bank*100};const fmt=new Intl.NumberFormat(lang==='ru'?'ru-RU':'en-US',{minimumFractionDigits:2,maximumFractionDigits:2});$$('[data-result]').forEach(el=>{const key=el.dataset.result;el.textContent=(key==='profit'&&values[key]>0?'+':'')+fmt.format(values[key])+(key==='roi'?' %':' $')});$('#calc-status').textContent=profit>0?(lang==='ru'?'Положительная разница до комиссий.':'Positive spread before fees.'):(lang==='ru'?'При этих параметрах прибыльного арбитража нет.':'These inputs do not produce profitable arbitrage.');$('#allocation-book').style.width=(book/bank*100)+'%';$('#allocation-pred').style.width=(pred/bank*100)+'%';return values}
if($('#calculator')){$('#calculator').addEventListener('submit',e=>{e.preventDefault();calculate()});$$('#calculator input').forEach(el=>el.addEventListener('input',()=>calculate()));$('#calc-reset').addEventListener('click',()=>{ $('#calculator').reset();calculate()})}
if($('#brief-form')){const form=$('#brief-form'),status=$('#brief-status');function brief(){if(!form.reportValidity())return null;const data=new FormData(form);return `DevUnion — ${lang==='ru'?'бриф проекта':'project brief'}\n\n${lang==='ru'?'Направление':'Service'}: ${data.get('service')}\n${lang==='ru'?'Задача':'Task'}: ${data.get('task')}\n${lang==='ru'?'Контакт':'Contact'}: ${data.get('contact')||'—'}\n`}
form.addEventListener('submit',async e=>{e.preventDefault();const value=brief();if(!value)return;try{await navigator.clipboard.writeText(value);status.textContent=lang==='ru'?'Бриф скопирован. Ничего не отправлено.':'Brief copied. Nothing has been sent.'}catch{status.textContent=lang==='ru'?'Буфер недоступен. Используйте «Скачать бриф».':'Clipboard unavailable. Use Download brief.'}});$('#brief-download').addEventListener('click',()=>{const value=brief();if(!value)return;const url=URL.createObjectURL(new Blob([value],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='DevUnion-brief.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent=lang==='ru'?'Бриф сохранён в файл. Ничего не отправлено.':'Brief saved to a file. Nothing has been sent.'})}
// home "what we do": a live fork example. 1/k + p below one is a fork; the edge is what a split bank returns before fees.
// When the sliders first cross into a fork, the pond gets a ripple beside the panel, as if something bit.
const fdK=$('#fd-k'),fdP=$('#fd-p');let forkWas=null;
function forkDemo(fromUser){if(!fdK)return;const k=+fdK.value,p=+fdP.value,s=1/k+p,fork=s<1,edge=(1/s-1)*100,fill=Math.min(s/1.4,1);
const nf=(v,d)=>new Intl.NumberFormat(lang==='ru'?'ru-RU':'en-US',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
$('#fd-k-out').textContent=nf(k,2);$('#fd-p-out').textContent=nf(p,2);$('#fd-formula').textContent=`1 / ${nf(k,2)} + ${nf(p,2)} = ${nf(s,3)}`;
$('#fd-fill').style.width=fill*100+'%';$('.fork-demo').classList.toggle('is-fork',fork);
$('#fd-status').textContent=fork?(lang==='ru'?`вилка +${nf(edge,1)}% до комиссий`:`fork +${nf(edge,1)}% before fees`):(lang==='ru'?'вилки нет':'no fork');
if(fromUser&&fork&&forkWas===false){const r=$('.about-panel').getBoundingClientRect(),b=$('.fd-scale').getBoundingClientRect();dispatchEvent(new CustomEvent('pond:ripple',{detail:{x:r.right+70,y:b.top+b.height/2}}))}
forkWas=fork}
if(fdK)[fdK,fdP].forEach(el=>el.addEventListener('input',()=>forkDemo(true)));
// the explainer opens on hover or focus, and a tap on its chip pins it open: on a phone, touching a slider would otherwise
// move focus and close it mid-gesture. A tap anywhere else or Escape closes it.
const about=$('.about-panel');
if(about){$('.about-toggle').addEventListener('click',()=>about.classList.toggle('is-open'));document.addEventListener('pointerdown',e=>{if(!e.target.closest('.about-panel'))about.classList.remove('is-open')});about.addEventListener('keydown',e=>{if(e.key==='Escape'){about.classList.remove('is-open');about.blur()}})}
// home ring: hovering or focusing a station slides the lit arc round the dial to it, in that fish's colour
const arc=$('.ring-arc');
if(arc)$$('.ring-item').forEach(it=>{const on=()=>{const cs=getComputedStyle(it),a=parseFloat(cs.getPropertyValue(matchMedia('(max-width:640px)').matches?'--am':'--a'));arc.style.setProperty('--arc-from',(a+90-20)+'deg');arc.style.setProperty('--arc-color',cs.getPropertyValue('--btn-fish')||'var(--fish)');arc.classList.add('is-lit')},off=()=>arc.classList.remove('is-lit');it.addEventListener('pointerenter',on);it.addEventListener('focus',on);it.addEventListener('pointerleave',off);it.addEventListener('blur',off)});
language(lang);
})();
