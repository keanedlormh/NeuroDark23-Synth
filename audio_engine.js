/*
 * AUDIO ENGINE MODULE
 * Responsabilidad: AudioContext, Reloj, Secuenciador y Renderizado
 */

// --- GLOBALS (Attached to window for access across files) ---
window.audioCtx = null;
window.masterGain = null;
window.clockWorker = null;
window.bassSynths = []; // Array central de sintetizadores
window.drumSynth = null; // Instancia única de batería

// Engine Vars
let nextNoteTime = 0.0;
const LOOKAHEAD = 0.1;
const INTERVAL = 25;

// --- INITIALIZATION ---
window.initAudioEngine = function() {
    if(window.audioCtx && window.audioCtx.state === 'running') return;

    try {
        if(!window.audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            window.audioCtx = new AC({ latencyHint: 'interactive' });
            
            // Master Bus (Compresión/Limiting suave)
            const comp = window.audioCtx.createDynamicsCompressor();
            comp.threshold.value = -2.0;
            comp.ratio.value = 12;
            comp.attack.value = 0.003;
            comp.release.value = 0.25;
            
            window.masterGain = window.audioCtx.createGain();
            window.masterGain.gain.value = 0.7;
            
            window.masterGain.connect(comp);
            comp.connect(window.audioCtx.destination);

            // Re-conectar sintetizadores existentes si hubo un reinicio
            if(window.bassSynths) {
                window.bassSynths.forEach(s => s.init(window.audioCtx, window.masterGain));
            }
            
            // Inicializar Batería
            if(typeof window.DrumSynth !== 'undefined') {
                window.drumSynth = new window.DrumSynth();
                window.drumSynth.init(window.audioCtx, window.masterGain);
            }

            // Inicializar Worker del Reloj
            if(!window.clockWorker) {
                try {
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
        }
        if(window.audioCtx.state === 'suspended') window.audioCtx.resume();
        
    } catch(e) {
        console.error("[AudioEngine] Init Fail:", e);
    }
};

// --- SEQUENCER CORE ---
window.scheduler = function() {
    while(nextNoteTime < window.audioCtx.currentTime + LOOKAHEAD) {
        scheduleNote(window.AppState.currentPlayStep, window.AppState.currentPlayBlock, nextNoteTime);
        advanceNote();
    }
};

function advanceNote() {
    const secPerBeat = 60.0 / window.AppState.bpm;
    const secPerStep = secPerBeat / 4; // 16th notes
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
    // 1. Enviar evento visual a la cola (para que UI.js lo dibuje)
    if(window.visualQueue) window.visualQueue.push({ step, block, time });
    
    // 2. Obtener datos de la matriz
    const data = window.timeMatrix.getStepData(step, block);
    
    // 3. Disparar Batería
    if(data.drums && window.drumSynth) {
        data.drums.forEach(id => window.drumSynth.play(id, time));
    }
    
    // 4. Disparar Bajos
    if(data.tracks) {
        Object.keys(data.tracks).forEach(trackId => {
            const noteData = data.tracks[trackId][step];
            if(noteData) {
                // Buscar el sinte correspondiente por ID
                const synth = window.bassSynths.find(s => s.id === trackId);
                if(synth) {
                    synth.play(
                        noteData.note, 
                        noteData.octave, 
                        time, 
                        0.25, // Duración base
                        noteData.slide, 
                        noteData.accent
                    );
                }
            }
        });
    }
}

// --- TRANSPORT CONTROL ---
window.toggleTransport = function() {
    window.initAudioEngine(); // Asegurar contexto activo
    
    window.AppState.isPlaying = !window.AppState.isPlaying;
    const btn = document.getElementById('btn-play');
    
    if(window.AppState.isPlaying) {
        // PLAY
        if(btn) {
            btn.innerHTML = "&#10074;&#10074;"; // Pause icon
            btn.classList.add('border-green-500', 'text-green-500');
        }
        
        // Reset de posición
        window.AppState.currentPlayStep = 0;
        window.AppState.currentPlayBlock = window.AppState.editingBlock;
        nextNoteTime = window.audioCtx.currentTime + 0.05;
        window.visualQueue = [];
        
        if(window.clockWorker) window.clockWorker.postMessage("start");
        window.startVisualLoop(); // Iniciar loop visual en user_interface.js
        
    } else {
        // STOP
        if(btn) {
            btn.innerHTML = "&#9658;"; // Play icon
            btn.classList.remove('border-green-500', 'text-green-500');
        }
        
        if(window.clockWorker) window.clockWorker.postMessage("stop");
        
        // Reset visuales
        if(window.timeMatrix) window.timeMatrix.highlightPlayingStep(-1);
        window.updatePlayClockUI(-1); // Función en user_interface.js
    }
};

// --- EXPORT FUNCTION ---
window.renderAudioWav = async function() {
    if(window.AppState.isPlaying) window.toggleTransport();
    
    console.log("Rendering...");
    const btn = document.getElementById('btn-start-render');
    if(btn) { btn.innerText = "WAIT..."; btn.disabled = true; }

    try {
        const stepsPerBlock = window.timeMatrix.totalSteps;
        const totalBlocks = window.timeMatrix.blocks.length;
        const secPerStep = (60.0 / window.AppState.bpm) / 4;
        const totalSteps = stepsPerBlock * totalBlocks * window.AppState.exportReps;
        const duration = totalSteps * secPerStep + 2.0; // +2s para colas de reverb/delay

        // Contexto Offline (Rápido)
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offCtx = new OfflineCtx(2, 44100 * duration, 44100);
        
        const offMaster = offCtx.createGain();
        offMaster.gain.value = 0.6;
        offMaster.connect(offCtx.destination);

        // Replicar sintetizadores en el contexto offline
        const offBassSynths = [];
        window.bassSynths.forEach(ls => {
            const s = new window.BassSynth(ls.id);
            s.init(offCtx, offMaster);
            // Copiar parámetros
            s.params = { ...ls.params }; 
            // IMPORTANTE: Sincronizar el FX interno si existe
            if(s.fxChain) s.setDistortion(ls.params.distortion); 
            offBassSynths.push(s);
        });
        
        const offDrum = new window.DrumSynth();
        offDrum.init(offCtx, offMaster);

        // Secuenciar offline
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

        // Renderizar
        const renderedBuffer = await offCtx.startRendering();
        const wav = audioBufferToWav(renderedBuffer);
        const url = URL.createObjectURL(wav);
        
        // Descargar
        const a = document.createElement('a');
        a.href = url;
        a.download = `NeuroDark_Render_${Date.now()}.wav`;
        a.click();
        
        if(window.toggleExportModal) window.toggleExportModal();

    } catch(e) {
        console.error("Render Error:", e);
        alert("Render Error: " + e);
    } finally {
        if(btn) { btn.innerText = "RENDER"; btn.disabled = false; }
    }
};

// Helper WAV Encoder
function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const length = buffer.length * numChannels * 2 + 44;
    const arr = new ArrayBuffer(length);
    const view = new DataView(arr);
    const channels = [];
    let offset = 0;
    let pos = 0;

    // Header WAV
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + buffer.length * 2 * numChannels, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2 * numChannels, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, buffer.length * 2 * numChannels, true);

    for(let i = 0; i < numChannels; i++) channels.push(buffer.getChannelData(i));

    pos = 44;
    while(pos < length) {
        for(let i = 0; i < numChannels; i++) {
            let sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0;
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        offset++;
    }
    return new Blob([arr], { type: 'audio/wav' });
}
function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}