/*
 * NEURODARK 23 - NATIVE CORE v23 (Fix & Integration)
 */

const AppState = {
    isPlaying: false,
    bpm: 174,
    currentPlayStep: 0,
    currentPlayBlock: 0,
    editingBlock: 0,
    selectedStep: 0,
    activeView: 'bass-1',
    currentOctave: 3,
    distortionLevel: 20,
    panelCollapsed: false,
    followPlayback: false, 
    uiMode: 'analog',
    exportReps: 1
};

let audioCtx = null;
let masterGain = null;
let clockWorker = null;
let bassSynths = [];

let nextNoteTime = 0.0;
const LOOKAHEAD = 0.1;
const INTERVAL = 25;
let visualQueue = [];
let drawFrameId = null;
let lastDrawnStep = -1;

// --- UTILS ---
function safeClick(id, fn) {
    const el = document.getElementById(id);
    if(el) el.onclick = fn;
    else console.warn(`Button ID not found: ${id}`);
}

// --- BOOTSTRAP ---
function bootstrap() {
    window.logToScreen("Boot Filters...");
    try {
        if(!window.timeMatrix) throw "TimeMatrix Missing";
        if(typeof window.BassSynth === 'undefined') throw "BassSynth Missing";

        if(bassSynths.length === 0) {
            const def = new window.BassSynth('bass-1');
            bassSynths.push(def);
            if(window.timeMatrix.registerTrack) window.timeMatrix.registerTrack('bass-1');
        }

        renderInstrumentTabs();
        renderTrackBar();
        updateEditors();
        initPlayClock();
        setupDigitalRepeaters();
        
        window.logToScreen("Engine Ready [OK]");
    } catch(e) {
        window.logToScreen("BOOT ERR: " + e, 'error');
        console.error(e);
    }
}

// --- ENGINE ---
function initEngine() {
    if(audioCtx && audioCtx.state === 'running') return;
    try {
        if(!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AC({ latencyHint: 'interactive' });
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.6;
            
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -3;
            masterGain.connect(comp);
            comp.connect(audioCtx.destination);

            bassSynths.forEach(s => s.init(audioCtx, masterGain));
            if(window.drumSynth) window.drumSynth.init(audioCtx, masterGain);

            if(!clockWorker) {
                try {
                    clockWorker = new Worker('Synth/clock_worker.js');
                    clockWorker.onmessage = (e) => { if(e.data === "tick") scheduler(); };
                    clockWorker.postMessage({interval: INTERVAL});
                } catch(e) { console.warn(e); }
            }
        }
        if(audioCtx.state === 'suspended') audioCtx.resume();
    } catch(e) { window.logToScreen("Audio Fail: "+e, 'error'); }
}

function globalUnlock() {
    initEngine();
    if(audioCtx && audioCtx.state === 'running') {
        document.removeEventListener('click', globalUnlock);
        document.removeEventListener('touchstart', globalUnlock);
    }
}

// --- CORE ---
function addBassSynth() {
    const id = `bass-${bassSynths.length + 1}`;
    if(bassSynths.find(s=>s.id===id)) return;
    const s = new window.BassSynth(id);
    if(audioCtx) s.init(audioCtx, masterGain);
    bassSynths.push(s);
    window.timeMatrix.registerTrack(id);
    renderSynthMenu(); renderInstrumentTabs(); setTab(id);
    window.logToScreen(`+Synth: ${id}`);
}

// --- SYNC PARAMETERS (SAFE MODE) ---
function syncControlsFromSynth(viewId) {
    const s = bassSynths.find(sy => sy.id === viewId);
    
    const wvBtn = document.getElementById('btn-waveform');
    if(wvBtn && s) {
        if(s.params.waveform === 'square') wvBtn.innerHTML = '<span class="text-xl font-bold leading-none mb-1">Π</span><span>SQR</span>';
        else wvBtn.innerHTML = '<span class="text-xl font-bold leading-none mb-1">~</span><span>SAW</span>';
    }

    if(!s) return;
    
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if(el) el.value = val;
    };

    const params = {
        dist: s.params.distortion,
        cutoff: s.params.cutoff,
        res: s.params.resonance,
        env: s.params.envMod,
        dec: s.params.decay
    };

    setVal('dist-slider', params.dist);
    setVal('cutoff-slider', params.cutoff);
    setVal('res-slider', params.res);
    setVal('env-slider', params.env);
    setVal('dec-slider', params.dec);

    const cutPerc = Math.round(((params.cutoff - 50) / 4950) * 100);
    const resPerc = Math.round(params.res * 5);
    
    setVal('dist-digital', params.dist);
    setVal('cutoff-digital', cutPerc);
    setVal('res-digital', resPerc);
    setVal('env-digital', params.env);
    setVal('dec-digital', params.dec);
}

// --- SETUP ---
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', globalUnlock);
    document.addEventListener('touchstart', globalUnlock);
    
    safeClick('btn-play', toggleTransport);
    safeClick('app-logo', toggleTransport); 
    safeClick('btn-open-menu', () => { renderSynthMenu(); toggleMenu(); });
    safeClick('btn-menu-close', toggleMenu);
    
    safeClick('btn-toggle-ui-mode', toggleUIMode);
    safeClick('btn-toggle-visualizer', toggleVisualizerMode);
    
    safeClick('btn-minimize-panel', (e) => { e.stopPropagation(); togglePanelState(); });
    safeClick('panel-header-trigger', togglePanelState);

    // Log Toggle Logic
    const logPanel = document.getElementById('sys-log-panel');
    const logBtn = document.getElementById('btn-toggle-log-internal');
    const toggleLog = () => {
        if(logPanel.classList.contains('-translate-y-full')) {
            logPanel.classList.remove('-translate-y-full');
            logPanel.classList.add('translate-y-0');
            logBtn.innerText = "[HIDE]"; 
        } else { 
            logPanel.classList.add('-translate-y-full');
            logPanel.classList.remove('translate-y-0');
            logBtn.innerText = "[SHOW]"; 
        }
    };
    if(logBtn) logBtn.onclick = toggleLog;
    safeClick('btn-toggle-log-menu', () => { toggleLog(); toggleMenu(); });

    safeClick('btn-waveform', toggleWaveform);

    const bindSlider = (id, param) => {
        const el = document.getElementById(id);
        if(el) el.oninput = (e) => updateSynthParam(param, parseInt(e.target.value));
    };
    bindSlider('dist-slider', 'distortion');
    bindSlider('cutoff-slider', 'cutoff');
    bindSlider('res-slider', 'resonance');
    bindSlider('env-slider', 'envMod');
    bindSlider('dec-slider', 'decay');

    window.addEventListener('stepSelect', (e) => { AppState.selectedStep = e.detail.index; updateEditors(); });
    
    document.querySelectorAll('.piano-key').forEach(k => {
        k.onclick = () => {
            initEngine();
            const note = k.dataset.note;
            const s = bassSynths.find(sy => sy.id === AppState.activeView);
            if(!s) return;
            const b = window.timeMatrix.blocks[AppState.editingBlock];
            if(!b.tracks[s.id]) window.timeMatrix.registerTrack(s.id);
            const prev = b.tracks[s.id][AppState.selectedStep];
            b.tracks[s.id][AppState.selectedStep] = { 
                note, octave: AppState.currentOctave, 
                slide: prev ? prev.slide : false, 
                accent: prev ? prev.accent : false 
            };
            s.play(note, AppState.currentOctave, audioCtx.currentTime);
            updateEditors();
        };
    });

    safeClick('btn-delete-note', () => { 
        const s = bassSynths.find(sy => sy.id === AppState.activeView); 
        if(s) { window.timeMatrix.blocks[AppState.editingBlock].tracks[s.id][AppState.selectedStep] = null; updateEditors(); }
    });

    const toggleNoteMod = (prop) => {
        if(AppState.activeView === 'drum') return;
        const b = window.timeMatrix.blocks[AppState.editingBlock];
        const track = b.tracks[AppState.activeView];
        if(!track) return;
        const note = track[AppState.selectedStep];
        if(note) { note[prop] = !note[prop]; updateEditors(); }
    };
    safeClick('btn-toggle-slide', () => toggleNoteMod('slide'));
    safeClick('btn-toggle-accent', () => toggleNoteMod('accent'));

    const bpm = document.getElementById('bpm-input'); if(bpm) bpm.onchange = (e) => AppState.bpm = e.target.value;
    const octD = document.getElementById('oct-display');
    safeClick('oct-up', () => { if(AppState.currentOctave<6) AppState.currentOctave++; octD.innerText=AppState.currentOctave; });
    safeClick('oct-down', () => { if(AppState.currentOctave>1) AppState.currentOctave--; octD.innerText=AppState.currentOctave; });

    safeClick('btn-add-synth', addBassSynth);
    safeClick('btn-menu-panic', () => location.reload());
    safeClick('btn-menu-clear', () => { if(confirm("Clear?")) { window.timeMatrix.clearBlock(AppState.editingBlock); updateEditors(); toggleMenu(); }});
    safeClick('btn-add-block', () => { window.timeMatrix.addBlock(); AppState.editingBlock = window.timeMatrix.blocks.length-1; updateEditors(); renderTrackBar(); });
    safeClick('btn-del-block', () => { if(confirm("Del?")) { window.timeMatrix.removeBlock(AppState.editingBlock); AppState.editingBlock = Math.max(0, window.timeMatrix.blocks.length-1); updateEditors(); renderTrackBar(); }});
    safeClick('btn-mem-copy', () => { if(window.timeMatrix.copyToClipboard(AppState.editingBlock)) window.logToScreen("PATTERN COPIED"); });
    safeClick('btn-mem-paste', () => { if(window.timeMatrix.pasteFromClipboard(AppState.editingBlock)) { AppState.editingBlock++; updateEditors(); renderTrackBar(); window.logToScreen("PATTERN PASTED"); }});
    safeClick('btn-move-left', () => { if(window.timeMatrix.moveBlock(AppState.editingBlock, -1)) { AppState.editingBlock--; updateEditors(); renderTrackBar(); }});
    safeClick('btn-move-right', () => { if(window.timeMatrix.moveBlock(AppState.editingBlock, 1)) { AppState.editingBlock++; updateEditors(); renderTrackBar(); }});
    
    safeClick('btn-open-export', () => { toggleMenu(); toggleExportModal(); });
    safeClick('btn-close-export', toggleExportModal);
    safeClick('btn-start-render', renderAudio);
    document.querySelectorAll('.export-rep-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.export-rep-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.exportReps = parseInt(btn.dataset.rep);
        };
    });

    bootstrap();
});

// --- HELPER FUNCTIONS (DEFINED GLOBALLY) ---
function updateSynthParam(param, value) {
    const s = bassSynths.find(sy => sy.id === AppState.activeView);
    if(!s) return;
    if(param === 'distortion') s.setDistortion(value);
    if(param === 'cutoff') s.setCutoff(value);
    if(param === 'resonance') s.setResonance(value);
    if(param === 'envMod') s.setEnvMod(value);
    if(param === 'decay') s.setDecay(value);
    syncControlsFromSynth(AppState.activeView);
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
            else if(target === 'cutoff') current = ((s.params.cutoff - 50) / 4950) * 100; 

            let next = Math.max(0, Math.min(100, current + dir));
            
            if(target === 'distortion') s.setDistortion(next);
            else if(target === 'envMod') s.setEnvMod(next);
            else if(target === 'decay') s.setDecay(next);
            else if(target === 'resonance') s.setResonance(next / 5);
            else if(target === 'cutoff') s.setCutoff((next/100 * 4950) + 50);
            
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

// --- RESTORED FUNCTIONS ---
function toggleMenu() {
    const m = document.getElementById('main-menu');
    if(m) { m.classList.toggle('hidden'); m.classList.toggle('flex'); }
}

function toggleExportModal() {
    const m = document.getElementById('export-modal');
    if(m) { m.classList.toggle('hidden'); m.classList.toggle('flex'); }
}

function renderTrackBar() { const c = document.getElementById('track-bar'); if(!c) return; c.innerHTML = ''; const blocks = window.timeMatrix.blocks; document.getElementById('display-total-blocks').innerText = blocks.length; document.getElementById('display-current-block').innerText = AppState.editingBlock + 1; blocks.forEach((_, i) => { const el = document.createElement('div'); el.className = `track-block ${i===AppState.editingBlock ? 'track-block-editing' : ''} ${AppState.isPlaying && i===AppState.currentPlayBlock ? 'track-block-playing' : ''}`; el.innerText = i + 1; el.onclick = () => { AppState.editingBlock = i; updateEditors(); renderTrackBar(); }; c.appendChild(el); }); }
function updateEditors() { const bEd = document.getElementById('editor-bass'); const dEd = document.getElementById('editor-drum'); const info = document.getElementById('step-info-display'); if(info) info.innerText = `STEP ${AppState.selectedStep+1} // ${AppState.activeView.toUpperCase()}`; if(AppState.activeView === 'drum') { bEd.classList.add('hidden'); dEd.classList.remove('hidden'); renderDrumRows(); } else { bEd.classList.remove('hidden'); dEd.classList.add('hidden'); } const slideBtn = document.getElementById('btn-toggle-slide'); const accBtn = document.getElementById('btn-toggle-accent'); if(slideBtn) slideBtn.classList.remove('text-green-400', 'border-green-600'); if(accBtn) accBtn.classList.remove('text-green-400', 'border-green-600'); if(AppState.activeView !== 'drum') { const blk = window.timeMatrix.blocks[AppState.editingBlock]; const noteData = blk.tracks[AppState.activeView] ? blk.tracks[AppState.activeView][AppState.selectedStep] : null; if(noteData) { if(noteData.slide && slideBtn) slideBtn.classList.add('text-green-400', 'border-green-600'); if(noteData.accent && accBtn) accBtn.classList.add('text-green-400', 'border-green-600'); } } window.timeMatrix.selectedStep = AppState.selectedStep; window.timeMatrix.render(AppState.activeView, AppState.editingBlock); }
function renderDrumRows() { const c = document.getElementById('editor-drum'); if(!c) return; c.innerHTML = ''; const blk = window.timeMatrix.blocks[AppState.editingBlock]; const cur = blk.drums[AppState.selectedStep]; const kits = (window.drumSynth && window.drumSynth.kits) ? window.drumSynth.kits : []; kits.forEach(k => { const act = cur.includes(k.id); const b = document.createElement('button'); b.className = `w-full py-2 px-3 mb-1 border flex justify-between items-center text-[10px] ${act ? 'bg-gray-900 border-green-700 text-green-400' : 'bg-transparent border-gray-800 text-gray-500'}`; b.innerHTML = `<span>${k.name}</span><div class="w-2 h-2 rounded-full" style="background:${k.color}"></div>`; b.onclick = () => { initEngine(); if(act) cur.splice(cur.indexOf(k.id), 1); else { cur.push(k.id); window.drumSynth.play(k.id, audioCtx.currentTime); } updateEditors(); }; c.appendChild(b); }); }
function renderSynthMenu() { const c = document.getElementById('synth-list-container'); if(!c) return; c.innerHTML = ''; bassSynths.forEach(s => { const r = document.createElement('div'); r.className = 'flex justify-between bg-black p-2 border border-gray-800 text-xs'; r.innerHTML = `<span class=\"text-green-500\">${s.id}</span><button class=\"text-red-500\" onclick=\"removeBassSynth('${s.id}')\">X</button>`; c.appendChild(r); }); }
function togglePanelState() { AppState.panelCollapsed = !AppState.panelCollapsed; const p = document.getElementById('editor-panel'); const btn = document.getElementById('btn-minimize-panel'); if(AppState.panelCollapsed) { p.classList.remove('panel-expanded'); p.classList.add('panel-collapsed'); btn.innerHTML = "&#9650;"; } else { p.classList.remove('panel-collapsed'); p.classList.add('panel-expanded'); btn.innerHTML = "&#9660;"; } }
function toggleVisualizerMode() { AppState.followPlayback = !AppState.followPlayback; const btn = document.getElementById('btn-toggle-visualizer'); if(AppState.followPlayback) { btn.innerText = "VISUALIZER: ON"; btn.classList.remove('border-gray-700', 'text-gray-400'); btn.classList.add('border-green-500', 'text-green-400', 'bg-green-900/20'); } else { btn.innerText = "VISUALIZER: OFF"; btn.classList.remove('border-green-500', 'text-green-400', 'bg-green-900/20'); btn.classList.add('border-gray-700', 'text-gray-400'); } }
function toggleUIMode() { AppState.uiMode = AppState.uiMode === 'analog' ? 'digital' : 'analog'; const btn = document.getElementById('btn-toggle-ui-mode'); const analogP = document.getElementById('fx-controls-analog'); const digitalP = document.getElementById('fx-controls-digital'); if(AppState.uiMode === 'digital') { btn.innerText = "UI MODE: DIGITAL"; btn.classList.add('border-green-500', 'text-green-300'); analogP.classList.add('opacity-0', 'pointer-events-none'); digitalP.classList.remove('hidden'); } else { btn.innerText = "UI MODE: ANALOG"; btn.classList.remove('border-green-500', 'text-green-300'); analogP.classList.remove('opacity-0', 'pointer-events-none'); digitalP.classList.add('hidden'); } syncControlsFromSynth(AppState.activeView); }
function toggleTransport() { initEngine(); AppState.isPlaying = !AppState.isPlaying; const btn = document.getElementById('btn-play'); if(AppState.isPlaying) { btn.innerHTML = "&#10074;&#10074;"; btn.classList.add('border-green-500', 'text-green-500'); AppState.currentPlayStep = 0; AppState.currentPlayBlock = AppState.editingBlock; nextNoteTime = audioCtx.currentTime + 0.1; visualQueue = []; if(clockWorker) clockWorker.postMessage("start"); drawLoop(); window.logToScreen("PLAY"); } else { btn.innerHTML = "&#9658;"; btn.classList.remove('border-green-500', 'text-green-500'); if(clockWorker) clockWorker.postMessage("stop"); cancelAnimationFrame(drawFrameId); window.timeMatrix.highlightPlayingStep(-1); updatePlayClock(-1); renderTrackBar(); window.logToScreen("STOP"); } }
function bufferToWave(abuffer, len) { let numOfChan = abuffer.numberOfChannels, length = len * numOfChan * 2 + 44, buffer = new ArrayBuffer(length), view = new DataView(buffer), channels = [], i, sample, offset = 0, pos = 0; function setUint16(data) { view.setUint16(pos, data, true); pos += 2; } function setUint32(data) { view.setUint32(pos, data, true); pos += 4; } setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan); setUint32(abuffer.sampleRate); setUint32(abuffer.sampleRate * 2 * numOfChan); setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4); for(i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i)); while(pos < length) { for(i = 0; i < numOfChan; i++) { sample = Math.max(-1, Math.min(1, channels[i][offset])); sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; view.setInt16(pos, sample, true); pos += 2; } offset++; } return new Blob([buffer], {type: "audio/wav"}); }