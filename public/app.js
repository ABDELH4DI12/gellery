const slider=document.querySelector('#slider'),currentEl=document.querySelector('#current'),totalEl=document.querySelector('#total'),progress=document.querySelector('#progress');let slides=[],virtualIndex=0,startX=0,deltaX=0,wheelLocked=false;const pad=n=>String(n).padStart(2,'0');const mod=(n,m)=>((n%m)+m)%m;

function render(){
  const n=slides.length;
  if(!n){currentEl.textContent='00';totalEl.textContent='00';progress.style.width='0%';return;}
  const active=mod(virtualIndex,n);
  slides.forEach((s,i)=>{
    let rel=i-active;
    if(rel>n/2) rel-=n;
    if(rel<-n/2) rel+=n;
    s.className='slide '+(rel===0?'active':rel<0?'before':'after');
  });
  currentEl.textContent=pad(active+1);
  totalEl.textContent=pad(n);
  progress.style.width=`${((active+1)/n)*100}%`;
}

function go(direction){
  if(slides.length<2)return;
  virtualIndex+=direction;
  render();
}

async function load(){
  try{
    const r=await fetch('/api/gallery');
    const j=await r.json();
    slider.innerHTML='';
    (j.images||[]).forEach(({url},i)=>{
      const el=document.createElement('article');
      el.className='slide';
      const img=document.createElement('img');
      img.src=url;
      img.alt=`Selected work ${i+1}`;
      img.loading=i<2?'eager':'lazy';
      el.appendChild(img);
      slider.appendChild(el);
    });
    slides=[...slider.querySelectorAll('.slide')];
    if(!slides.length)slider.innerHTML='<div class="empty">New work is coming soon.</div>';
    render();
  }catch{
    slider.innerHTML='<div class="empty">Unable to load the showcase.</div>';
  }
}

document.querySelector('#prev').onclick=()=>go(-1);
document.querySelector('#next').onclick=()=>go(1);
document.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')go(-1);if(e.key==='ArrowRight')go(1)});
slider.addEventListener('touchstart',e=>{startX=e.touches[0].clientX;deltaX=0},{passive:true});
slider.addEventListener('touchmove',e=>deltaX=e.touches[0].clientX-startX,{passive:true});
slider.addEventListener('touchend',()=>{if(Math.abs(deltaX)>45)go(deltaX<0?1:-1)});
slider.addEventListener('wheel',e=>{
  if(wheelLocked||slides.length<2)return;
  if(Math.abs(e.deltaY)<8&&Math.abs(e.deltaX)<8)return;
  wheelLocked=true;
  go((Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY)>0?1:-1);
  setTimeout(()=>wheelLocked=false,650);
},{passive:true});

load();