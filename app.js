(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const STORAGE = {
    custom: 'lol_custom_puzzles_v2',
    stats: 'lol_stats_v2',
    settings: 'lol_settings_v2'
  };

  const state = {
    puzzles: [], current: null, eliminated: [], history: [], lives: 3,
    startedAt: 0, timerId: null, mode: 'solo', players: [], activePlayer: 0,
    familyScores: {}, locked: false, currentFilter: null
  };

  const wikiImageCache = new Map();
  let audioCtx = null;

  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function settings() { return loadJSON(STORAGE.settings, {sound:true, aiEndpoint:''}); }
  function saveSettings(patch) { saveJSON(STORAGE.settings, {...settings(), ...patch}); updateSoundUI(); }

  function normalizePuzzle(p, index = 0) {
    const choices = (p.choices || []).slice(0,9).map((c,i) => ({
      id: c.id || `c${i+1}`,
      name: c.name || `Choice ${i+1}`,
      value: c.value || '',
      image: c.image || '',
      wiki: c.wiki || c.wikiTitle || ''
    }));
    return {
      id: p.id || `custom-${Date.now()}-${index}`,
      category: p.category || 'Custom',
      title: p.title || 'Custom Puzzle',
      questionTop: p.questionTop || 'WHICH HAS THE',
      questionHighlight: p.questionHighlight || 'BEST ANSWER',
      questionBottom: p.questionBottom || 'ON THIS LIST?',
      fact: p.fact || '',
      answerId: p.answerId || choices[0]?.id,
      choices,
      aiGenerated: !!p.aiGenerated
    };
  }

  function reloadPuzzles() {
    const custom = loadJSON(STORAGE.custom, []).map(normalizePuzzle);
    state.puzzles = [...window.STARTER_PUZZLES.map(normalizePuzzle), ...custom];
    $('#puzzleCount').textContent = state.puzzles.length;
    renderCategories();
  }

  function hashDate(date = new Date()) {
    const key = `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;
    let h = 2166136261;
    for (const ch of key) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }
  function dailyPuzzle() { return state.puzzles[hashDate() % state.puzzles.length]; }
  function randomPuzzle(filter = state.currentFilter, avoidId = state.current?.id) {
    let list = state.puzzles.filter(p => !filter || p.category === filter);
    if (list.length > 1) list = list.filter(p => p.id !== avoidId);
    return list[Math.floor(Math.random() * list.length)] || state.puzzles[0];
  }
  function showView(id) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#${id}`).classList.add('active');
    window.scrollTo(0,0);
  }

  function startPuzzle(puzzle, opts = {}) {
    state.current = puzzle; state.eliminated = []; state.history = []; state.lives = 3;
    state.locked = false; state.startedAt = Date.now();
    if (opts.mode) state.mode = opts.mode;
    if (state.mode !== 'family') { state.players = []; state.familyScores = {}; state.activePlayer = 0; }
    $('#modeLabel').textContent = state.mode === 'family' ? 'Pass & Play' : (puzzle.aiGenerated ? 'AI generated' : 'Family quiz');
    renderPuzzle(); startTimer(); showView('gameView');
  }

  function renderPuzzle() {
    const p = state.current; if (!p) return;
    $('#categoryChip').textContent = p.category.toUpperCase();
    $('#questionTop').textContent = p.questionTop;
    $('#questionHighlight').textContent = p.questionHighlight;
    $('#questionBottom').textContent = p.questionBottom;
    renderLives(); renderTurn();
    const grid = $('#grid'); grid.innerHTML = '';
    p.choices.forEach(choice => {
      const btn = document.createElement('button');
      btn.className = 'tile'; btn.dataset.id = choice.id; btn.setAttribute('aria-label', choice.name);
      const fallback = placeholderFor(choice.name);
      btn.innerHTML = `<div class="tile-media">${choice.image
        ? `<img src="${escapeAttr(choice.image)}" alt="${escapeAttr(choice.name)}">`
        : `<div class="tile-photo-placeholder ${fallback.length > 4 ? 'small-text' : ''}">${escapeHTML(fallback)}</div>`}</div>
        <div class="tile-name">${escapeHTML(choice.name)}</div>`;
      btn.addEventListener('click', () => choose(choice.id));
      grid.appendChild(btn);
    });
    $('#undoBtn').disabled = true;
    hydratePuzzlePhotos(p).catch(() => {});
  }

  function placeholderFor(name='') {
    const trimmed = String(name).trim();
    if (/^[\d!⁰¹²³⁴⁵⁶⁷⁸⁹×÷^.+−-]+$/.test(trimmed) || trimmed.length <= 6) return trimmed.slice(0,10);
    const parts = trimmed.split(/\s+/).filter(Boolean);
    return (parts.length >= 2 ? parts.slice(0,3).map(x => x[0]).join('') : trimmed.slice(0,2)).toUpperCase();
  }

  async function hydratePuzzlePhotos(puzzle) {
    const items = puzzle.choices.filter(c => !c.image && c.wiki);
    if (!items.length) return;
    const needed = items.filter(c => !wikiImageCache.has(c.wiki)).map(c => c.wiki);
    if (needed.length) await fetchWikipediaThumbnails(needed);
    items.forEach(c => {
      const src = wikiImageCache.get(c.wiki);
      if (!src) return;
      const media = $(`.tile[data-id="${cssEscape(c.id)}"] .tile-media`);
      if (!media || media.querySelector('img')) return;
      const img = new Image(); img.alt = c.name; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.onload = () => { if (media.isConnected) { media.innerHTML=''; media.appendChild(img); } };
      img.onerror = () => {};
      img.src = src;
    });
  }

  async function fetchWikipediaThumbnails(titles) {
    const unique = [...new Set(titles)].slice(0,40);
    if (!unique.length) return;
    const params = new URLSearchParams({
      action:'query', format:'json', origin:'*', redirects:'1', prop:'pageimages',
      piprop:'thumbnail', pithumbsize:'700', titles:unique.join('|')
    });
    try {
      const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
      if (!res.ok) throw new Error('Wikipedia image request failed');
      const data = await res.json();
      const alias = new Map(unique.map(t => [t,t]));
      (data.query?.normalized || []).forEach(n => alias.set(n.from,n.to));
      (data.query?.redirects || []).forEach(r => {
        for (const [k,v] of [...alias.entries()]) if (v === r.from) alias.set(k,r.to);
        alias.set(r.from,r.to);
      });
      const byTitle = new Map(Object.values(data.query?.pages || {}).map(p => [p.title, p.thumbnail?.source || '']));
      unique.forEach(original => {
        let resolved = alias.get(original) || original;
        for (let i=0;i<3 && alias.has(resolved) && alias.get(resolved)!==resolved;i++) resolved = alias.get(resolved);
        wikiImageCache.set(original, byTitle.get(resolved) || byTitle.get(original) || '');
      });
    } catch {
      unique.forEach(t => { if (!wikiImageCache.has(t)) wikiImageCache.set(t,''); });
    }
  }

  function choose(id) {
    if (state.locked || state.eliminated.includes(id)) return;
    unlockAudio();
    const p = state.current;
    const tile = $(`.tile[data-id="${cssEscape(id)}"]`);
    const player = state.mode === 'family' ? state.players[state.activePlayer] : null;
    if (id === p.answerId) {
      state.history.push({type:'life', id, player}); state.lives -= 1;
      tile.classList.remove('answer-hit'); void tile.offsetWidth; tile.classList.add('answer-hit');
      flashScreen('bad'); playSound('wrong'); vibrate([45,30,60]);
      if (player) state.familyScores[player] = (state.familyScores[player] || 0) - 1;
      renderLives(); toast(state.lives > 0 ? 'Careful — that one may be the answer. Life lost.' : 'No lives left.');
      if (state.lives <= 0) setTimeout(() => finish(false), 420); else advanceTurn();
    } else {
      state.history.push({type:'eliminate', id, player}); state.eliminated.push(id);
      if (player) state.familyScores[player] = (state.familyScores[player] || 0) + 1;
      tile.classList.add('safe-hit'); flashScreen('good'); playSound('safe'); vibrate(18);
      setTimeout(() => tile.classList.add('eliminated'), 145);
      const remaining = p.choices.filter(c => !state.eliminated.includes(c.id));
      if (remaining.length === 1) {
        state.locked = true;
        const lastTile = $(`.tile[data-id="${cssEscape(remaining[0].id)}"]`);
        lastTile?.classList.add('last');
        setTimeout(() => finish(remaining[0].id === p.answerId, true), 750);
      } else advanceTurn();
    }
    $('#undoBtn').disabled = state.history.length === 0 || state.locked;
  }

  function advanceTurn() {
    if (state.mode !== 'family' || !state.players.length) return;
    state.activePlayer = (state.activePlayer + 1) % state.players.length; renderTurn();
  }
  function renderLives() { $('#lives').innerHTML = [0,1,2].map(i => `<span aria-hidden="true">${i < state.lives ? '❤️' : '🖤'}</span>`).join(''); }
  function renderTurn() {
    const b = $('#turnBadge');
    if (state.mode === 'family' && state.players.length) { b.classList.remove('hidden'); b.textContent = `${state.players[state.activePlayer]}'s turn`; }
    else b.classList.add('hidden');
  }

  function undo() {
    if (!state.history.length || state.locked) return;
    const action = state.history.pop();
    if (state.mode === 'family' && action.player) {
      state.activePlayer = Math.max(0, state.players.indexOf(action.player));
      if (action.type === 'eliminate') state.familyScores[action.player] -= 1;
      if (action.type === 'life') state.familyScores[action.player] += 1;
      renderTurn();
    }
    if (action.type === 'eliminate') {
      state.eliminated = state.eliminated.filter(x => x !== action.id);
      const tile = $(`.tile[data-id="${cssEscape(action.id)}"]`);
      tile?.classList.remove('eliminated','safe-hit'); $$('.tile').forEach(t => t.classList.remove('last'));
    } else { state.lives = Math.min(3, state.lives + 1); renderLives(); }
    $('#undoBtn').disabled = state.history.length === 0;
  }

  function finish(win, alreadyLocked=false) {
    if (state.locked && !alreadyLocked && state.lives > 0) return;
    state.locked = true; stopTimer();
    const p = state.current; const answer = p.choices.find(c => c.id === p.answerId);
    const answerTile = $(`.tile[data-id="${cssEscape(p.answerId)}"]`);
    $$('.tile').forEach(t => { if (t !== answerTile && !t.classList.contains('eliminated')) t.style.opacity='.28'; });
    if (win) { answerTile?.classList.add('winner-reveal'); playSound('win'); vibrate([30,30,30]); confetti(); }
    else { answerTile?.classList.add('loser-reveal'); playSound('lose'); flashScreen('bad'); vibrate([80,50,80]); }

    const seconds = Math.max(1, Math.round((Date.now() - state.startedAt)/1000));
    const stats = loadJSON(STORAGE.stats, {coins:0,wins:0,played:0,streak:0,bestStreak:0}); stats.played += 1;
    let award=0;
    if (win) {
      award = Math.max(10, 100 - Math.floor(seconds/2) - (3-state.lives)*15);
      stats.coins += award; stats.wins += 1; stats.streak += 1; stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
      $('#resultIcon').textContent = '🏆'; $('#resultTitle').textContent = 'Last one standing!';
      $('#resultSub').textContent = `Solved in ${formatTime(seconds)} with ${state.lives} ${state.lives === 1 ? 'life' : 'lives'} left. +${award} stars.`;
    } else {
      stats.streak = 0; $('#resultIcon').textContent = '💥'; $('#resultTitle').textContent = 'That was the one.';
      $('#resultSub').textContent = `You ran out of lives in ${formatTime(seconds)}.`;
    }
    saveJSON(STORAGE.stats, stats); updateCoinUI();
    let family='';
    if (state.mode === 'family') family = `<div class="family-score"><b>Family scores:</b> ${Object.entries(state.familyScores).sort((a,b)=>b[1]-a[1]).map(([n,s])=>`${escapeHTML(n)} ${s}`).join(' · ')}</div>`;
    const sourceNote = p.aiGenerated ? '<div class="ai-source-note">AI-generated puzzle — the generator is instructed to fact-check with web search.</div>' : '';
    $('#answerReveal').innerHTML = `<b>${escapeHTML(answer?.name || '')}</b><span>${escapeHTML(answer?.value || '')}</span><p>${escapeHTML(p.fact || '')}</p>${sourceNote}${family}`;
    setTimeout(() => $('#resultModal').classList.remove('hidden'), win ? 1150 : 900);
  }

  function startTimer() {
    stopTimer(); $('#timer').textContent='0:00';
    state.timerId=setInterval(()=>{ const s=Math.floor((Date.now()-state.startedAt)/1000); $('#timer').textContent=formatTime(s); },500);
  }
  function stopTimer(){ if(state.timerId) clearInterval(state.timerId); state.timerId=null; }
  function formatTime(s){ return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

  function clue() {
    if (state.locked) return;
    const p=state.current; const candidates=p.choices.filter(c=>c.id!==p.answerId&&!state.eliminated.includes(c.id));
    if(!candidates.length) return toast('No clue needed — one is left!');
    const stats=loadJSON(STORAGE.stats,{coins:0}); if((stats.coins||0)<20) return toast('A clue costs 20 stars. Win a few rounds first.');
    const pick=candidates[Math.floor(Math.random()*candidates.length)]; stats.coins-=20; saveJSON(STORAGE.stats,stats); updateCoinUI();
    state.history.push({type:'eliminate',id:pick.id,player:null,clue:true}); state.eliminated.push(pick.id);
    const tile=$(`.tile[data-id="${cssEscape(pick.id)}"]`); tile?.classList.add('safe-hit'); playSound('safe'); setTimeout(()=>tile?.classList.add('eliminated'),120);
    toast(`${pick.name} is safe to eliminate.`); $('#undoBtn').disabled=false;
    const remaining=p.choices.filter(c=>!state.eliminated.includes(c.id)); if(remaining.length===1){state.locked=true;setTimeout(()=>finish(true,true),650);}
  }

  function renderCategories() {
    const cats=[...new Set(state.puzzles.map(p=>p.category))].sort();
    $('#categoryButtons').innerHTML=cats.map(c=>`<button data-cat="${escapeAttr(c)}">${escapeHTML(c)}</button>`).join('');
    $$('#categoryButtons button').forEach(b=>b.addEventListener('click',()=>{state.currentFilter=b.dataset.cat;state.mode='solo';startPuzzle(randomPuzzle(state.currentFilter),{mode:'solo'});}));
  }
  function openHome(){stopTimer();$('#resultModal').classList.add('hidden');showView('homeView');}

  function showFamilySetup() {
    const saved=settings().players || ['Dad','Player 2','Player 3']; const wrap=$('#playerInputs');wrap.innerHTML='';
    for(let i=0;i<Math.max(3,saved.length);i++) addPlayerInput(saved[i]||''); $('#familyModal').classList.remove('hidden');
  }
  function addPlayerInput(name=''){
    const row=document.createElement('div');row.className='player-row';row.innerHTML=`<input value="${escapeAttr(name)}" placeholder="Player name" maxlength="20"><button type="button">×</button>`;
    row.querySelector('button').onclick=()=>{if($('#playerInputs').children.length>2)row.remove();};$('#playerInputs').appendChild(row);
  }
  function startFamily(){
    const players=$$('#playerInputs input').map(i=>i.value.trim()).filter(Boolean).slice(0,6);if(players.length<2)return toast('Add at least two players.');
    state.players=players;state.familyScores=Object.fromEntries(players.map(p=>[p,0]));state.activePlayer=0;saveSettings({players});$('#familyModal').classList.add('hidden');startPuzzle(randomPuzzle(null),{mode:'family'});
  }

  function buildChoiceEditor() {
    const wrap=$('#choiceEditor');wrap.innerHTML='';
    for(let i=0;i<9;i++){
      const row=document.createElement('div');row.className='choice-row';row.innerHTML=`
        <input class="answer-radio" type="radio" name="correctChoice" value="${i}" ${i===0?'checked':''} aria-label="Correct answer">
        <input type="text" name="choiceName${i}" placeholder="Choice ${i+1} name" required>
        <input type="text" name="choiceValue${i}" placeholder="Fact / value">
        <label class="photo-control">Add photo<input type="file" accept="image/*" data-photo-index="${i}"></label>`;
      bindPhotoInput(row.querySelector('input[type=file]'), i); wrap.appendChild(row);
    }
  }
  function bindPhotoInput(input,i){
    input.addEventListener('change',async()=>{
      const f=input.files?.[0];if(!f)return;const data=await resizeImage(f,600,.8);const lab=input.closest('.photo-control');
      lab.innerHTML=`<img src="${escapeAttr(data)}" alt=""><input type="file" accept="image/*" data-photo-index="${i}">`;
      const replacement=lab.querySelector('input');replacement.dataset.dataUrl=data;bindPhotoInput(replacement,i);
    });
  }
  async function resizeImage(file,max=600,quality=.8){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{const scale=Math.min(1,max/Math.max(img.width,img.height));const w=Math.max(1,Math.round(img.width*scale));const h=Math.max(1,Math.round(img.height*scale));const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);resolve(c.toDataURL('image/jpeg',quality));};img.onerror=reject;img.src=reader.result;};reader.onerror=reject;reader.readAsDataURL(file);});}

  function savePuzzleFromForm(e){
    e.preventDefault();const form=e.currentTarget;const fd=new FormData(form);const answerIndex=Number(fd.get('correctChoice'));const rows=$$('#choiceEditor .choice-row');const id=`custom-${Date.now()}`;
    const choices=rows.map((row,i)=>({id:`${id}-c${i}`,name:fd.get(`choiceName${i}`)?.trim(),value:fd.get(`choiceValue${i}`)?.trim()||'',image:row.querySelector('input[type=file]')?.dataset.dataUrl||'',wiki:''}));
    if(choices.length!==9||choices.some(c=>!c.name))return toast('All nine choice names are required.');
    const p=normalizePuzzle({id,category:fd.get('category')?.trim(),title:fd.get('title')?.trim(),questionTop:fd.get('questionTop')?.trim(),questionHighlight:fd.get('questionHighlight')?.trim(),questionBottom:fd.get('questionBottom')?.trim(),fact:fd.get('fact')?.trim(),choices,answerId:choices[answerIndex].id});
    const custom=loadJSON(STORAGE.custom,[]);custom.push(p);saveJSON(STORAGE.custom,custom);reloadPuzzles();form.reset();buildChoiceEditor();startPuzzle(p,{mode:'solo'});toast('Puzzle saved on this device.');
  }
  function exportPack(){const pack={version:2,exportedAt:new Date().toISOString(),puzzles:loadJSON(STORAGE.custom,[])};const blob=new Blob([JSON.stringify(pack,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='last-one-left-puzzles.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function importPack(file){try{const data=JSON.parse(await file.text());const incoming=Array.isArray(data)?data:data.puzzles;if(!Array.isArray(incoming))throw new Error();const valid=incoming.map(normalizePuzzle).filter(p=>p.choices.length===9&&p.choices.some(c=>c.id===p.answerId));const existing=loadJSON(STORAGE.custom,[]);const byId=new Map(existing.map(p=>[p.id,p]));valid.forEach(p=>byId.set(p.id,p));saveJSON(STORAGE.custom,[...byId.values()]);reloadPuzzles();toast(`Imported ${valid.length} puzzle${valid.length===1?'':'s'}.`);}catch{toast('That file is not a valid puzzle pack.');}}

  async function generateAiPuzzle(){
    const topic=$('#aiTopic').value.trim();const endpoint=$('#aiEndpoint').value.trim().replace(/\/$/,'');const difficulty=$('#aiDifficulty').value;const audience=$('#aiAudience').value;
    if(!topic)return setAiStatus('Give me a topic first.',true);
    if(!endpoint)return setAiStatus('Add your Worker URL first. The included README walks you through the one-time setup.',true);
    saveSettings({aiEndpoint:endpoint}); const btn=$('#generateAiBtn');btn.disabled=true;btn.textContent='Generating…';setAiStatus('Creating a 9-choice puzzle and fact-checking it. This can take a few seconds.');
    try{
      const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,difficulty,audience})});
      const data=await res.json().catch(()=>({})); if(!res.ok)throw new Error(data.error||`AI server returned ${res.status}`);
      const raw=data.puzzle||data; if(!raw||!Array.isArray(raw.choices)||raw.choices.length!==9)throw new Error('The AI returned an invalid puzzle. Try again.');
      const id=`ai-${Date.now()}`;
      const choices=raw.choices.map((c,i)=>({id:`${id}-c${i}`,name:String(c.name||'').trim(),value:String(c.value||'').trim(),wiki:String(c.wikiTitle||c.wiki||c.name||'').trim(),image:''}));
      let answerIndex=Number.isInteger(raw.answerIndex)?raw.answerIndex:choices.findIndex(c=>c.name===raw.answer);
      if(answerIndex<0||answerIndex>8||choices.some(c=>!c.name))throw new Error('The AI response did not contain one valid answer. Try again.');
      const p=normalizePuzzle({id,category:raw.category||'AI',title:raw.title||topic,questionTop:raw.questionTop||'WHICH HAS THE',questionHighlight:raw.questionHighlight||'BEST ANSWER',questionBottom:raw.questionBottom||'ON THIS LIST?',fact:raw.fact||'',choices,answerId:choices[answerIndex].id,aiGenerated:true});
      const custom=loadJSON(STORAGE.custom,[]);custom.push(p);saveJSON(STORAGE.custom,custom);reloadPuzzles();setAiStatus('Done — starting the puzzle now.');setTimeout(()=>startPuzzle(p,{mode:'solo'}),350);
    }catch(err){setAiStatus(err.message||'Could not generate the puzzle.',true);}finally{btn.disabled=false;btn.textContent='Generate & play';}
  }
  function setAiStatus(msg,error=false){const el=$('#aiStatus');el.textContent=msg;el.classList.remove('hidden','error');if(error)el.classList.add('error');}

  function updateCoinUI(){const s=loadJSON(STORAGE.stats,{coins:0});$('#coinCount').textContent=s.coins||0;}
  function showStats(){const s=loadJSON(STORAGE.stats,{coins:0,wins:0,played:0,streak:0,bestStreak:0});toast(`${s.wins||0}/${s.played||0} wins · streak ${s.streak||0} · best ${s.bestStreak||0}`);}

  function updateSoundUI(){const on=settings().sound!==false;$('#soundBtn').textContent=on?'🔊':'🔇';$('#soundBtn').setAttribute('aria-label',on?'Turn sound off':'Turn sound on');}
  function toggleSound(){saveSettings({sound:settings().sound===false});if(settings().sound!==false){unlockAudio();playSound('safe');}}
  function unlockAudio(){if(settings().sound===false)return;try{audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}catch{}}
  function tone(freq,duration=.08,type='sine',gain=.04,delay=0){if(settings().sound===false||!audioCtx)return;const start=audioCtx.currentTime+delay;const osc=audioCtx.createOscillator();const g=audioCtx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,start);g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(gain,start+.01);g.gain.exponentialRampToValueAtTime(.0001,start+duration);osc.connect(g);g.connect(audioCtx.destination);osc.start(start);osc.stop(start+duration+.02);}
  function playSound(kind){if(settings().sound===false)return;unlockAudio();if(!audioCtx)return;
    if(kind==='safe'){tone(600,.07,'sine',.035);tone(820,.08,'sine',.03,.055);} 
    if(kind==='wrong'){tone(180,.14,'sawtooth',.035);tone(120,.18,'sawtooth',.028,.09);} 
    if(kind==='win'){[523,659,784,1047].forEach((f,i)=>tone(f,.22,'sine',.04,i*.09));}
    if(kind==='lose'){[330,247,196].forEach((f,i)=>tone(f,.24,'triangle',.035,i*.12));}
  }
  function vibrate(pattern){try{navigator.vibrate?.(pattern);}catch{}}
  function flashScreen(kind){const el=$('#screenFlash');el.className=`screen-flash ${kind}`;void el.offsetWidth;setTimeout(()=>el.className='screen-flash',520);}
  function confetti(){const layer=$('#confettiLayer');layer.innerHTML='';for(let i=0;i<48;i++){const p=document.createElement('i');p.className='confetti-piece';p.style.left=`${Math.random()*100}%`;p.style.setProperty('--x',`${(Math.random()-.5)*220}px`);p.style.setProperty('--r',`${Math.random()*180}deg`);p.style.setProperty('--rr',`${500+Math.random()*700}deg`);p.style.animationDelay=`${Math.random()*.25}s`;layer.appendChild(p);}setTimeout(()=>layer.innerHTML='',2100);}

  let toastTimer;function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),2400);}
  function escapeHTML(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function escapeAttr(s=''){return escapeHTML(s);} function cssEscape(s=''){return window.CSS?.escape?CSS.escape(String(s)):String(s).replace(/([ #;?%&,.+*~\\':"!^$[\]()=>|/@])/g,'\\$1');}

  $('#homeBtn').addEventListener('click',openHome);$('#statsBtn').addEventListener('click',showStats);$('#soundBtn').addEventListener('click',toggleSound);
  $('#shuffleBtn').addEventListener('click',()=>startPuzzle(randomPuzzle(),{mode:state.mode}));$('#undoBtn').addEventListener('click',undo);$('#clueBtn').addEventListener('click',clue);
  $('#homeFromResult').addEventListener('click',openHome);$('#nextFromResult').addEventListener('click',()=>{$('#resultModal').classList.add('hidden');startPuzzle(randomPuzzle(),{mode:state.mode});});
  $('#editorBack').addEventListener('click',openHome);$('#aiBack').addEventListener('click',openHome);$('#exportBtn').addEventListener('click',exportPack);$('#puzzleForm').addEventListener('submit',savePuzzleFromForm);
  $('#importInput').addEventListener('change',e=>e.target.files?.[0]&&importPack(e.target.files[0]));$('#generateAiBtn').addEventListener('click',generateAiPuzzle);
  $('#resetCustomBtn').addEventListener('click',()=>{if(confirm('Delete all custom and AI-generated puzzles stored on this device?')){localStorage.removeItem(STORAGE.custom);reloadPuzzles();toast('Custom puzzles deleted.');}});
  $('#startFamilyBtn').addEventListener('click',startFamily);$('#cancelFamilyBtn').addEventListener('click',()=>$('#familyModal').classList.add('hidden'));$('#playerInputs').addEventListener('dblclick',()=>{if($('#playerInputs').children.length<6)addPlayerInput('');});
  $$('[data-home-action]').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.homeAction;if(a==='daily'){state.currentFilter=null;startPuzzle(dailyPuzzle(),{mode:'solo'});}if(a==='random'){state.currentFilter=null;startPuzzle(randomPuzzle(null),{mode:'solo'});}if(a==='family')showFamilySetup();if(a==='editor'){buildChoiceEditor();showView('editorView');}if(a==='ai'){$('#aiEndpoint').value=settings().aiEndpoint||'';$('#aiStatus').classList.add('hidden');showView('aiView');}}));

  reloadPuzzles();updateCoinUI();updateSoundUI();buildChoiceEditor();openHome();
  if('serviceWorker' in navigator&&location.protocol.startsWith('http'))window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
})();
