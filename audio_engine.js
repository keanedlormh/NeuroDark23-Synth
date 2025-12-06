/*
 * AUDIO ENGINE MODULE
 * Handles: AudioContext, Clock Worker, Sequencing Logic
 */

// Global vars needed for engine
let audioCtx = null;
let masterGain = null;
let clockWorker = null;
let bassSynths = [];

let nextNoteTime = 0.0;
const LOOKAHEAD = 0.1;
const INTERVAL = 25;

// --- ENGINE INITIALIZATION ---
function initEngine() {
    if(audioCtx && audioCtx.state === 'running') return;
    try {
        if(!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AC({ latencyHint: 'interactive' });
            
            // Master Dynamics (Limiter)
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -1.0;
            comp.knee.value = 30;
            comp.ratio.value = 12;
            comp.attack.value = 0.003;
            comp.release.value = 0.25;
            
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.7;
            
            masterGain.connect(comp);
            comp.connect(audioCtx.destination);

            // Re-init synths with new context
            if(window.bassSynths) {
                window.bassSynths.forEach(s => s.init(audioCtx, masterGain));
            }
            if(window.drumSynth) window.drumSynth.init(audioCtx, masterGain);

            // CLOCK WORKER
            if(!clockWorker) {
                try {
                    clockWorker = new Worker('Synth/clock_worker.js'); 
                    clockWorker.onmessage = (e) => { 
                        if(e.data === "tick") scheduler(); 
                    };
                    clockWorker.postMessage({interval: INTERVAL});
                    window.logToScreen("Clock Worker: OK");
                } catch(e) { window.logToScreen("Worker Err: " + e, 'error'); }
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

// --- SEQUENCER LOGIC ---
function nextNote() {
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
    // Push to visual queue for UI to consume
    if(window.visualQueue) window.visualQueue.push({ step, block, time });
    
    const data = window.timeMatrix.getStepData(step, block);
    
    // Drums
    if(data.drums && window.drumSynth) {
        data.drums.forEach(id => window.drumSynth.play(id, time));
    }
    
    // Bass
    if(data.tracks) {
        Object.keys(data.tracks).forEach(tid => {
            const n = data.tracks[tid][step];
            if(n) {
                const s = window.bassSynths.find(sy => sy.id === tid);
                if(s) s.play(n.note, n.octave, time, 0.25, n.slide, n.accent);
            }
        });
    }
}

function scheduler() {
    while(nextNoteTime < audioCtx.currentTime + LOOKAHEAD) {
        scheduleNote(AppState.currentPlayStep, AppState.currentPlayBlock, nextNoteTime);
        nextNote();
    }
}

// --- EXPORT RENDERER ---
async function renderAudio() {
    if(AppState.isPlaying) toggleTransport();
    window.logToScreen("Rendering WAV...");
    const btn = document.getElementById('btn-start-render');
    if(btn) { btn.innerText = "WAIT..."; btn.disabled = true; }

    try {
        const stepsPerBlock = window.timeMatrix.totalSteps;
        const totalBlocks = window.timeMatrix.blocks.length;
        const secPerStep = (60.0 / AppState.bpm) / 4;
        const totalSteps = stepsPerBlock * totalBlocks * AppState.exportReps;
        const duration = totalSteps * secPerStep + 2.0;

        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offCtx = new OfflineCtx(2, 44100 * duration, 44100);
        
        const offMaster = offCtx.createGain();
        offMaster.gain.value = 0.6;
        offMaster.connect(offCtx.destination);

        // Offline Instances
        const offBass = [];
        window.bassSynths.forEach(ls => {
            const s = new window.BassSynth(ls.id);
            s.init(offCtx, offMaster);
            s.setDistortion(ls.params.distortion);
            s.setCutoff(ls.params.cutoff);
            s.setResonance(ls.params.resonance);
            s.setEnvMod(ls.params.envMod);
            s.setDecay(ls.params.decay);
            s.setWaveform(ls.params.waveform);
            offBass.push(s);
        });
        const offDrum = new DrumSynth();
        offDrum.init(offCtx, offMaster);

        let t = 0.0;
        for(let r=0; r<AppState.exportReps; r++) {
            for(let b=0; b<totalBlocks; b++) {
                const blk = window.timeMatrix.blocks[b];
                for(let s=0; s<stepsPerBlock; s++) {
                    if(blk.drums[s]) blk.drums[s].forEach(id=>offDrum.play(id, t));
                    if(blk.tracks) Object.keys(blk.tracks).forEach(tid => {
                        const n = blk.tracks[tid][s];
                        if(n) {
                            const syn = offBass.find(k=>k.id===tid);
                            if(syn) syn.play(n.note, n.octave, t, 0.25, n.slide, n.accent);
                        }
                    });
                    t += secPerStep;
                }
            }
        }

        const buf = await offCtx.startRendering();
        const wav = bufferToWave(buf, buf.length);
        const url = URL.createObjectURL(wav);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ND23_Render_${Date.now()}.wav`;
        a.click();
        window.logToScreen("Download Ready!");
        window.toggleExportModal();

    } catch(e) { window.logToScreen("Render Err: "+e, 'error'); }
    finally { if(btn) { btn.innerText = "RENDER"; btn.disabled = false; } }
}

function bufferToWave(abuffer, len) {
    let numOfChan = abuffer.numberOfChannels,
        length = len * numOfChan * 2 + 44,
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