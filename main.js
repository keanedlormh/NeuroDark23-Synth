/*
 * NEURODARK 23 - UNIFIED CORE v40 (Restored & Optimized)
 * Architecture: Monolithic logic for maximum stability.
 */

// --- GLOBAL STATE ---
const AppState = {
    isPlaying: false,
    bpm: 174,
    currentPlayStep: 0,
    currentPlayBlock: 0,
    editingBlock: 0,
    selectedStep: 0,
    activeView: 'bass-1',
    currentOctave: 3,
    uiMode: 'analog',
    exportReps: 1,
    panelCollapsed: false,
    followPlayback: false
};

// --- AUDIO GLOBALS ---
let audioCtx = null;
let masterGain = null;
let clockWorker = null;
let bassSynths = [];
let drumSynth = null;

let nextNoteTime = 0.0;
const LOOKAHEAD = 0.15;
const INTERVAL = 25;
let visualQueue = [];
let drawFrameId = null;
let lastDrawnStep = -1;

// --- UTILS (DOM) ---
function safeClick(id, fn) {
    const el = document.getElementById(id);
    if(el) el.onclick = (e) => {
        // Unlock audio on any interaction
        initAudioEngine();
        fn(e);
    };
}

function log(msg, type='info') {
    if(window.logToScreen) window.logToScreen(msg, type);
    else console.log(msg);
}

// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
    log("System Boot...");
    
    // 1. Validar Clases
    if(!window.TimeMatrix || typeof window.BassSynth === 'undefined') {
        log("CRITICAL: Missing Scripts", 'error');
        return;
    }

    // 2. Data Init
    window.timeMatrix = new window.TimeMatrix();
    
    // 3. Audio Data Init
    bassSynths.push(new window.BassSynth('bass-1'));
    if(window.timeMatrix.registerTrack) window.timeMatrix.registerTrack('bass-1');

    // 4. UI Init
    renderAll();
    setupEventListeners();
    
    // 5. Global Unlocks
    const unlock = () => {
        initAudioEngine();
        if(audioCtx && audioCtx.state === 'running') {
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
        }
    };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);

    log("Ready.");
});

// --- AUDIO ENGINE ---
function initAudioEngine() {
    if(audioCtx && audioCtx.state === 'running') return;

    try {
        if(!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AC({ latencyHint: 'interactive' });
            
            // Master Chain
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -2;
            comp.ratio.value = 10;
            
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.7;
            
            masterGain.connect(comp);
            comp.connect(audioCtx.destination);

            // Re-init Synths
            bassSynths.forEach(s => s.init(audioCtx, masterGain));
            
            // Drums
            if(window.DrumSynth) {
                drumSynth = new window.DrumSynth();
                drumSynth.init(audioCtx, masterGain);
            }

            // Clock
            initWorker();
        }
        if(audioCtx.state === 'suspended') audioCtx.resume();
    } catch(e) {
        log("Audio Init Err: " + e, 'error');
    }
}

function initWorker() {
    if(clockWorker) return;
    try {
        clockWorker = new Worker('Synth/clock_worker.js');
        clockWorker.onmessage = (e) => { if(e.data === "tick") scheduler(); };
        clockWorker.postMessage({interval: INTERVAL});
    } catch(e) { console.error("Worker Err", e); }
}

function scheduler() {
    while(nextNoteTime < audioCtx.currentTime + LOOKAHEAD) {
        scheduleNote(AppState.currentPlayStep, AppState.currentPlayBlock, nextNoteTime);
        advanceNote();
    }
}

function advanceNote() {
    const secPerBeat = 60.0 / AppState.bpm;
    const secPerStep = secPerBeat / 4;
    nextNoteTime += secPerStep;
    
    AppState.currentPlayStep++;
    if(AppState.currentPlayStep >= window.timeMatrix.totalSteps) {
        AppState.currentPlayStep = 0;
        AppState.currentPlayBlock++;
        if(AppState.currentPlayBlock >= window.timeMatrix.blocks.length) AppState.currentPlayBlock = 0;
    }
}

function scheduleNote(step, block, time) {
    visualQueue.push({ step, block, time });
    
    const data = window.timeMatrix.getStepData(step, block);
    if(!data) return;

    // Drums
    if(data.drums && drumSynth) {
        data.drums.forEach(id => drumSynth.play(id, time));
    }

    // Bass
    if(data.tracks) {
        Object.keys(data.tracks).forEach(tid => {
            const note = data.tracks[tid][step];
            if(note) {
                const s = bassSynths.find(sy => sy.id === tid);
                if(s) s.play(note.note, note.octave, time, 0.25, note.slide, note.accent);
            }
        });
    }
}

// --- VISUAL LOOP ---
function drawLoop() {
    if(!audioCtx) return;
    const t = audioCtx.currentTime;
    
    while(visualQueue.length && visualQueue[0].time <= t) {
        const ev = visualQueue.shift();
        
        if(lastDrawnStep !== ev.step) {
            updateClockUI(ev.step);
            
            // Follow Mode
            if(AppState.followPlayback && ev.block !== AppState.editingBlock) {
                AppState.editingBlock = ev.block;
                renderTrackBar();
                updateEditor();
            }
            
            // Grid Highlight
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
    const l = document.getElementById('activity-led');
    if(l) { l.style.backgroundColor='#fff'; setTimeout(()=>l.style.backgroundColor='', 50); }
}

// --- UI FUNCTIONS ---
function renderAll() {
    renderTabs();
    renderTrackBar();
    updateEditor();
    initClockSVG();
}

function renderTabs() {
    const c = document.getElementById('instrument-tabs-container');
    c.innerHTML = '';
    bassSynths.forEach(s => {
        const b = document.createElement('button');
        const act = AppState.activeView === s.id;
        b.className = `px-3 py-1 text-[10px] font-bold border uppercase transition-all ${act ? 'text-green-400 bg-gray-900 border-green-500 shadow-md' : 'text-gray-500 border-transparent hover:text-gray-300'}`;
        b.innerText = s.id;
        b.onclick = () => { AppState.activeView = s.id; renderAll(); };
        c.appendChild(b);
    });
    const d = document.createElement('button');
    d.className = `px-3 py-1 text-[10px] font-bold border uppercase transition-all ${AppState.activeView === 'drum' ? 'text-green-400 bg-gray-900 border-green-500 shadow-md' : 'text-gray-500 border-transparent hover:text-gray-300'}`;
    d.innerText = "DRUMS";
    d.onclick = () => { AppState.activeView = 'drum'; renderAll(); };
    c.appendChild(d);
}

function updateEditor() {
    const id = AppState.activeView;
    const bEd = document.getElementById('editor-bass');
    const dEd = document.getElementById('editor-drum');
    document.getElementById('step-info-display').innerText = `STEP ${AppState.selectedStep+1} // ${id.toUpperCase()}`;

    if(id === 'drum') {
        bEd.classList.add('hidden');
        dEd.classList.remove('hidden');
        renderDrumEditor();
    } else {
        bEd.classList.remove('hidden');
        dEd.classList.add('hidden');
        const s = bassSynths.find(sy => sy.id === id);
        if(s) syncControls(s);
        updateModifiers();
    }

    if(window.timeMatrix) {
        window.timeMatrix.selectedStep = AppState.selectedStep;
        window.timeMatrix.render(id, AppState.editingBlock);
    }
}

function syncControls(s) {
    const p = s.params;
    const set = (id, v) => { const el = document.getElementById(id); if(el) el.value = Math.round(v); };
    
    // Analog
    set('dist-slider', p.distortion);
    set('res-slider', p.resonance);
    set('env-slider', p.envMod);
    set('dec-slider', p.decay);
    set('cutoff-slider', ((p.cutoff/100)*4900)+100);

    // Digital
    set('dist-digital', p.distortion);
    set('cutoff-digital', p.cutoff);
    set('res-digital', p.resonance * 5); // 0-20 -> 0-100%
    set('env-digital', p.envMod);
    set('dec-digital', p.decay);

    const w = document.getElementById('btn-waveform');
    if(w) w.innerHTML = p.waveform==='square' ? '<span>Π SQR</span>' : '<span>~ SAW</span>';
}

function updateModifiers() {
    const blk = window.timeMatrix.blocks[AppState.editingBlock];
    const track = blk.tracks[AppState.activeView];
    const note = track ? track[AppState.selectedStep] : null;
    
    const sBtn = document.getElementById('btn-toggle-slide');
    const aBtn = document.getElementById('btn-toggle-accent');
    
    sBtn.className = `px-2 py-1 border border-gray-700 bg-gray-900/50 text-gray-500 text-[10px] tracking-widest hover:text-green-400 hover:border-green-600 transition-all font-bold rounded ${note && note.slide ? '!text-green-400 !border-green-600 !bg-green-900/30' : ''}`;
    aBtn.className = `px-2 py-1 border border-gray-700 bg-gray-900/50 text-gray-500 text-[10px] tracking-widest hover:text-green-400 hover:border-green-600 transition-all font-bold rounded ${note && note.accent ? '!text-green-400 !border-green-600 !bg-green-900/30' : ''}`;
}

// --- EVENT SETUP ---
function setupEventListeners() {
    // 1. TRANSPORT
    safeClick('btn-play', () => toggleTransport());
    safeClick('app-logo', () => toggleTransport());

    // 2. PIANO
    document.querySelectorAll('.piano-key').forEach(k => {
        const handler = (e) => {
            e.preventDefault();
            const id = AppState.activeView;
            if(id === 'drum') return;
            
            const blk = window.timeMatrix.blocks[AppState.editingBlock];
            if(!blk.tracks[id]) window.timeMatrix.registerTrack(id);
            
            const cur = blk.tracks[id][AppState.selectedStep];
            blk.tracks[id][AppState.selectedStep] = {
                note: k.dataset.note,
                octave: AppState.currentOctave,
                slide: cur ? cur.slide : false,
                accent: cur ? cur.accent : false
            };
            
            const s = bassSynths.find(sy => sy.id === id);
            if(s) s.play(k.dataset.note, AppState.currentOctave, audioCtx.currentTime);
            
            updateEditor();
        };
        k.addEventListener('mousedown', handler);
        k.addEventListener('touchstart', handler);
    });

    // 3. EDIT
    safeClick('btn-toggle-slide', () => toggleMod('slide'));
    safeClick('btn-toggle-accent', () => toggleMod('accent'));
    safeClick('btn-delete-note', () => {
        const id = AppState.activeView;
        if(id !== 'drum') {
            window.timeMatrix.blocks[AppState.editingBlock].tracks[id][AppState.selectedStep] = null;
            updateEditor();
        }
    });

    // 4. OCTAVE & BPM
    safeClick('oct-up', () => { if(AppState.currentOctave < 6) AppState.currentOctave++; document.getElementById('oct-display').innerText=AppState.currentOctave; });
    safeClick('oct-down', () => { if(AppState.currentOctave > 1) AppState.currentOctave--; document.getElementById('oct-display').innerText=AppState.currentOctave; });
    
    const bpm = document.getElementById('bpm-input');
    if(bpm) bpm.onchange = (e) => AppState.bpm = Math.max(60, Math.min(300, parseInt(e.target.value)));

    // 5. WAVEFORM
    safeClick('btn-waveform', () => {
        const s = bassSynths.find(sy => sy.id === AppState.activeView);
        if(s) {
            s.setWaveform(s.params.waveform === 'sawtooth' ? 'square' : 'sawtooth');
            syncControls(s);
        }
    });

    // 6. MENU & PANELS
    safeClick('btn-open-menu', () => { renderSynthMenu(); document.getElementById('main-menu').classList.remove('hidden'); document.getElementById('main-menu').classList.add('flex'); });
    safeClick('btn-menu-close', () => { document.getElementById('main-menu').classList.add('hidden'); document.getElementById('main-menu').classList.remove('flex'); });
    
    safeClick('btn-toggle-ui-mode', () => {
        AppState.uiMode = AppState.uiMode === 'analog' ? 'digital' : 'analog';
        const isDig = AppState.uiMode === 'digital';
        document.getElementById('fx-controls-analog').classList.toggle('hidden', isDig);
        document.getElementById('fx-controls-digital').classList.toggle('hidden', !isDig);
        document.getElementById('btn-toggle-ui-mode').innerText = isDig ? "UI MODE: DIGITAL" : "UI MODE: ANALOG";
    });

    safeClick('btn-minimize-panel', () => {
        const p = document.getElementById('editor-panel');
        const b = document.getElementById('btn-minimize-panel');
        if(p.classList.contains('panel-collapsed')) {
            p.classList.remove('panel-collapsed'); p.classList.add('panel-expanded');
            b.innerHTML = "&#9660;";
        } else {
            p.classList.remove('panel-expanded'); p.classList.add('panel-collapsed');
            b.innerHTML = "&#9650;";
        }
    });

    // 7. EXPORT
    safeClick('btn-open-export', () => { document.getElementById('export-modal').classList.toggle('hidden'); document.getElementById('export-modal').classList.toggle('flex'); });
    safeClick('btn-close-export', () => { document.getElementById('export-modal').classList.add('hidden'); document.getElementById('export-modal').classList.remove('flex'); });
    safeClick('btn-start-render', renderAudio);
    
    document.querySelectorAll('.export-rep-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.export-rep-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.exportReps = parseInt(btn.dataset.rep);
        };
    });

    // 8. ADD SYNTH
    safeClick('btn-add-synth', () => {
        const id = `bass-${bassSynths.length + 1}`;
        const s = new window.BassSynth(id);
        if(audioCtx) s.init(audioCtx, masterGain);
        bassSynths.push(s);
        window.timeMatrix.registerTrack(id);
        AppState.activeView = id;
        renderAll();
    });

    // 9. BIND SLIDERS
    bindSliders();
    setupDigitalRepeaters();

    // 10. Matrix Events
    window.addEventListener('stepSelect', (e) => {
        AppState.selectedStep = e.detail.index;
        updateEditor();
    });
}

// --- HELPER FUNCTIONS ---
function toggleTransport() {
    initAudioEngine();
    AppState.isPlaying = !AppState.isPlaying;
    const btn = document.getElementById('btn-play');
    
    if(AppState.isPlaying) {
        btn.innerHTML = "&#10074;&#10074;";
        btn.classList.add('border-green-500', 'text-green-500');
        
        AppState.currentPlayStep = 0;
        AppState.currentPlayBlock = AppState.editingBlock;
        nextNoteTime = audioCtx.currentTime + 0.05;
        visualQueue = [];
        lastDrawnStep = -1;
        
        if(clockWorker) clockWorker.postMessage("start");
        drawLoop();
    } else {
        btn.innerHTML = "&#9658;";
        btn.classList.remove('border-green-500', 'text-green-500');
        
        if(clockWorker) clockWorker.postMessage("stop");
        if(drawFrameId) cancelAnimationFrame(drawFrameId);
        window.timeMatrix.highlightPlayingStep(-1);
        updateClockUI(-1);
    }
}

function toggleMod(prop) {
    const blk = window.timeMatrix.blocks[AppState.editingBlock];
    const track = blk.tracks[AppState.activeView];
    if(!track) return;
    const note = track[AppState.selectedStep];
    if(note) {
        note[prop] = !note[prop];
        updateEditor();
    }
}

function renderDrumEditor() {
    const c = document.getElementById('editor-drum');
    c.innerHTML = '';
    const blk = window.timeMatrix.blocks[AppState.editingBlock];
    const drums = blk.drums[AppState.selectedStep] || [];
    
    // Drum kits access fallback
    const kits = drumSynth ? drumSynth.kits : (window.DrumSynth.prototype.kits || []);
    
    kits.forEach(k => {
         const act = drums.includes(k.id);
         const b = document.createElement('button');
         b.className = `w-full py-2 px-3 mb-1 border flex justify-between items-center text-[10px] ${act ? 'bg-gray-900 border-green-700 text-green-400' : 'bg-transparent border-gray-800 text-gray-500'}`;
         b.innerHTML = `<span>${k.name}</span><div class="w-2 h-2 rounded-full" style="background:${k.color}"></div>`;
         b.onclick = () => {
             initAudioEngine();
             if(act) drums.splice(drums.indexOf(k.id), 1);
             else {
                 drums.push(k.id);
                 if(drumSynth) drumSynth.play(k.id, audioCtx.currentTime);
             }
             updateEditor();
         };
         c.appendChild(b);
    });
}

function renderTrackBar() { 
    const c = document.getElementById('track-bar'); 
    c.innerHTML = ''; 
    window.timeMatrix.blocks.forEach((_, i) => { 
        const d = document.createElement('div'); 
        d.className = `track-block ${i === AppState.editingBlock ? 'track-block-editing' : ''} ${AppState.isPlaying && i === AppState.currentPlayBlock ? 'track-block-playing' : ''}`; 
        d.innerText = i + 1; 
        d.onclick = () => { AppState.editingBlock = i; updateEditor(); renderTrackBar(); }; 
        c.appendChild(d); 
    }); 
    document.getElementById('display-current-block').innerText = AppState.editingBlock + 1;
    document.getElementById('display-total-blocks').innerText = window.timeMatrix.blocks.length;
}

function renderSynthMenu() {
    const c = document.getElementById('synth-list-container');
    c.innerHTML = '';
    bassSynths.forEach(s => {
        const r = document.createElement('div');
        r.className = 'flex justify-between bg-black p-2 border border-gray-800 text-xs';
        r.innerHTML = `<span class="text-green-500">${s.id}</span>`;
        const btn = document.createElement('button');
        btn.className = "text-red-500";
        btn.innerText = "X";
        btn.onclick = () => {
            if(bassSynths.length > 1) {
                const idx = bassSynths.findIndex(x => x.id === s.id);
                bassSynths.splice(idx, 1);
                window.timeMatrix.removeTrack(s.id);
                if(AppState.activeView === s.id) AppState.activeView = 'bass-1';
                renderAll();
            }
        };
        r.appendChild(btn);
        c.appendChild(r);
    });
}

function bindSliders() {
    const update = (param, val) => {
        const s = bassSynths.find(sy => sy.id === AppState.activeView);
        if(!s) return;
        
        // Analog Cutoff Mapping
        if(param === 'cutoff' && val > 100) val = ((val - 100) / 4900) * 100;
        
        if(param === 'distortion') s.setDistortion(val);
        if(param === 'cutoff') s.setCutoff(val);
        if(param === 'resonance') s.setResonance(val);
        if(param === 'envMod') s.setEnvMod(val);
        if(param === 'decay') s.setDecay(val);
        
        syncControls(s);
    };

    ['dist', 'cutoff', 'res', 'env', 'dec'].forEach(p => {
        const map = { 'dist': 'distortion', 'cutoff': 'cutoff', 'res': 'resonance', 'env': 'envMod', 'dec': 'decay' };
        const el = document.getElementById(`${p}-slider`);
        if(el) el.oninput = (e) => update(map[p], parseFloat(e.target.value));
    });
}

function setupDigitalRepeaters() {
    const buttons = document.querySelectorAll('.dfx-btn');
    buttons.forEach(btn => {
        let intervalId, timeoutId;
        const target = btn.dataset.target;
        const dir = parseInt(btn.dataset.dir);

        const change = () => {
            const s = bassSynths.find(sy => sy.id === AppState.activeView);
            if(!s) return;
            
            let cur = 0;
            if(target === 'resonance') cur = s.params.resonance * 5; 
            else cur = s.params[target]; 

            let next = Math.max(0, Math.min(100, cur + dir));
            
            if(target === 'distortion') s.setDistortion(next);
            else if(target === 'envMod') s.setEnvMod(next);
            else if(target === 'decay') s.setDecay(next);
            else if(target === 'cutoff') s.setCutoff(next);
            else if(target === 'resonance') s.setResonance(next / 5);
            
            syncControls(s);
        };

        const start = () => { change(); timeoutId = setTimeout(() => { intervalId = setInterval(change, 100); }, 400); };
        const stop = () => { clearTimeout(timeoutId); clearInterval(intervalId); };

        btn.addEventListener('mousedown', start);
        btn.addEventListener('mouseup', stop);
        btn.addEventListener('mouseleave', stop);
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); start(); });
        btn.addEventListener('touchend', stop);
    });

    ['dist', 'cutoff', 'res', 'env', 'dec'].forEach(p => {
        const el = document.getElementById(`${p}-digital`);
        if(el) {
            el.onchange = (e) => {
                const s = bassSynths.find(sy => sy.id === AppState.activeView);
                if(!s) return;
                let val = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                
                const map = { 'dist': 'distortion', 'cutoff': 'cutoff', 'res': 'resonance', 'env': 'envMod', 'dec': 'decay' };
                const param = map[p];
                
                if(param === 'resonance') s.setResonance(val / 5);
                else if(param === 'distortion') s.setDistortion(val);
                else if(param === 'cutoff') s.setCutoff(val);
                else if(param === 'envMod') s.setEnvMod(val);
                else if(param === 'decay') s.setDecay(val);
                
                syncControls(s);
            };
        }
    });
}

function initClockSVG() {
    const svg = document.getElementById('play-clock-svg');
    if(!svg) return;
    svg.innerHTML = '';
    for(let i=0; i<16; i++) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        el.setAttribute("r", 45); el.setAttribute("cx", 50); el.setAttribute("cy", 50);
        el.setAttribute("fill", "transparent"); el.setAttribute("stroke-width", "4");
        el.setAttribute("stroke-dasharray", `${(Math.PI*90/16)-2} ${Math.PI*90}`);
        el.setAttribute("transform", `rotate(${(360/16)*i}, 50, 50)`);
        el.setAttribute("id", `clock-seg-${i}`);
        el.setAttribute("stroke", "#333");
        svg.appendChild(el);
    }
}

function updateClockUI(step) {
    for(let i=0; i<16; i++) {
        const s = document.getElementById(`clock-seg-${i}`);
        if(s) s.setAttribute("stroke", i === step ? "#00ff41" : (i < step ? "#004411" : "#222"));
    }
}

// --- EXPORT LOGIC ---
async function renderAudio() {
    if(AppState.isPlaying) toggleTransport();
    const btn = document.getElementById('btn-start-render');
    if(btn) { btn.innerText = "RENDERING..."; btn.disabled = true; }

    try {
        const steps = window.timeMatrix.totalSteps;
        const blocks = window.timeMatrix.blocks.length;
        const reps = AppState.exportReps;
        const secondsPerStep = (60 / AppState.bpm) / 4;
        const duration = steps * blocks * reps * secondsPerStep + 2.0;

        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const oCtx = new OfflineCtx(2, 44100 * duration, 44100);
        
        const oMaster = oCtx.createGain();
        oMaster.gain.value = 0.6;
        oMaster.connect(oCtx.destination);

        const oSynths = [];
        bassSynths.forEach(src => {
            const s = new window.BassSynth(src.id);
            s.init(oCtx, oMaster);
            s.params = JSON.parse(JSON.stringify(src.params)); 
            if(s.fxChain) s.setDistortion(src.params.distortion); 
            oSynths.push(s);
        });

        const oDrums = new window.DrumSynth();
        oDrums.init(oCtx, oMaster);

        let t = 0;
        for(let r=0; r<reps; r++) {
            for(let b=0; b<blocks; b++) {
                const blk = window.timeMatrix.blocks[b];
                for(let s=0; s<steps; s++) {
                    if(blk.drums && blk.drums[s]) blk.drums[s].forEach(d => oDrums.play(d, t));
                    if(blk.tracks) {
                        Object.keys(blk.tracks).forEach(tid => {
                            const n = blk.tracks[tid][s];
                            if(n) {
                                const synth = oSynths.find(x => x.id === tid);
                                if(synth) synth.play(n.note, n.octave, t, 0.25, n.slide, n.accent);
                            }
                        });
                    }
                    t += secondsPerStep;
                }
            }
        }

        const buffer = await oCtx.startRendering();
        const wav = bufferToWave(buffer);
        const url = URL.createObjectURL(wav);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ND23_Render_${Date.now()}.wav`;
        a.click();
        
        document.getElementById('export-modal').classList.add('hidden');
        document.getElementById('export-modal').classList.remove('flex');

    } catch(e) {
        console.error("Render Error", e);
        alert("Render Failed");
    } finally {
        if(btn) { btn.innerText = "RENDER"; btn.disabled = false; }
    }
}

function bufferToWave(abuffer) {
    let numOfChan = abuffer.numberOfChannels,
        length = abuffer.length * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [], i, sample,
        offset = 0, pos = 0;

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
    setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
    setUint32(abuffer.sampleRate); setUint32(abuffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
    setUint32(length - pos - 4);

    for(i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i));

    while(pos < length) {
        for(i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset])); 
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
            view.setInt16(pos, sample, true); pos += 2;
        }
        offset++;
    }
    return new Blob([buffer], {type: "audio/wav"});
}