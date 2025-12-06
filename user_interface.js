/*
 * USER INTERFACE MODULE
 * Handles: Visuals, DOM Manipulation, Input Sync
 */

// --- GLOBAL UTILS (DOM HELPERS) ---
window.toggleMenu = function() {
    const m = document.getElementById('main-menu');
    if(m) { m.classList.toggle('hidden'); m.classList.toggle('flex'); }
};

window.toggleExportModal = function() {
    const m = document.getElementById('export-modal');
    if(m) { m.classList.toggle('hidden'); m.classList.toggle('flex'); }
};

window.removeBassSynth = function(id) {
    if(bassSynths.length <= 1) {
        window.logToScreen("Cannot remove last synth", 'warn');
        return;
    }
    const idx = bassSynths.findIndex(s => s.id === id);
    if(idx > -1) {
        bassSynths.splice(idx, 1);
        if(window.timeMatrix) window.timeMatrix.removeTrack(id);
        renderSynthMenu();
        renderInstrumentTabs();
        if(AppState.activeView === id) setTab(bassSynths[0].id);
        window.logToScreen(`Removed ${id}`);
    }
};

function safeClick(id, fn) {
    const el = document.getElementById(id);
    if(el) el.onclick = fn;
}

// --- VISUAL LOOP ---
let lastDrawnStep = -1;
let drawFrameId = null;

function drawLoop() {
    const t = audioCtx.currentTime;
    
    // Procesar cola visual generada por audio_engine.js
    while(window.visualQueue && window.visualQueue.length && window.visualQueue[0].time <= t) {
        const ev = window.visualQueue.shift();
        
        if(lastDrawnStep !== ev.step) {
            updatePlayClock(ev.step);
            
            // Seguimiento de bloques
            if(AppState.followPlayback && ev.block !== AppState.editingBlock) {
                AppState.editingBlock = ev.block;
                updateEditors();
                renderTrackBar();
            }
            
            // Highlight Grid
            if(ev.block === AppState.editingBlock) {
                window.timeMatrix.highlightPlayingStep(ev.step);
                if(ev.step % 4 === 0) blinkLed();
            } else {
                window.timeMatrix.highlightPlayingStep(-1);
            }
            
            if(ev.step === 0) renderTrackBar();
            lastDrawnStep = ev.step;
        }
    }
    
    if(AppState.isPlaying) {
        drawFrameId = requestAnimationFrame(drawLoop);
    }
}

function blinkLed() {
    const led = document.getElementById('activity-led');
    if(led) {
        led.style.backgroundColor = '#fff';
        led.style.boxShadow = '0 0 8px #fff';
        setTimeout(() => { led.style.backgroundColor = ''; led.style.boxShadow = ''; }, 50);
    }
}

function initPlayClock() {
    const svg = document.getElementById('play-clock-svg');
    if(!svg) return;
    const steps = window.timeMatrix.totalSteps || 16;
    const r=45, c=50, circ=2*Math.PI*r, gap=2, dash=(circ/steps)-gap;
    svg.innerHTML = ''; 
    for(let i=0; i<steps; i++) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        el.setAttribute("r", r); el.setAttribute("cx", c); el.setAttribute("cy", c);
        el.setAttribute("fill", "transparent"); el.setAttribute("stroke-width", "4");
        el.setAttribute("stroke-dasharray", `${dash} ${circ - dash}`);
        el.setAttribute("transform", `rotate(${(360/steps)*i}, ${c}, ${c})`);
        el.setAttribute("id", `clock-seg-${i}`);
        el.setAttribute("stroke", "#333"); 
        svg.appendChild(el);
    }
}

function updatePlayClock(step) {
    const total = window.timeMatrix.totalSteps;
    for(let i=0; i<total; i++) {
        const seg = document.getElementById(`clock-seg-${i}`);
        if(!seg) continue;
        if (i === step) { seg.setAttribute("stroke", "#00ff41"); seg.setAttribute("opacity", "1"); } 
        else if (i < step) { seg.setAttribute("stroke", "#004411"); seg.setAttribute("opacity", "0.5"); } 
        else { seg.setAttribute("stroke", "#222"); seg.setAttribute("opacity", "0.3"); }
    }
}

// --- RENDERERS ---
function renderInstrumentTabs() {
    const c = document.getElementById('instrument-tabs-container');
    if(!c) return;
    c.innerHTML = '';
    bassSynths.forEach(s => {
        const b = document.createElement('button');
        const active = AppState.activeView === s.id;
        b.className = `px-3 py-1 text-[10px] font-bold border uppercase transition-all ${active ? 'text-green-400 bg-gray-900 border-green-500 shadow-md' : 'text-gray-500 border-transparent hover:text-gray-300'}`;
        b.innerText = s.id;
        b.onclick = () => setTab(s.id);
        c.appendChild(b);
    });
    const d = document.createElement('button');
    const dActive = AppState.activeView === 'drum';
    d.className = `px-3 py-1 text-[10px] font-bold border uppercase transition-all ${dActive ? 'text-green-400 bg-gray-900 border-green-500 shadow-md' : 'text-gray-500 border-transparent hover:text-gray-300'}`;
    d.innerText = "DRUMS";
    d.onclick = () => setTab('drum');
    c.appendChild(d);
}

function setTab(v) {
    AppState.activeView = v;
    renderInstrumentTabs();
    updateEditors();
    syncControlsFromSynth(v);
}

function renderTrackBar() { const c = document.getElementById('track-bar'); if(!c) return; c.innerHTML = ''; const blocks = window.timeMatrix.blocks; document.getElementById('display-total-blocks').innerText = blocks.length; document.getElementById('display-current-block').innerText = AppState.editingBlock + 1; blocks.forEach((_, i) => { const el = document.createElement('div'); el.className = `track-block ${i===AppState.editingBlock ? 'track-block-editing' : ''} ${AppState.isPlaying && i===AppState.currentPlayBlock ? 'track-block-playing' : ''}`; el.innerText = i + 1; el.onclick = () => { AppState.editingBlock = i; updateEditors(); renderTrackBar(); }; c.appendChild(el); }); }
function updateEditors() { const bEd = document.getElementById('editor-bass'); const dEd = document.getElementById('editor-drum'); const info = document.getElementById('step-info-display'); if(info) info.innerText = `STEP ${AppState.selectedStep+1} // ${AppState.activeView.toUpperCase()}`; if(AppState.activeView === 'drum') { bEd.classList.add('hidden'); dEd.classList.remove('hidden'); renderDrumRows(); } else { bEd.classList.remove('hidden'); dEd.classList.add('hidden'); } const slideBtn = document.getElementById('btn-toggle-slide'); const accBtn = document.getElementById('btn-toggle-accent'); if(slideBtn) slideBtn.classList.remove('text-green-400', 'border-green-600'); if(accBtn) accBtn.classList.remove('text-green-400', 'border-green-600'); if(AppState.activeView !== 'drum') { const blk = window.timeMatrix.blocks[AppState.editingBlock]; const noteData = blk.tracks[AppState.activeView] ? blk.tracks[AppState.activeView][AppState.selectedStep] : null; if(noteData) { if(noteData.slide && slideBtn) slideBtn.classList.add('text-green-400', 'border-green-600'); if(noteData.accent && accBtn) accBtn.classList.add('text-green-400', 'border-green-600'); } } window.timeMatrix.selectedStep = AppState.selectedStep; window.timeMatrix.render(AppState.activeView, AppState.editingBlock); }
function renderDrumRows() { const c = document.getElementById('editor-drum'); if(!c) return; c.innerHTML = ''; const blk = window.timeMatrix.blocks[AppState.editingBlock]; const cur = blk.drums[AppState.selectedStep]; const kits = (window.drumSynth && window.drumSynth.kits) ? window.drumSynth.kits : []; kits.forEach(k => { const act = cur.includes(k.id); const b = document.createElement('button'); b.className = `w-full py-2 px-3 mb-1 border flex justify-between items-center text-[10px] ${act ? 'bg-gray-900 border-green-700 text-green-400' : 'bg-transparent border-gray-800 text-gray-500'}`; b.innerHTML = `<span>${k.name}</span><div class="w-2 h-2 rounded-full" style="background:${k.color}"></div>`; b.onclick = () => { initEngine(); if(act) cur.splice(cur.indexOf(k.id), 1); else { cur.push(k.id); window.drumSynth.play(k.id, audioCtx.currentTime); } updateEditors(); }; c.appendChild(b); }); }
function renderSynthMenu() { const c = document.getElementById('synth-list-container'); if(!c) return; c.innerHTML = ''; bassSynths.forEach(s => { const r = document.createElement('div'); r.className = 'flex justify-between bg-black p-2 border border-gray-800 text-xs'; r.innerHTML = `<span class="text-green-500">${s.id}</span><button class="text-red-500" onclick="removeBassSynth('${s.id}')">X</button>`; c.appendChild(r); }); }

function togglePanelState() { AppState.panelCollapsed = !AppState.panelCollapsed; const p = document.getElementById('editor-panel'); const btn = document.getElementById('btn-minimize-panel'); if(AppState.panelCollapsed) { p.classList.remove('panel-expanded'); p.classList.add('panel-collapsed'); btn.innerHTML = "&#9650;"; } else { p.classList.remove('panel-collapsed'); p.classList.add('panel-expanded'); btn.innerHTML = "&#9660;"; } }
function toggleVisualizerMode() { AppState.followPlayback = !AppState.followPlayback; const btn = document.getElementById('btn-toggle-visualizer'); if(AppState.followPlayback) { btn.innerText = "VISUALIZER: ON"; btn.classList.remove('border-gray-700', 'text-gray-400'); btn.classList.add('border-green-500', 'text-green-400', 'bg-green-900/20'); } else { btn.innerText = "VISUALIZER: OFF"; btn.classList.remove('border-green-500', 'text-green-400', 'bg-green-900/20'); btn.classList.add('border-gray-700', 'text-gray-400'); } }

function toggleUIMode() { 
    AppState.uiMode = AppState.uiMode === 'analog' ? 'digital' : 'analog'; 
    const btn = document.getElementById('btn-toggle-ui-mode'); 
    const analogP = document.getElementById('fx-controls-analog'); 
    const digitalP = document.getElementById('fx-controls-digital'); 
    
    if(AppState.uiMode === 'digital') { 
        btn.innerText = "UI MODE: DIGITAL"; 
        btn.classList.add('border-green-500', 'text-green-300'); 
        analogP.classList.add('hidden'); 
        digitalP.classList.remove('hidden'); 
    } else { 
        btn.innerText = "UI MODE: ANALOG"; 
        btn.classList.remove('border-green-500', 'text-green-300'); 
        analogP.classList.remove('hidden'); 
        digitalP.classList.add('hidden'); 
    } 
    syncControlsFromSynth(AppState.activeView); 
}

// --- SYNC CONTROLS ---
function updateSynthParam(param, value) {
    const s = window.bassSynths.find(sy => sy.id === AppState.activeView);
    if(!s) return;

    let finalValue = value;
    // Map Slider (Hz) to 0-100 for Cutoff
    if (param === 'cutoff') {
        const minHz = 100;
        const maxHz = 5000;
        const clamped = Math.max(minHz, Math.min(maxHz, value));
        finalValue = ((clamped - minHz) / (maxHz - minHz)) * 100;
    }
    
    if(param === 'distortion') s.setDistortion(finalValue);
    if(param === 'cutoff') s.setCutoff(finalValue);
    if(param === 'resonance') s.setResonance(finalValue);
    if(param === 'envMod') s.setEnvMod(finalValue);
    if(param === 'decay') s.setDecay(finalValue);

    syncControlsFromSynth(AppState.activeView);
}

function syncControlsFromSynth(viewId) {
    const s = window.bassSynths.find(sy => sy.id === viewId);
    if(!s) return;

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if(el) el.value = Math.round(val);
    };

    const p = s.params;

    // Analog
    setVal('dist-slider', p.distortion);
    setVal('res-slider', p.resonance);
    setVal('env-slider', p.envMod);
    setVal('dec-slider', p.decay);
    const cutoffHz = ((p.cutoff / 100) * 4900) + 100;
    setVal('cutoff-slider', cutoffHz);

    // Digital
    setVal('dist-digital', p.distortion);
    setVal('cutoff-digital', p.cutoff);
    setVal('res-digital', p.resonance * 5); 
    setVal('env-digital', p.envMod);
    setVal('dec-digital', p.decay);

    const wvBtn = document.getElementById('btn-waveform');
    if(wvBtn) {
        if(p.waveform === 'square') wvBtn.innerHTML = '<span class="text-xl font-bold leading-none mb-0.5">Π</span><span>SQR</span>';
        else wvBtn.innerHTML = '<span class="text-xl font-bold leading-none mb-0.5">~</span><span>SAW</span>';
    }
}

function setupDigitalRepeaters() {
    const buttons = document.querySelectorAll('.dfx-btn');
    if(!buttons.length) return;
    buttons.forEach(btn => {
        let intervalId = null;
        let timeoutId = null;
        const target = btn.dataset.target; 
        const dir = parseInt(btn.dataset.dir); 

        const changeVal = () => {
            const s = bassSynths.find(sy => sy.id === AppState.activeView);
            if(!s) return;
            
            let current = 0;
            if(target === 'distortion') current = s.params.distortion;
            else if(target === 'envMod') current = s.params.envMod;
            else if(target === 'decay') current = s.params.decay;
            else if(target === 'resonance') current = s.params.resonance * 5; 
            else if(target === 'cutoff') current = s.params.cutoff; 

            let next = Math.max(0, Math.min(100, current + dir));
            
            if(target === 'distortion') s.setDistortion(next);
            else if(target === 'envMod') s.setEnvMod(next);
            else if(target === 'decay') s.setDecay(next);
            else if(target === 'resonance') s.setResonance(next / 5);
            else if(target === 'cutoff') s.setCutoff(next);
            
            syncControlsFromSynth(AppState.activeView);
        };

        const startRepeat = () => {
            changeVal(); 
            timeoutId = setTimeout(() => {
                intervalId = setInterval(changeVal, 100); 
            }, 400); 
        };

        const stopRepeat = () => {
            clearTimeout(timeoutId);
            clearInterval(intervalId);
        };

        btn.addEventListener('mousedown', startRepeat);
        btn.addEventListener('mouseup', stopRepeat);
        btn.addEventListener('mouseleave', stopRepeat);
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); startRepeat(); });
        btn.addEventListener('touchend', stopRepeat);
    });
}

function toggleWaveform() {
    const s = bassSynths.find(sy => sy.id === AppState.activeView);
    if(s) {
        const next = s.params.waveform === 'sawtooth' ? 'square' : 'sawtooth';
        s.setWaveform(next);
        syncControlsFromSynth(AppState.activeView);
    }
}