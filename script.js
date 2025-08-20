
(function(){
  'use strict';

  // Register Service Worker (PWA)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
    });
  }

  // storage keys & defaults
  const STORAGE = { workouts:'gt.workouts.v3', bank:'gt.exerciseBank.v3', profile:'gt.profile.v1' };
  const DEFAULT_BANK = ['Bench Press','Incline Bench Press','Shoulder Press','Lateral Raise','Lat Pulldown','Seated Row','Squat','Deadlift','Leg Press','Leg Curl','Calf Raise','Biceps Curl','Triceps Pushdown','Face Pull','Chest Press','Pull Up','Dip','Barbell Row','Leg Extension'];

  function load(k,f){ try{ return JSON.parse(localStorage.getItem(k)) ?? f }catch{ return f } }
  function save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }

  let workouts = load(STORAGE.workouts, []);
  let exerciseBank = load(STORAGE.bank, DEFAULT_BANK.slice());
  let profile = load(STORAGE.profile, { firstName:'Jméno', lastName:'Příjmení' });

  // state
  const state = {
    started:false, paused:false, startMs:0, pauseStart:0, pausedAccum:0, timerId:null, runMs:0,
    restId:null, restStart:0, lastRestSec:0,
    selected:[], // exercise names in order
    todaySets: [], // {exercise,weight,reps,rpe,note,restSec,ts}
    title:''
  };

  // elements
  const $ = id => document.getElementById(id);
  const profileAvatar = $('profileAvatar');
  const profileNameEl = $('profileName');
  const editProfileBtn = $('editProfileBtn');

  const workoutDate = $('workoutDate');
  const workoutTitle = $('workoutTitle');
  const activeTitle = $('activeTitle');
  const titleHint = $('titleHint');
  const startFromHome = $('startFromHome');
  const openProgressBtn = $('openProgressBtn');
  const openArchiveBtn = $('openArchiveBtn');
  const exportBtn = $('exportBtn');
  const importBtn = $('importBtn');
  const importFile = $('importFile');

  const home = $('home');
  const active = $('active');
  const progress = $('progress');
  const archive = $('archive');

  const timerEl = $('timer');
  const btnStart = $('btnStart');
  const btnPause = $('btnPause');
  const btnHome = $('btnHome');

  const restTimerEl = $('restTimer');
  const restStartBtn = $('restStartBtn');
  const restStopBtn = $('restStopBtn');
  const lastRestBadge = $('lastRestBadge');

  const exerciseButtons = $('exerciseButtons');
  const addExerciseInput = $('addExerciseInput');
  const addExerciseBtn = $('addExerciseBtn');

  const selectedList = $('selectedList');
  const doneWorkoutBtn = $('doneWorkoutBtn');

  const recentList = $('recentList');

  const progressExercise = $('progressExercise');
  const progressMode = $('progressMode');
  const aggMode = $('aggMode');
  const progressChartEl = $('progressChart');

  const archiveFilterExercise = $('archiveFilterExercise');
  const archiveSearch = $('archiveSearch');
  const archiveList = $('archiveList');

  const summaryModal = $('summaryModal');
  const summaryStats = $('summaryStats');
  const rpeChartEl = $('rpeChart');
  const closeSummaryBtn = $('closeSummaryBtn');
  const summaryCloseX = $('summaryCloseX');
  const confirmSummaryBtn = $('confirmSummaryBtn');

  // charts
  let progressChart = null, rpeChart = null;

  // helpers
  function todayISO(){ const d=new Date(); const tz=d.getTimezoneOffset()*60000; return new Date(d-tz).toISOString().slice(0,10); }
  function fmtHMS(ms){ const s=Math.floor(ms/1000); const hh=String(Math.floor(s/3600)).padStart(2,'0'); const mm=String(Math.floor((s%3600)/60)).padStart(2,'0'); const ss=String(s%60).padStart(2,'0'); return `${hh}:${mm}:${ss}`; }
  function fmtMMSS(sec){ const m=Math.floor(sec/60); const s=sec%60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

  function switchTo(section){ home.classList.add('hidden'); active.classList.add('hidden'); progress.classList.add('hidden'); archive.classList.add('hidden'); section.classList.remove('hidden'); }

  // PROFILE
  function initials(f,l){ const a=(f||'').trim()[0]||'?'; const b=(l||'').trim()[0]||'?'; return (a+b).toUpperCase(); }
  function renderProfile(){ profileAvatar.textContent = initials(profile.firstName, profile.lastName); profileNameEl.textContent = `${profile.firstName||''} ${profile.lastName||''}`.trim()||'Jméno Příjmení'; }
  editProfileBtn.addEventListener('click',()=>{
    const first = prompt('Jméno', profile.firstName||'') ?? profile.firstName;
    const last = prompt('Příjmení', profile.lastName||'') ?? profile.lastName;
    profile = { firstName:first||'Jméno', lastName:last||'Příjmení' }; save(STORAGE.profile, profile); renderProfile();
  });

  // init
  function init(){ workoutDate.value = todayISO(); buildExerciseButtons(); buildRecent(); buildArchiveFilters(); buildArchive(); buildProgressOptions(); updateStats(); updateUIState(); renderProfile(); }

  // build exercise selection buttons
  function buildExerciseButtons(){ exerciseButtons.innerHTML=''; exerciseBank.forEach(name=>{ const b=document.createElement('button'); b.className='ex-btn'; b.textContent=name; b.onclick=()=>toggleSelectExercise(name,b); exerciseButtons.appendChild(b); }); }

  function toggleSelectExercise(name, btn){
    const idx = state.selected.indexOf(name);
    if(idx===-1){ state.selected.push(name); btn.classList.add('active'); }
    else { state.selected.splice(idx,1); btn.classList.remove('active'); }
    renderSelectedList(); updateUIState();
  }

  addExerciseBtn.addEventListener('click', ()=>{ const v=(addExerciseInput.value||'').trim(); if(!v) return; if(!exerciseBank.includes(v)){ exerciseBank.push(v); save(STORAGE.bank, exerciseBank); } addExerciseInput.value=''; buildExerciseButtons(); });

  // render selected exercises + sets UI
  function renderSelectedList(){ selectedList.innerHTML=''; if(state.selected.length===0){ selectedList.innerHTML='<div class="small">Žádné vybrané cviky — klikni na název cviku pro přidání.</div>'; doneWorkoutBtn.disabled=true; return; }
    doneWorkoutBtn.disabled=false;
    state.selected.forEach(ex=>{
      const box=document.createElement('div'); box.className='set-group';
      const header=document.createElement('div'); header.innerHTML=`<strong>${ex}</strong> <span class="small">(${state.todaySets.filter(s=>s.exercise===ex).length} sérií)</span>`; box.appendChild(header);

      const prev = document.createElement('div'); prev.style.marginTop='8px';
      const sets = state.todaySets.filter(s=>s.exercise===ex);
      if(sets.length){ sets.slice().reverse().forEach(s=>{ const line=document.createElement('div'); line.className='set-line'; line.innerHTML=`<div class="small">${fmtMMSS(Math.floor((Date.now()-s.ts)/1000))} ago · <strong>${s.weight}kg × ${s.reps}</strong> ${s.rpe?`· RPE ${s.rpe}`:''} ${s.note?`· <span class="small">${s.note}</span>`:''}</div>`; prev.appendChild(line); }); } else { prev.innerHTML='<div class="small">Žádné série zatím</div>'; }
      box.appendChild(prev);

      // inputs for new set
      const inputs=document.createElement('div'); inputs.className='row wrap'; inputs.style.marginTop='8px';
      const w=document.createElement('input'); w.placeholder='váha (kg)'; w.type='number'; w.step='0.5'; w.style.width='110px';
      const r=document.createElement('input'); r.placeholder='opakování'; r.type='number'; r.style.width='110px';
      const e=document.createElement('input'); e.placeholder='RPE'; e.type='number'; e.step='0.5'; e.min='1'; e.max='10'; e.style.width='90px';
      const n=document.createElement('input'); n.placeholder='poznámka'; n.style.flex='1';
      const addBtn=document.createElement('button'); addBtn.className='btn-primary'; addBtn.textContent='Přidat sérii';
      addBtn.onclick=()=>{
        const weight=parseFloat(w.value); const reps=parseInt(r.value); const rpe = e.value?parseFloat(e.value):null; const note=n.value||'';
        if(isNaN(weight)||isNaN(reps)){ alert('Vyplň váhu a opakování'); return; }
        const rest = state.lastRestSec || 0;
        state.todaySets.push({exercise:ex,weight, reps, rpe, note, restSec:rest, ts: Date.now()});
        w.value=''; r.value=''; e.value=''; n.value=''; state.lastRestSec=0; lastRestBadge.textContent=''; renderSelectedList();
      };

      inputs.appendChild(w); inputs.appendChild(r); inputs.appendChild(e); inputs.appendChild(n); inputs.appendChild(addBtn);
      box.appendChild(inputs);
      selectedList.appendChild(box);
    });
  }

  // timer controls: start only when user presses Start (after selection)
  function updateUIState(){
    btnStart.disabled = state.selected.length===0 || state.started;
    btnPause.disabled = !state.started;
    // sync title home -> active (one-time hint)
    if(workoutTitle.value && !activeTitle.value){ activeTitle.value = workoutTitle.value; }
    state.title = activeTitle.value.trim();
    titleHint.textContent = state.title ? `Nadpis: ${state.title}` : '';
  }

  btnStart.addEventListener('click', ()=>{
    if(state.started) return;
    state.started=true; state.paused=false; state.startMs = Date.now(); state.pausedAccum=0; timerTick(); state.timerId=setInterval(timerTick,1000);
    btnStart.disabled=true; btnPause.disabled=false; startFromHome.disabled=true;
  });

  btnPause.addEventListener('click', ()=>{
    if(!state.started) return;
    if(!state.paused){ state.paused=true; state.pauseStart=Date.now(); btnPause.textContent='Pokračovat'; }
    else { state.paused=false; state.pausedAccum += Date.now()-state.pauseStart; btnPause.textContent='Pauza'; }
  });

  btnHome.addEventListener('click', ()=>{ switchTo(home); });

  function timerTick(){
    if(!state.started){ timerEl.textContent = fmtHMS(state.runMs||0); return; }
    const now = state.paused ? state.pauseStart : Date.now();
    state.runMs = now - state.startMs - state.pausedAccum;
    if(state.runMs<0) state.runMs = 0;
    timerEl.textContent = fmtHMS(state.runMs);
  }

  // rest timer
  restStartBtn.addEventListener('click', ()=>{ if(state.restId) return; state.restStart = Date.now(); state.restId = setInterval(()=>{ const s = Math.floor((Date.now()-state.restStart)/1000); restTimerEl.textContent = fmtMMSS(s); },1000); });
  restStopBtn.addEventListener('click', ()=>{ if(!state.restId) return; clearInterval(state.restId); state.restId=null; const sec = Math.floor((Date.now()-state.restStart)/1000); state.lastRestSec = sec; lastRestBadge.textContent = `Poslední pauza: ${fmtMMSS(sec)}`; restTimerEl.textContent='00:00'; });

  // Done button -> show summary modal with small RPE chart
  function openSummary(){
    if(state.todaySets.length===0){ alert('Přidej aspoň jednu sérii před ukončením.'); return; }
    const totalSets = state.todaySets.length;
    const totalTime = state.runMs || 0;
    const rpeCount = state.todaySets.filter(s=>s.rpe!=null).length;
    const avgRPE = rpeCount? Math.round((state.todaySets.reduce((a,s)=>a+(s.rpe||0),0)/rpeCount)*10)/10 : 0;
    const labels = state.todaySets.map(s => new Date(s.ts).toLocaleTimeString());
    const rpeVals = state.todaySets.map(s => s.rpe || 0);

    const title = (activeTitle.value || workoutTitle.value || '').trim();

    summaryStats.innerHTML = `Název: <strong>${title||'-'}</strong><br/>Datum: <strong>${workoutDate.value||todayISO()}</strong><br/>Celkový čas: <strong>${fmtHMS(totalTime)}</strong><br/>Série: <strong>${totalSets}</strong><br/>Průměrné RPE: <strong>${rpeCount?avgRPE:'-'}</strong>`;

    if(rpeChart) rpeChart.destroy();
    const ctx = rpeChartEl.getContext('2d');
    rpeChart = new Chart(ctx, { type:'line', data:{ labels: labels, datasets:[{ label:'RPE (série)', data: rpeVals, borderColor:'#2fb0ff', backgroundColor:'rgba(47,176,255,0.15)', fill:true, tension:.35 }] }, options:{ scales:{ y:{ beginAtZero:true, max:10 } }, plugins:{ legend:{display:false} }, maintainAspectRatio:false } });

    summaryModal.classList.remove('hidden');
  }

  $('doneWorkoutBtn').addEventListener('click', openSummary);
  const hideSummary = ()=> summaryModal.classList.add('hidden');
  closeSummaryBtn.addEventListener('click', hideSummary);
  summaryCloseX.addEventListener('click', hideSummary);

  confirmSummaryBtn.addEventListener('click', ()=>{
    const id = (crypto && crypto.randomUUID)?crypto.randomUUID(): (Date.now()+'-'+Math.random());
    const w = { id, date: workoutDate.value||todayISO(), durationMs: state.runMs||0, sets: state.todaySets.slice(), title: (activeTitle.value||workoutTitle.value||'').trim() };
    workouts.push(w); save(STORAGE.workouts, workouts);
    // reset state
    state.selected = []; state.todaySets = []; state.runMs=0; state.pausedAccum=0; state.paused=false; state.lastRestSec=0; activeTitle.value=''; workoutTitle.value='';
    clearInterval(state.timerId); state.timerId=null; timerEl.textContent='00:00:00'; btnPause.textContent='Pauza';
    hideSummary(); buildExerciseButtons(); buildRecent(); buildArchiveFilters(); buildArchive(); buildProgressOptions(); updateStats(); updateUIState(); switchTo(home);
  });

  // progress & archive
  function buildRecent(){
    recentList.innerHTML='';
    const last = [...workouts].reverse().slice(0,6);
    if(!last.length){ recentList.innerHTML='<div class="small">Žádné tréninky.</div>'; return; }
    last.forEach(w=>{
      const d=document.createElement('div');
      const mins=Math.round((w.durationMs||0)/60000);
      const ttl = w.title? ` · <span class="pill">${w.title}</span>` : '';
      d.innerHTML=`<strong>${w.date}</strong>${ttl} · ${mins} min · ${w.sets.length} sérií`;
      recentList.appendChild(d);
    });
  }

  function buildArchiveFilters(){
    archiveFilterExercise.innerHTML='';
    const optAll=document.createElement('option'); optAll.value=''; optAll.textContent='(všechny cviky)'; archiveFilterExercise.appendChild(optAll);
    const set=new Set(); workouts.forEach(w=> w.sets.forEach(s=> set.add(s.exercise)));
    Array.from(set).sort().forEach(n=>{ const o=document.createElement('option'); o.value=n; o.textContent=n; archiveFilterExercise.appendChild(o); });
  }

  function buildArchive(){
    archiveList.innerHTML='';
    const q = (archiveSearch.value||'').toLowerCase();
    const ex = archiveFilterExercise.value;

    const list = workouts.slice().reverse().filter(w=>{
      const textOk = !q || (w.title||'').toLowerCase().includes(q) || (w.sets||[]).some(s=> (s.note||'').toLowerCase().includes(q));
      const exOk = !ex || (w.sets||[]).some(s=> s.exercise===ex);
      return textOk && exOk;
    });

    if(!list.length){ archiveList.innerHTML='<div class="small">Nic k zobrazení.</div>'; return; }

    list.forEach(w=>{
      const det=document.createElement('details');
      const sum=document.createElement('summary');
      const mins=Math.round((w.durationMs||0)/60000);
      const ttl = w.title? ` · ${w.title}` : '';
      sum.textContent=`${w.date}${ttl} · ${mins} min · ${w.sets.length} sérií`;
      det.appendChild(sum);
      const wrap=document.createElement('div'); wrap.className='small';
      w.sets.filter(s=>!ex || s.exercise===ex).forEach((s,i)=>{
        const el=document.createElement('div'); el.textContent=`${i+1}. ${s.exercise} — ${s.weight}kg × ${s.reps}${s.rpe?` · RPE ${s.rpe}`:''}${s.note?` · ${s.note}`:''}`; wrap.appendChild(el);
      });
      det.appendChild(wrap);
      archiveList.appendChild(det);
    });
  }

  // progress chart functions
  function buildProgressOptions(){
    progressExercise.innerHTML='';
    const set=new Set(); workouts.forEach(w=> w.sets.forEach(s=> set.add(s.exercise)));
    const arr=Array.from(set).sort();
    if(arr.length===0){ const o=document.createElement('option'); o.textContent='(žádná data)'; progressExercise.appendChild(o); return; }
    arr.forEach(n=>{ const o=document.createElement('option'); o.value=n; o.textContent=n; progressExercise.appendChild(o); });
  }

  function drawProgress(){
    if(progressChart) progressChart.destroy();
    const ex = progressExercise.value; if(!ex) return;
    const mode=progressMode.value; const agg=aggMode.value;
    if(mode==='daily'){
      const map=new Map();
      workouts.forEach(w=>{ const date=w.date; const vol=w.sets.filter(s=>s.exercise===ex).reduce((a,s)=>a+s.weight*s.reps,0); if(vol>0) map.set(date,(map.get(date)||0)+vol); });
      const labels=Array.from(map.keys()).sort();
      const vals=labels.map(d=>map.get(d));
      const ctx=progressChartEl.getContext('2d');
      const grad=ctx.createLinearGradient(0,0,0,200); grad.addColorStop(0,'#2fb0ff'); grad.addColorStop(1,'#073147');
      progressChart=new Chart(ctx,{type:'line',data:{labels, datasets:[{label:ex,data:vals,backgroundColor:grad,borderColor:'#2fb0ff',fill:true,tension:.3}]},options:{scales:{y:{beginAtZero:true}}}});
    } else {
      const map=new Map();
      workouts.forEach(w=>{ const ym=w.date.slice(0,7); const vals=w.sets.filter(s=>s.exercise===ex).map(s=>s.weight*s.reps); if(vals.length){ if(!map.has(ym)) map.set(ym,[]); map.get(ym).push(...vals); } });
      const labels=Array.from(map.keys()).sort();
      const vals=labels.map(k=>{ const arr=map.get(k)||[]; if(agg==='avg') return Math.round(arr.reduce((a,b)=>a+b,0)/arr.length||0); return Math.max(...arr||[0]); });
      const ctx=progressChartEl.getContext('2d');
      const grad=ctx.createLinearGradient(0,0,0,200); grad.addColorStop(0,'#2fb0ff'); grad.addColorStop(1,'#073147');
      progressChart=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:ex,data:vals,backgroundColor:grad,borderColor:'#2fb0ff',fill:true,tension:.3}]},options:{scales:{y:{beginAtZero:true}}}});
    }
  }

  // events for navigation
  openProgressBtn.addEventListener('click', ()=>{ switchTo(progress); buildProgressOptions(); drawProgress(); });
  $('closeProgressBtn').addEventListener('click', ()=>switchTo(home));
  openArchiveBtn.addEventListener('click', ()=>{ switchTo(archive); buildArchiveFilters(); buildArchive(); });
  $('closeArchiveBtn').addEventListener('click', ()=>switchTo(home));
  progressExercise.addEventListener('change', drawProgress); progressMode.addEventListener('change', drawProgress); aggMode.addEventListener('change', drawProgress);
  archiveFilterExercise.addEventListener('change', buildArchive);
  archiveSearch.addEventListener('input', buildArchive);

  // start from home: open active screen but don't start timer until user presses Start
  startFromHome.addEventListener('click', ()=>{ switchTo(active); updateUIState(); renderSelectedList(); activeTitle.value = workoutTitle.value; state.title = activeTitle.value.trim(); });
  activeTitle.addEventListener('input', ()=>{ state.title = activeTitle.value.trim(); titleHint.textContent = state.title ? `Nadpis: ${state.title}` : ''; });

  // EXPORT / IMPORT
  exportBtn.addEventListener('click', ()=>{
    const payload = { version:3, exportedAt:new Date().toISOString(), workouts, exerciseBank, profile };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `one-rep-hero-export-${todayISO()}.json`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  });

  importBtn.addEventListener('click', ()=> importFile.click());
  importFile.addEventListener('change', (e)=>{
    const file = e.target.files && e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const data = JSON.parse(reader.result);
        if(!data || (!Array.isArray(data.workouts) && !Array.isArray(data.sessions) )) throw new Error('Neplatný soubor');
        workouts = Array.isArray(data.workouts) ? data.workouts : data.sessions; // backward compat
        exerciseBank = Array.isArray(data.exerciseBank) ? data.exerciseBank : exerciseBank;
        if(data.profile) profile=data.profile; save(STORAGE.profile,profile);
        save(STORAGE.workouts, workouts); save(STORAGE.bank, exerciseBank);
        buildExerciseButtons(); buildRecent(); buildArchiveFilters(); buildArchive(); buildProgressOptions(); updateStats(); renderProfile();
        alert('Import dokončen');
      }catch(err){ alert('Nepodařilo se importovat JSON: '+err.message); }
      importFile.value = '';
    };
    reader.readAsText(file);
  });

  // Stats from workouts
  function updateStats(){
    const count = workouts.length; document.getElementById('statWorkouts').textContent = count;
    const totalMs = workouts.reduce((a,w)=>a+(w.durationMs||0),0); document.getElementById('statTime').textContent = fmtHMS(totalMs);
    const rpeVals = []; workouts.forEach(w=> (w.sets||[]).forEach(s=>{ if(typeof s.rpe==='number') rpeVals.push(s.rpe) }));
    document.getElementById('statRPE').textContent = rpeVals.length? (Math.round((rpeVals.reduce((a,b)=>a+b,0)/rpeVals.length)*10)/10) : '-';
  }

  // init run
  init();
})();
