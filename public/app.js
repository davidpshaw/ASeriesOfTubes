// SPDX-License-Identifier: GPL-3.0-or-later
import { TOPICS, GROUPS } from './topics.js';

const $=s=>document.querySelector(s);
const svg=$('#scene');
const RM=matchMedia('(prefers-reduced-motion: reduce)');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let cur=null,curId='',step=0,playing=false,speed=1,token=0,done=0,pkt=null,trail=[],fromSide=false;
const memStep={};
let seen={};try{seen=JSON.parse(localStorage.getItem('utw-seen')||'{}')}catch(e){}
const markSeen=id=>{seen[id]=1;try{localStorage.setItem('utw-seen',JSON.stringify(seen))}catch(e){}};
const groupOf=id=>(GROUPS.find(g=>g[1].includes(id))||['Topics'])[0];
const nameOf=id=>TOPICS[id].short||TOPICS[id].title;

function renderNav(){
 const q=$('#find').value.trim().toLowerCase();
 const html=GROUPS.map(([g,ids])=>{
  const list=ids.filter(id=>!q||(TOPICS[id].title+' '+TOPICS[id].blurb).toLowerCase().includes(q));
  if(!list.length)return '';
  return `<div class="grp"><h3>${g}</h3>${list.map(id=>`<a class="t" href="#${id}" data-side${id===curId?' aria-current="page"':''}>${esc(nameOf(id))}<small>${TOPICS[id].steps?(seen[id]?'✓ seen':''):'soon'}</small></a>`).join('')}</div>`;
 }).join('');
 $('#groups').innerHTML=html||'<p class="none">No topics match.</p>';
}

function geo(){
 const W=svg.clientWidth,H=svg.clientHeight;
 const nw=Math.max(78,Math.min(150,W*.19)),nh=W<520?44:56,px=nw/2+10,py=nh/2+30;
 const P={};for(const a of cur.actors)P[a.id]={x:px+a.x/100*(W-2*px),y:py+a.y/100*(H-2*py)};
 return{W,H,nw,nh,P};
}
const idx=id=>cur.actors.findIndex(a=>a.id===id);
function seg(m,g){
 const [f,t]=m,fw=idx(f)<idx(t);
 const lo=g.P[fw?f:t],hi=g.P[fw?t:f];
 const bx=hi.x-lo.x,by=hi.y-lo.y,L=Math.hypot(bx,by)||1,n={x:-by/L,y:bx/L},o=fw?9:-9;
 const F=g.P[f],T=g.P[t],u={x:(T.x-F.x)/L,y:(T.y-F.y)/L};
 const d=Math.min(Math.abs(u.x)>.001?(g.nw/2+6)/Math.abs(u.x):1e9,Math.abs(u.y)>.001?(g.nh/2+6)/Math.abs(u.y):1e9);
 return{x1:F.x+u.x*d+n.x*o,y1:F.y+u.y*d+n.y*o,x2:T.x-u.x*d+n.x*o,y2:T.y-u.y*d+n.y*o,n,o};
}
function chip(x,y,label,kind,W,extra){
 const lock=kind==='e',w=Math.round(label.length*7.1+18+(lock?14:0)),h=24;
 x=Math.max(w/2+4,Math.min(W-w/2-4,x));
 return `<g class="chip k${kind}${extra||''}" transform="translate(${x-w/2},${y-h/2})"><rect width="${w}" height="${h}" rx="6"/>${lock?'<g class="lk" transform="translate(9,6)"><rect y="4.5" width="9" height="7.5" rx="1.3"/><path d="M2 5V3.2a2.5 2.5 0 0 1 5 0V5"/></g>':''}<text x="${(lock?14:0)+9}" y="16">${esc(label)}</text></g>`;
}
function draw(){
 if(!cur||!cur.steps||!svg.clientWidth)return;
 const g=geo(),st=cur.steps[step],ms=st.m||[],on=new Set(st.on||[]);
 ms.forEach(m=>{on.add(m[0]);on.add(m[1])});
 let h='<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="ah" d="M0 0L10 5L0 10z"/></marker><marker id="ahb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="ahb" d="M0 0L10 5L0 10z"/></marker></defs>';
 for(const [a,b] of cur.links||[]){const A=g.P[a],B=g.P[b];h+=`<line class="lnk" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`}
 let chips='';
 ms.slice(0,done).forEach(m=>{
  const s=seg(m,g),k=m[3]||'p',lost=k==='l';
  const ex=lost?s.x1+(s.x2-s.x1)*.55:s.x2,ey=lost?s.y1+(s.y2-s.y1)*.55:s.y2;
  h+=`<line class="tr k${k}" x1="${s.x1}" y1="${s.y1}" x2="${ex}" y2="${ey}"${lost?'':` marker-end="url(#${k==='x'?'ahb':'ah'})"`}/>`;
  if(lost)h+=`<path class="tr kx" d="M${ex-6} ${ey-6}l12 12M${ex+6} ${ey-6}l-12 12" stroke-width="2.5"/>`;
  const sp=g.W<520?6.2:2.6,mx=(s.x1+ex)/2+s.n.x*s.o*sp,my=(s.y1+ey)/2+s.n.y*s.o*sp;
  chips+=chip(mx,my,lost?m[2]+' (lost)':m[2],k,g.W);
 });
 for(const a of cur.actors){
  const p=g.P[a.id],w=g.nw,ht=g.nh,lab=(a.s&&a.l.length*8.2>w-10)?a.s:a.l,sub=a.sub&&a.sub.length*6.4<w-6&&g.W>=520;
  const bd=st.b&&st.b[a.id];
  h+=`<g class="node${on.has(a.id)?' on':''}" transform="translate(${p.x},${p.y})"><rect class="sh" x="${-w/2+3}" y="${-ht/2+4}" width="${w}" height="${ht}" rx="10"/><rect class="bx" x="${-w/2}" y="${-ht/2}" width="${w}" height="${ht}" rx="10"/><text class="lb" y="${sub?-2:5}">${esc(lab)}</text>${sub?`<text class="sb" y="16">${esc(a.sub)}</text>`:''}${bd?`<text class="bd" x="${Math.max(bd.length*3.7+4,Math.min(g.W-bd.length*3.7-4,p.x))-p.x}" y="${ht/2+20}">${esc(bd)}</text>`:''}</g>`;
 }
 h+=chips;
 if(pkt&&ms[pkt.i]){
  const m=ms[pkt.i],s=seg(m,g),t=pkt.t,k=m[3]||'p';
  const op=k==='l'&&t>.5?Math.max(0,1-(t-.5)*4):1;
  h+=`<g opacity="${op}">${chip(s.x1+(s.x2-s.x1)*t,s.y1+(s.y2-s.y1)*t,m[2],k,g.W,' pk')}</g>`;
 }
 svg.innerHTML=h;
}

const wait=ms=>new Promise(r=>setTimeout(r,ms));
function fly(i,tok){
 return new Promise(res=>{
  const dur=RM.matches?0:1300/speed;if(!dur){res();return}
  const t0=performance.now();pkt={i,t:0};
  const f=now=>{if(tok!==token){res();return}const r=Math.min(1,(now-t0)/dur);pkt.t=r<.5?2*r*r:1-((-2*r+2)**2)/2;draw();r<1?requestAnimationFrame(f):res()};
  requestAnimationFrame(f);
 });
}
async function run(){
 const tok=++token;done=0;pkt=null;renderStep();draw();
 const st=cur.steps[step],ms=st.m||[];
 await wait(RM.matches?0:250);
 for(let i=0;i<ms.length;i++){
  if(tok!==token)return;
  await fly(i,tok);if(tok!==token)return;
  pkt=null;done=i+1;draw();await wait(RM.matches?0:350/speed);
 }
 if(!playing||tok!==token)return;
 const words=st.d.replace(/<[^>]+>/g,'').split(/\s+/).length;
 await wait(Math.max(3500,words*240)/speed);
 if(tok!==token||!playing)return;
 if(step<cur.steps.length-1){go(step+1,true)}else setPlaying(false);
}
function go(i,keepPlaying){
 if(!keepPlaying&&playing)setPlaying(false,true);
 step=Math.max(0,Math.min(cur.steps.length-1,i));memStep[curId]=step;run();
}
function setPlaying(p,silent){
 playing=p;$('#play').textContent=p?'Pause':'Play';
 if(p&&!silent){if(step===cur.steps.length-1&&done===(cur.steps[step].m||[]).length)step=0;run()}
}
function renderStep(){
 const st=cur.steps[step],n=cur.steps.length;
 $('#step').innerHTML=`<div class="n">Step ${step+1} of ${n}</div><h2>${esc(st.t)}</h2><p>${st.d}</p>`;
 $('#dots').innerHTML=cur.steps.map((s,i)=>`<button data-i="${i}" title="${esc(s.t)}" aria-label="Step ${i+1}: ${esc(s.t)}"${i===step?' aria-current="step"':''} class="${i<step?'past':''}">${i+1}</button>`).join('');
 $('#prev').disabled=step===0;$('#next').disabled=step===n-1;
}
function deeperHtml(t){
 return (t.deeper||[]).map(([id,why])=>`<a href="#${id}"><b>${esc(TOPICS[id].title)}</b><span>${esc(why)}${TOPICS[id].steps?'':' · coming soon'}</span></a>`).join('');
}
function open(id){
 token++;pkt=null;setPlaying(false,true);
 curId=id;cur=TOPICS[id];
 $('#crumb').innerHTML=trail.length>1?trail.map((t,i)=>i<trail.length-1?`<a href="#${t}">${esc(nameOf(t))}</a><span aria-hidden="true">›</span>`:`<span>${esc(nameOf(t))}</span>`).join(''):`<span>${esc(groupOf(id))}</span>`;
 $('#title').textContent=cur.title;$('#lead').textContent=cur.blurb;
 document.title=nameOf(id)+' · A Series of Tubes';
 const anim=!!cur.steps;$('#anim').hidden=!anim;$('#soon').hidden=anim;
 if(anim){
  $('#deeper').innerHTML=`<h3>Go deeper</h3>${deeperHtml(cur)}`;
  $('#term').innerHTML=`<details><summary>Dive deeper: see it for real in a terminal</summary><div class="box"><div class="bar"><span>Terminal</span><button id="copy">Copy command</button></div><pre><b>$ ${esc(cur.cmd)}</b>\n${esc(cur.out)}</pre></div><p>${esc(cur.note)} Sample output, trimmed.</p></details>`;
  step=memStep[id]||0;markSeen(id);run();
 }else{
  $('#soon').innerHTML=`<h2>Animation coming soon</h2><p>This topic is planned. It will cover:</p><ul>${cur.plan.map(p=>`<li>${esc(p)}</li>`).join('')}</ul><div class="deeper soon-rel"><h3>Meanwhile, related topics</h3>${deeperHtml(cur)}</div>`;
 }
 renderNav();
 window.scrollTo({top:0,behavior:RM.matches?'auto':'smooth'});
}
function route(){
 let id=location.hash.slice(1);if(!TOPICS[id])id='journey';
 if(fromSide||!trail.length)trail=[id];
 else{const k=trail.indexOf(id);trail=k>=0?trail.slice(0,k+1):[...trail,id]}
 fromSide=false;open(id);
}

$('#find').addEventListener('input',renderNav);
document.addEventListener('click',e=>{
 if(e.target.closest('[data-side]'))fromSide=true;
 const d=e.target.closest('#dots button');if(d)go(+d.dataset.i);
 if(e.target.id==='copy'){try{navigator.clipboard.writeText(cur.cmd).then(()=>{e.target.textContent='Copied'},()=>{e.target.textContent='Select and copy'})}catch(err){e.target.textContent='Select and copy'}}
});
$('#prev').addEventListener('click',()=>go(step-1));
$('#next').addEventListener('click',()=>go(step+1));
$('#replay').addEventListener('click',()=>run());
$('#play').addEventListener('click',()=>setPlaying(!playing));
$('#speed').addEventListener('click',e=>{speed=speed===1?2:speed===2?.5:1;e.target.textContent=(speed===.5?'½':speed)+'×'});
document.addEventListener('keydown',e=>{
 if(!cur||!cur.steps||e.target.matches('input,textarea'))return;
 if(e.key==='ArrowRight'&&step<cur.steps.length-1)go(step+1);
 else if(e.key==='ArrowLeft'&&step>0)go(step-1);
 else if(e.key===' '&&!e.target.matches('button,a')){e.preventDefault();setPlaying(!playing)}
});
window.addEventListener('hashchange',route);
const ro=new ResizeObserver(draw);ro.observe(svg);
route();
