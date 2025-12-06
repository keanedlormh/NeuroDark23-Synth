/*
 * NEURODARK 23 - MAIN CONTROLLER v33
 * Central Hub: Bootstraps Engine & UI
 */

// --- GLOBAL STATE ---
window.AppState = {
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
    followPlayback: false
};

// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Verificar dependencias críticas
    if(!window.timeMatrix || typeof window.BassSynth === 'undefined') {
        console.error("CRITICAL: Modules missing. Check script order.");
        return;
    }

    // 2. Inicializar Estado de Datos
    if (window.bassSynths.length === 0) {
        const def = new window.BassSynth('bass-1');
        window.bassSynths.push(def);
        // Registrar en matriz
        if(window.timeMatrix.registerTrack) window.timeMatrix.registerTrack('bass-1');
    }

    // 3. Inicializar UI
    window.renderInstrumentTabs();
    window.renderTrackBar();
    window.updateEditors();
    window.initPlayClockUI();
    window.setupControlListeners(); // Vincula teclas, sliders, etc.
    
    // Sincronizar estado inicial
    window.syncControlsFromSynth('bass-1');

    console.log("[Main] System Boot Complete");
});

// --- GLOBAL EVENT HANDLERS (Called from HTML) ---

// Cambio de pestaña (Bass-1, Bass-2, Drums...)
window.setTab = function(viewId) {
    window.AppState.activeView = viewId;
    window.renderInstrumentTabs();
    window.updateEditors();
    
    if(viewId !== 'drum') {
        window.syncControlsFromSynth(viewId);
    }
};

// Toggle UI Mode (Analog/Digital)
window.toggleUIMode = function() {
    window.AppState.uiMode = window.AppState.uiMode === 'analog' ? 'digital' : 'analog';
    const btn = document.getElementById('btn-toggle-ui-mode');
    const aPan = document.getElementById('fx-controls-analog');
    const dPan = document.getElementById('fx-controls-digital');
    
    if(window.AppState.uiMode === 'digital') {
        btn.innerText = "UI MODE: DIGITAL";
        btn.classList.add('border-green-500');
        aPan.classList.add('hidden');
        dPan.classList.remove('hidden');
    } else {
        btn.innerText = "UI MODE: ANALOG";
        btn.classList.remove('border-green-500');
        aPan.classList.remove('hidden');
        dPan.classList.add('hidden');
    }
};

// Toggle Waveform
window.toggleWaveform = function() {
    const s = window.bassSynths.find(sy => sy.id === window.AppState.activeView);
    if(s) {
        const next = s.params.waveform === 'sawtooth' ? 'square' : 'sawtooth';
        s.setWaveform(next);
        window.syncControlsFromSynth(s.id);
    }
};

// Toggle Panel Size
window.togglePanelState = function() {
    const p = document.getElementById('editor-panel');
    const btn = document.getElementById('btn-minimize-panel');
    const isCollapsed = p.classList.contains('panel-collapsed');
    
    if(isCollapsed) {
        p.classList.remove('panel-collapsed');
        p.classList.add('panel-expanded');
        btn.innerHTML = "&#9660;";
    } else {
        p.classList.remove('panel-expanded');
        p.classList.add('panel-collapsed');
        btn.innerHTML = "&#9650;";
    }
};

// Add New Bass
window.addBassSynth = function() {
    const id = `bass-${window.bassSynths.length + 1}`;
    const s = new window.BassSynth(id);
    // Si el motor de audio ya corre, inicializarlo
    if(window.audioCtx) s.init(window.audioCtx, window.masterGain);
    
    window.bassSynths.push(s);
    window.timeMatrix.registerTrack(id);
    
    window.setTab(id);
};

// Helpers de menú
window.renderSynthMenu = function() {
    const c = document.getElementById('synth-list-container');
    if(!c) return;
    c.innerHTML = '';
    window.bassSynths.forEach(s => {
        const r = document.createElement('div');
        r.className = 'flex justify-between bg-black p-2 border border-gray-800 text-xs';
        r.innerHTML = `<span class="text-green-500">${s.id}</span><button class="text-red-500" onclick="removeBassSynth('${s.id}')">X</button>`;
        c.appendChild(r);
    });
};