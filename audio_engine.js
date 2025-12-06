/*
 * AUDIO ENGINE MODULE (Global Access Architecture)
 * Responsabilidad: Contexto de Audio, Reloj, Secuenciación y Renderizado
 */

// --- GLOBAL STATE INITIALIZATION ---
window.audioCtx = null;
window.masterGain = null;
window.clockWorker = null;
window.bassSynths = window.bassSynths || []; // Preservar si ya existe
window.drumSynth = null; 

// Variables internas del motor
let nextNoteTime = 0.0;
const LOOKAHEAD = 0.1;
const INTERVAL = 25;

// --- AUDIO CONTEXT BOOTSTRAP ---
window.initAudioEngine = function() {
    if(window.audioCtx && window.audioCtx.state === 'running') return;

    try {
        if(!window.audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            window.audioCtx = new AC({ latencyHint: 'interactive' });
            
            // Master Bus: Compresión suave para "pegar" la mezcla
            const comp = window.audioCtx.createDynamicsCompressor();
            comp.threshold.value = -2.0;
            comp.ratio.value = 8;
            comp.attack.value = 0.005;
            comp.release.value = 0.1;
            
            window.masterGain = window.audioCtx.createGain();
            window.masterGain.gain.value = 0.7; // Headroom
            
            window.masterGain.connect(comp);
            comp.connect(window.audioCtx.destination);

            // Reinicializar sintes existentes con el nuevo contexto
            if(window.bassSynths.length > 0) {
                window.bassSynths.forEach(s => s.init(window.audioCtx, window.masterGain));
            }
            
            // Inicializar Batería
            if(typeof window.DrumSynth !== 'undefined') {
                window.drumSynth = new window.DrumSynth();
                window.drumSynth.init(window.audioCtx, window.masterGain);
            }

            // Iniciar Clock Worker
            initClockWorker();
        }
        
        if(window.audioCtx.state === 'suspended') {
            window.audioCtx.resume();
        }
        
    } catch(e) {
        console.error("[AudioEngine] Init Fail:", e);
    }
};

function initClockWorker() {
    if(window.clockWorker) return;
    try {
        // Ruta relativa crítica: Synth/clock_worker.js
        window.clockWorker = new Worker('Synth/clock_worker.js');
        window.clockWorker.onmessage = (e) => { 
            if(e.data === "tick") window.scheduler(); 
        };
        window.clockWorker.postMessage({interval: INTERVAL});
        console.log("[AudioEngine] Clock Worker Started");
    } catch(e) {
        console.error("[AudioEngine] Worker Error:", e);
    }
}

window.globalUnlock = function() {
    window.initAudioEngine();
    if(window.audioCtx && window.audioCtx.state === 'running') {
        document.removeEventListener('click', window.globalUnlock);
        document.removeEventListener('touchstart', window.globalUnlock);
    }
};

// --- SEQUENCER CORE ---
window.scheduler = function() {
    // Programar notas pendientes dentro de la ventana de lookahead
    while(nextNoteTime < window.audioCtx.currentTime + LOOKAHEAD) {
        scheduleNote(window.AppState.currentPlayStep, window.AppState.currentPlayBlock, nextNoteTime);
        advanceNote();
    }
};

function advanceNote() {
    const secPerBeat = 60.0 / window.AppState.bpm;
    const secPerStep = secPerBeat / 4; // Semicorcheas (1/16)
    nextNoteTime += secPerStep;
    
    window.AppState.currentPlayStep++;
    if(window.AppState.currentPlayStep >= window.timeMatrix.totalSteps) {
        window.AppState.currentPlayStep = 0;
        window.AppState.currentPlayBlock++;
        if(window.AppState.currentPlayBlock >= window.timeMatrix.blocks.length) {
            window.AppState.currentPlayBlock = 0;
        }
    }
}

function scheduleNote(step, block, time) {
    // 1. Enviar evento a la cola visual (UI consume esto)
    if(window.visualQueue) window.visualQueue.push({ step, block, time });
    
    // 2. Obtener datos
    const data = window.timeMatrix.getStepData(step, block);
    if(!data) return;

    // 3. Drums
    if(data.drums && window.drumSynth) {
        data.drums.forEach(id => window.drumSynth.play(id, time));
    }
    
    // 4. Bass Synths
    if(data.tracks) {
        Object.keys(data.tracks).forEach(trackId => {
            const noteData = data.tracks[trackId][step];
            if(noteData) {
                const synth = window.bassSynths.find(s => s.id === trackId);
                if(synth) {
                    synth.play(
                        noteData.note, 
                        noteData.octave, 
                        time, 
                        0.25, 
                        noteData.slide, 
                        noteData.accent
                    );
                }
            }
        });
    }
}

// --- TRANSPORT ---
window.toggleTransport = function() {
    window.initAudioEngine();
    
    window.AppState.isPlaying = !window.AppState.isPlaying;
    const btn = document.getElementById('btn-play');
    
    if(window.AppState.isPlaying) {
        // START
        if(btn) {
            btn.innerHTML = "&#10074;&#10074;"; 
            btn.classList.add('border-green-500', 'text-green-500');
        }
        
        // Reset posición
        window.AppState.currentPlayStep = 0;
        window.AppState.currentPlayBlock = window.AppState.editingBlock;
        nextNoteTime = window.audioCtx.currentTime + 0.05; // Pequeño delay inicial
        window.visualQueue = [];
        
        if(window.clockWorker) window.clockWorker.postMessage("start");
        window.startVisualLoop(); // Inicia el rAF en UI
        
    } else {
        // STOP
        if(btn) {
            btn.innerHTML = "&#9658;"; 
            btn.classList.remove('border-green-500', 'text-green-500');
        }
        
        if(window.clockWorker) window.clockWorker.postMessage("stop");
        
        // Reset UI
        if(window.timeMatrix) window.timeMatrix.highlightPlayingStep(-1);
        window.updatePlayClockUI(-1);
    }
};

// --- EXPORT RENDERER (WAV) ---
window.renderAudioWav = async function() {
    if(window.AppState.isPlaying) window.toggleTransport();
    
    const btn = document.getElementById('btn-start-render');
    if(btn) { btn.innerText = "PROCESSING..."; btn.disabled = true; }

    try {
        // Configuración Offline
        const stepsPerBlock = window.timeMatrix.totalSteps;
        const totalBlocks = window.timeMatrix.blocks.length;
        const secPerStep = (60.0 / window.AppState.bpm) / 4;
        const totalSteps = stepsPerBlock * totalBlocks * window.AppState.exportReps;
        const duration = totalSteps * secPerStep + 2.0;

        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offCtx = new OfflineCtx(2, 44100 * duration, 44100);
        
        const offMaster = offCtx.createGain();
        offMaster.gain.value = 0.6;
        offMaster.connect(offCtx.destination);

        // Clonar Sintes para Render
        const offBassSynths = [];
        window.bassSynths.forEach(ls => {
            const s = new window.BassSynth(ls.id);
            s.init(offCtx, offMaster);
            // Copia profunda de parámetros para el render
            s.params = JSON.parse(JSON.stringify(ls.params));
            // Sincronizar FX interno
            if(s.fxChain) s.setDistortion(ls.params.distortion);
            offBassSynths.push(s);
        });
        
        const offDrum = new window.DrumSynth();
        offDrum.init(offCtx, offMaster);

        // Secuenciación Offline
        let t = 0.0;
        for(let r=0; r<window.AppState.exportReps; r++) {
            for(let b=0; b<totalBlocks; b++) {
                const blk = window.timeMatrix.blocks[b];
                for(let s=0; s<stepsPerBlock; s++) {
                    // Drums
                    if(blk.drums && blk.drums[s]) {
                        blk.drums[s].forEach(id => offDrum.play(id, t));
                    }
                    // Bass
                    if(blk.tracks) {
                        Object.keys(blk.tracks).forEach(tid => {
                            const n = blk.tracks[tid][s];
                            if(n) {
                                const syn = offBassSynths.find(k=>k.id===tid);
                                if(syn) syn.play(n.note, n.octave, t, 0.25, n.slide, n.accent);
                            }
                        });
                    }
                    t += secPerStep;
                }
            }
        }

        // Render & Download
        const renderedBuffer = await offCtx.startRendering();
        const wav = audioBufferToWav(renderedBuffer);
        const url = URL.createObjectURL(wav);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `ND23_Render_${Date.now()}.wav`;
        a.click();
        
        if(window.toggleExportModal) window.toggleExportModal();

    } catch(e) {
        console.error("Render Error:", e);
        alert("Render Failed: " + e);
    } finally {
        if(btn) { btn.innerText = "RENDER WAV"; btn.disabled = false; }
    }
};

// WAV Helper
function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const length = buffer.length * numChannels * 2 + 44;
    const arr = new ArrayBuffer(length);
    const view = new DataView(arr);
    let pos = 0;

    function writeString(s) { for (let i=0; i<s.length; i++) view.setUint8(pos++, s.charCodeAt(i)); }
    function write32(n) { view.setUint32(pos, n, true); pos+=4; }
    function write16(n) { view.setUint16(pos, n, true); pos+=2; }

    writeString('RIFF'); write32(36 + buffer.length * 2 * numChannels); writeString('WAVE');
    writeString('fmt '); write32(16); write16(1); write16(numChannels);
    write32(buffer.sampleRate); write32(buffer.sampleRate * 2 * numChannels);
    write16(numChannels * 2); write16(16); writeString('data');
    write32(buffer.length * 2 * numChannels);

    const channels = [];
    for(let i=0; i<numChannels; i++) channels.push(buffer.getChannelData(i));

    let offset = 0;
    while(offset < buffer.length) {
        for(let i=0; i<numChannels; i++) {
            let s = Math.max(-1, Math.min(1, channels[i][offset]));
            s = (s < 0 ? s * 0x8000 : s * 0x7FFF) | 0;
            view.setInt16(pos, s, true); pos+=2;
        }
        offset++;
    }
    return new Blob([arr], { type: 'audio/wav' });
}