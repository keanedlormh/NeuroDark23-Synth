/*
 * USER INTERFACE MODULE
 * Responsabilidad: Eventos DOM, Pintado de Grid, Sincronización de Controles
 */

window.visualQueue = []; // Cola de eventos visuales compartida
let drawFrameId = null;
let lastDrawnStep = -1;

// --- VISUAL LOOP ---
window.startVisualLoop = function() {
    if(drawFrameId) cancelAnimationFrame(drawFrameId);
    drawVisuals();
};

function drawVisuals() {
    if(!window.audioCtx) return;
    const t = window.audioCtx.currentTime;
    
    while(window.visualQueue.length && window.visualQueue[0].time <= t) {
        const ev = window.visualQueue.shift();
        
        if(lastDrawnStep !== ev.step) {
            window.updatePlayClockUI(ev.step);
            
            // Cambio de bloque automático
            if(window.AppState.followPlayback && ev.block !== window.AppState.editingBlock) {
                window.AppState.editingBlock = ev.block;
                window.updateEditors();
                window.renderTrackBar();
            }
            
            // Resaltado de Grid
            if(ev.block === window.AppState.editingBlock) {
                if(window.timeMatrix) window.timeMatrix.highlightPlayingStep(ev.step);
                if(ev.step % 4 === 0) blinkLed();
            } else {
                if(window.timeMatrix) window.timeMatrix.highlightPlayingStep(-1);
            }
            
            if(ev.step === 0) window.renderTrackBar();
            lastDrawnStep = ev.step;
        }
    }
    
    if(window.AppState.isPlaying) {
        drawFrameId = requestAnimationFrame(drawVisuals);
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

// --- DOM BUILDERS ---
window.renderInstrumentTabs = function() {
    const c = document.getElementById('instrument-tabs-container');
    if(!c) return;
    c.innerHTML = '';
    
    window.bassSynths.forEach(s => {
        const b = document.createElement('button');
        const isActive = window.AppState.activeView === s.id;
        b.className = `px-3 py-1 text-[10px] font-bold border uppercase transition-all ${isActive ? 'text-green-400 bg-gray-900 border-green-500 shadow-md' : 'text-gray-500 border-transparent hover:text-gray-300'}`;
        b.innerText = s.id;
        b.onclick = () => window.setTab(s.id);
        c.appendChild(b);
    });
    
    const d = document.createElement('button');
    const dActive = window.AppState.activeView === 'drum';
    d.className = `px-3 py-1 text-[10px] font-bold border uppercase transition-all ${dActive ? 'text-green-400 bg-gray-900 border-green-500 shadow-md' : 'text-gray-500 border-transparent hover:text-gray-300'}`;
    d.innerText = "DRUMS";
    d.onclick = () => window.setTab('drum');
    c.appendChild(d);
};

window.renderTrackBar = function() {
    const c = document.getElementById('track-bar');
    if(!c) return;
    c.innerHTML = '';
    
    const blocks = window.timeMatrix.blocks;
    const current = window.AppState.editingBlock;
    
    document.getElementById('display-total-blocks').innerText = blocks.length;
    document.getElementById('display-current-block').innerText = current + 1;
    
    blocks.forEach((_, i) => {
        const el = document.createElement('div');
        let classes = "track-block ";
        if(i === current) classes += "track-block-editing ";
        if(window.AppState.isPlaying && i === window.AppState.currentPlayBlock) classes += "track-block-playing ";
        
        el.className = classes;
        el.innerText = i + 1;
        el.onclick = () => {
            window.AppState.editingBlock = i;
            window.updateEditors();
            window.renderTrackBar();
        };
        c.appendChild(el);
    });
};

window.updateEditors = function() {
    const bEd = document.getElementById('editor-bass');
    const dEd = document.getElementById('editor-drum');
    const info = document.getElementById('step-info-display');
    
    if(info) info.innerText = `STEP ${window.AppState.selectedStep+1} // ${window.AppState.activeView.toUpperCase()}`;
    
    if(window.AppState.activeView === 'drum') {
        bEd.classList.add('hidden');
        dEd.classList.remove('hidden');
        renderDrumEditor();
    } else {
        bEd.classList.remove('hidden');
        dEd.classList.add('hidden');
        updateBassModifiersState();
    }
    
    if(window.timeMatrix) {
        window.timeMatrix.selectedStep = window.AppState.selectedStep;
        window.timeMatrix.render(window.AppState.activeView, window.AppState.editingBlock);
    }
};

function updateBassModifiersState() {
    const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
    if(!blk) return;
    
    const noteData = blk.tracks[window.AppState.activeView] ? blk.tracks[window.AppState.activeView][window.AppState.selectedStep] : null;
    
    const slideBtn = document.getElementById('btn-toggle-slide');
    const accBtn = document.getElementById('btn-toggle-accent');
    
    [slideBtn, accBtn].forEach(b => {
        if(b) b.classList.remove('text-green-400', 'border-green-600', 'bg-green-900/30');
    });
    
    if(noteData) {
        if(noteData.slide && slideBtn) slideBtn.classList.add('text-green-400', 'border-green-600', 'bg-green-900/30');
        if(noteData.accent && accBtn) accBtn.classList.add('text-green-400', 'border-green-600', 'bg-green-900/30');
    }
}

function renderDrumEditor() {
    const c = document.getElementById('editor-drum');
    if(!c) return;
    c.innerHTML = '';
    
    const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
    const currentStepDrums = blk.drums[window.AppState.selectedStep] || [];
    const kits = (window.drumSynth && window.drumSynth.kits) ? window.drumSynth.kits : [];
    
    kits.forEach(k => {
        const isActive = currentStepDrums.includes(k.id);
        const b = document.createElement('button');
        b.className = `w-full py-2 px-3 mb-1 border flex justify-between items-center text-[10px] ${isActive ? 'bg-gray-900 border-green-700 text-green-400' : 'bg-transparent border-gray-800 text-gray-500'}`;
        b.innerHTML = `<span>${k.name}</span><div class="w-2 h-2 rounded-full" style="background:${k.color}"></div>`;
        
        b.onclick = () => {
            window.initAudioEngine();
            if(isActive) {
                const idx = currentStepDrums.indexOf(k.id);
                if(idx > -1) currentStepDrums.splice(idx, 1);
            } else {
                currentStepDrums.push(k.id);
                if(window.drumSynth) window.drumSynth.play(k.id, window.audioCtx.currentTime);
            }
            window.updateEditors();
        };
        c.appendChild(b);
    });
}

// --- CLOCK UI ---
window.initPlayClockUI = function() {
    const svg = document.getElementById('play-clock-svg');
    if(!svg) return;
    const steps = 16;
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
};

window.updatePlayClockUI = function(step) {
    const total = 16;
    for(let i=0; i<total; i++) {
        const seg = document.getElementById(`clock-seg-${i}`);
        if(!seg) continue;
        if (i === step) { seg.setAttribute("stroke", "#00ff41"); seg.setAttribute("opacity", "1"); } 
        else if (i < step) { seg.setAttribute("stroke", "#004411"); seg.setAttribute("opacity", "0.5"); } 
        else { seg.setAttribute("stroke", "#222"); seg.setAttribute("opacity", "0.3"); }
    }
};

// --- CONTROL BINDINGS ---
window.setupControlListeners = function() {
    
    // 1. Piano Keys (Touch/Click)
    document.querySelectorAll('.piano-key').forEach(k => {
        const playKey = (e) => {
            e.preventDefault(); // Evitar doble disparo en touch
            window.initAudioEngine();
            
            const note = k.dataset.note;
            const activeId = window.AppState.activeView;
            
            if(activeId === 'drum') return;

            const synth = window.bassSynths.find(s => s.id === activeId);
            if(!synth) return;

            const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
            // Asegurar track
            if(!blk.tracks[activeId]) window.timeMatrix.registerTrack(activeId);
            
            const currentStepData = blk.tracks[activeId][window.AppState.selectedStep];
            
            // Grabar nota
            blk.tracks[activeId][window.AppState.selectedStep] = { 
                note: note, 
                octave: window.AppState.currentOctave, 
                slide: currentStepData ? currentStepData.slide : false, 
                accent: currentStepData ? currentStepData.accent : false 
            };
            
            // Reproducir (Pre-escucha)
            synth.play(note, window.AppState.currentOctave, window.audioCtx.currentTime);
            
            window.updateEditors();
        };

        k.addEventListener('mousedown', playKey);
        k.addEventListener('touchstart', playKey);
    });

    // 2. Modifiers
    const toggleMod = (prop) => {
        if(window.AppState.activeView === 'drum') return;
        const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
        const track = blk.tracks[window.AppState.activeView];
        if(track) {
            const note = track[window.AppState.selectedStep];
            if(note) {
                note[prop] = !note[prop];
                window.updateEditors();
            }
        }
    };
    
    const btnSlide = document.getElementById('btn-toggle-slide');
    if(btnSlide) btnSlide.onclick = () => toggleMod('slide');
    
    const btnAcc = document.getElementById('btn-toggle-accent');
    if(btnAcc) btnAcc.onclick = () => toggleMod('accent');

    // 3. Clear Note
    const btnDel = document.getElementById('btn-delete-note');
    if(btnDel) btnDel.onclick = () => {
        const id = window.AppState.activeView;
        if(id !== 'drum') {
            const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
            if(blk.tracks[id]) {
                blk.tracks[id][window.AppState.selectedStep] = null;
                window.updateEditors();
            }
        }
    };

    // 4. Bind Controls
    bindSynthControls();
};

function bindSynthControls() {
    const updateParam = (param, value) => {
        const s = window.bassSynths.find(sy => sy.id === window.AppState.activeView);
        if(!s) return;

        let finalVal = value;
        // Mapping Cutoff Hz -> % para slider analógico
        if(param === 'cutoff' && value > 100) {
             const min = 100, max = 5000;
             finalVal = ((value - min) / (max - min)) * 100;
        }

        if(param === 'distortion') s.setDistortion(finalVal);
        if(param === 'cutoff') s.setCutoff(finalVal);
        if(param === 'resonance') s.setResonance(finalVal);
        if(param === 'envMod') s.setEnvMod(finalVal);
        if(param === 'decay') s.setDecay(finalVal);
        
        window.syncControlsFromSynth(s.id);
    };

    const bind = (id, param) => {
        const el = document.getElementById(id);
        if(el) el.oninput = (e) => updateParam(param, parseFloat(e.target.value));
    };
    const bindChange = (id, param) => {
        const el = document.getElementById(id);
        if(el) el.onchange = (e) => updateParam(param, parseFloat(e.target.value));
    };

    bind('dist-slider', 'distortion');
    bind('cutoff-slider', 'cutoff');
    bind('res-slider', 'resonance');
    bind('env-slider', 'envMod');
    bind('dec-slider', 'decay');

    bindChange('dist-digital', 'distortion');
    bindChange('cutoff-digital', 'cutoff');
    bindChange('res-digital', 'resonance'); 
    bindChange('env-digital', 'envMod');
    bindChange('dec-digital', 'decay');
}

// Sync UI -> Engine State
window.syncControlsFromSynth = function(viewId) {
    const s = window.bassSynths.find(sy => sy.id === viewId);
    if(!s) return;
    
    const p = s.params;

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if(el) el.value = Math.round(val);
    };

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
    setVal('res-digital', p.resonance); 
    setVal('env-digital', p.envMod);
    setVal('dec-digital', p.decay);
    
    const btnW = document.getElementById('btn-waveform');
    if(btnW) {
        btnW.innerHTML = p.waveform === 'square' 
            ? '<span class="text-xl font-bold leading-none mb-0.5">Π</span><span>SQR</span>' 
            : '<span class="text-xl font-bold leading-none mb-0.5">~</span><span>SAW</span>';
    }
};