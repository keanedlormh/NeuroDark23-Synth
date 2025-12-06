/*
 * NEURODARK 23 - MAIN CONTROLLER v32 (Modular)
 */

// STATE MANAGEMENT
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

// Global Arrays used by Engine & UI
window.visualQueue = [];
window.bassSynths = [];

// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Audio Engine Init (Unlock on Click)
    document.addEventListener('click', globalUnlock);
    document.addEventListener('touchstart', globalUnlock);
    
    // 2. Main Logic
    window.logToScreen("Booting System...");
    try {
        if(!window.timeMatrix) throw "TimeMatrix Missing";
        if(typeof window.BassSynth === 'undefined') throw "BassSynth Missing";

        // Create Default Synth
        if (window.bassSynths.length === 0) {
            const def = new window.BassSynth('bass-1');
            window.bassSynths.push(def);
            if(window.timeMatrix.registerTrack) window.timeMatrix.registerTrack('bass-1');
        }

        // Init UI Components
        renderInstrumentTabs(); 
        renderTrackBar();
        updateEditors();
        initPlayClock(); 
        setupDigitalRepeaters();
        
        // Sync Initial State
        syncControlsFromSynth('bass-1');
        
        window.logToScreen("System Ready [OK]");
    } catch(e) {
        window.logToScreen("BOOT ERR: " + e, 'error');
        console.error(e);
    }

    // 3. Bind Event Listeners
    setupEventListeners();
});

// --- EVENT ORCHESTRATION ---
function toggleTransport() { 
    initEngine(); // Ensure AudioContext is ready
    AppState.isPlaying = !AppState.isPlaying; 
    
    const btn = document.getElementById('btn-play'); 
    
    if(AppState.isPlaying) { 
        btn.innerHTML = "&#10074;&#10074;"; 
        btn.classList.add('border-green-500', 'text-green-500'); 
        
        // Reset Logic
        AppState.currentPlayStep = 0; 
        AppState.currentPlayBlock = AppState.editingBlock; 
        nextNoteTime = audioCtx.currentTime + 0.05; 
        window.visualQueue = []; 
        lastDrawnStep = -1;

        // Start Clock
        if(clockWorker) clockWorker.postMessage("start"); 
        
        // Start Visual Loop
        drawLoop(); 
        window.logToScreen("PLAY"); 
    } else { 
        btn.innerHTML = "&#9658;"; 
        btn.classList.remove('border-green-500', 'text-green-500'); 
        
        // Stop Clock
        if(clockWorker) clockWorker.postMessage("stop"); 
        if(drawFrameId) cancelAnimationFrame(drawFrameId);
        
        // Reset Visuals
        window.timeMatrix.highlightPlayingStep(-1); 
        updatePlayClock(-1); 
        renderTrackBar(); 
        window.logToScreen("STOP"); 
    } 
}

function addBassSynth() {
    const id = `bass-${bassSynths.length + 1}`;
    if(bassSynths.find(s=>s.id===id)) return;
    const s = new window.BassSynth(id);
    if(audioCtx) s.init(audioCtx, masterGain);
    bassSynths.push(s);
    window.timeMatrix.registerTrack(id);
    renderSynthMenu(); 
    renderInstrumentTabs(); 
    setTab(id);
    window.logToScreen(`+Synth: ${id}`);
}

function setupEventListeners() {
    safeClick('btn-play', toggleTransport);
    safeClick('app-logo', toggleTransport); 
    safeClick('btn-open-menu', () => { renderSynthMenu(); window.toggleMenu(); });
    safeClick('btn-menu-close', window.toggleMenu);
    
    safeClick('btn-toggle-ui-mode', toggleUIMode);
    safeClick('btn-toggle-visualizer', toggleVisualizerMode);
    safeClick('btn-minimize-panel', (e) => { e.stopPropagation(); togglePanelState(); });
    safeClick('panel-header-trigger', togglePanelState);

    const logBtn = document.getElementById('btn-toggle-log-internal');
    if(logBtn) logBtn.onclick = () => {
        const p = document.getElementById('sys-log-panel');
        p.classList.toggle('-translate-y-full');
        p.classList.toggle('translate-y-0');
        logBtn.innerText = p.classList.contains('translate-y-0') ? "[HIDE]" : "[SHOW]";
    };
    safeClick('btn-toggle-log-menu', () => { 
        document.getElementById('sys-log-panel').classList.remove('-translate-y-full');
        document.getElementById('sys-log-panel').classList.add('translate-y-0');
        window.toggleMenu(); 
    });

    safeClick('btn-waveform', toggleWaveform);

    // Bind Analog Sliders
    const bindSlider = (id, param) => {
        const el = document.getElementById(id);
        if(el) el.oninput = (e) => updateSynthParam(param, parseInt(e.target.value));
    };
    bindSlider('dist-slider', 'distortion');
    bindSlider('cutoff-slider', 'cutoff'); 
    bindSlider('res-slider', 'resonance');
    bindSlider('env-slider', 'envMod');
    bindSlider('dec-slider', 'decay');

    // Bind Digital Inputs (Typing)
    const bindDigitalInput = (id, param) => {
        const el = document.getElementById(id);
        if(el) {
            el.onchange = (e) => {
                let val = parseInt(e.target.value);
                if(isNaN(val)) val = 0;
                val = Math.max(0, Math.min(100, val)); 
                
                // Specific Mappings for direct entry
                const s = bassSynths.find(sy => sy.id === AppState.activeView);
                if(!s) return;

                if (param === 'resonance') s.setResonance(val / 5);
                else if (param === 'cutoff') s.setCutoff(val);
                else if (param === 'distortion') s.setDistortion(val);
                else if (param === 'envMod') s.setEnvMod(val);
                else if (param === 'decay') s.setDecay(val);
                
                syncControlsFromSynth(AppState.activeView);
            };
        }
    };
    bindDigitalInput('dist-digital', 'distortion');
    bindDigitalInput('cutoff-digital', 'cutoff');
    bindDigitalInput('res-digital', 'resonance');
    bindDigitalInput('env-digital', 'envMod');
    bindDigitalInput('dec-digital', 'decay');

    // Matrix & Piano Events
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

    // Controls
    const bpm = document.getElementById('bpm-input'); if(bpm) bpm.onchange = (e) => AppState.bpm = e.target.value;
    const octD = document.getElementById('oct-display');
    safeClick('oct-up', () => { if(AppState.currentOctave<6) AppState.currentOctave++; octD.innerText=AppState.currentOctave; });
    safeClick('oct-down', () => { if(AppState.currentOctave>1) AppState.currentOctave--; octD.innerText=AppState.currentOctave; });

    safeClick('btn-add-synth', addBassSynth);
    safeClick('btn-menu-panic', () => location.reload());
    safeClick('btn-menu-clear', () => { if(confirm("Clear?")) { window.timeMatrix.clearBlock(AppState.editingBlock); updateEditors(); window.toggleMenu(); }});
    safeClick('btn-add-block', () => { window.timeMatrix.addBlock(); AppState.editingBlock = window.timeMatrix.blocks.length-1; updateEditors(); renderTrackBar(); });
    safeClick('btn-del-block', () => { if(confirm("Del?")) { window.timeMatrix.removeBlock(AppState.editingBlock); AppState.editingBlock = Math.max(0, window.timeMatrix.blocks.length-1); updateEditors(); renderTrackBar(); }});
    safeClick('btn-mem-copy', () => { if(window.timeMatrix.copyToClipboard(AppState.editingBlock)) window.logToScreen("PATTERN COPIED"); });
    safeClick('btn-mem-paste', () => { if(window.timeMatrix.pasteFromClipboard(AppState.editingBlock)) { AppState.editingBlock++; updateEditors(); renderTrackBar(); window.logToScreen("PATTERN PASTED"); }});
    safeClick('btn-move-left', () => { if(window.timeMatrix.moveBlock(AppState.editingBlock, -1)) { AppState.editingBlock--; updateEditors(); renderTrackBar(); }});
    safeClick('btn-move-right', () => { if(window.timeMatrix.moveBlock(AppState.editingBlock, 1)) { AppState.editingBlock++; updateEditors(); renderTrackBar(); }});
    
    safeClick('btn-open-export', () => { window.toggleMenu(); window.toggleExportModal(); });
    safeClick('btn-close-export', window.toggleExportModal);
    safeClick('btn-start-render', renderAudio);
    document.querySelectorAll('.export-rep-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.export-rep-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.exportReps = parseInt(btn.dataset.rep);
        };
    });
}