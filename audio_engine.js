/*
 * AUDIO ENGINE MODULE
 * Namespace: window.AudioEngine
 */

window.AudioEngine = {
    ctx: null,
    master: null,
    worker: null,
    synths: [],
    drums: null,
    nextNoteTime: 0.0,
    lookahead: 0.15,
    interval: 25,
    
    // Inicialización de Datos (antes del click)
    initData: function() {
        if(this.synths.length === 0) {
            this.addSynth('bass-1');
        }
    },

    // Inicialización de Audio (después del click)
    init: function() {
        if (this.ctx && this.ctx.state === 'running') return;

        try {
            if (!this.ctx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                this.ctx = new AC({ latencyHint: 'interactive' });
                
                // Master Bus
                const comp = this.ctx.createDynamicsCompressor();
                comp.threshold.value = -2;
                comp.ratio.value = 8;
                
                this.master = this.ctx.createGain();
                this.master.gain.value = 0.7;
                
                this.master.connect(comp);
                comp.connect(this.ctx.destination);

                // Drums
                if(typeof window.DrumSynth !== 'undefined') {
                    this.drums = new window.DrumSynth();
                    this.drums.init(this.ctx, this.master);
                }

                // Bass Synths
                this.synths.forEach(s => s.init(this.ctx, this.master));

                this.initWorker();
                console.log("[Audio] Engine Started");
            }
            if (this.ctx.state === 'suspended') this.ctx.resume();
        } catch (e) {
            console.error("[Audio] Init Error:", e);
        }
    },

    initWorker: function() {
        if(this.worker) return;
        try {
            this.worker = new Worker('Synth/clock_worker.js');
            this.worker.onmessage = (e) => {
                if (e.data === "tick") this.scheduler();
            };
            this.worker.postMessage({ interval: this.interval });
        } catch(e) {
            console.error("[Audio] Worker Failed:", e);
        }
    },

    addSynth: function(id) {
        if(this.synths.find(s => s.id === id)) return;
        const s = new window.BassSynth(id);
        if(this.ctx) s.init(this.ctx, this.master);
        this.synths.push(s);
        return s;
    },

    removeSynth: function(id) {
        if(this.synths.length <= 1) return false;
        const idx = this.synths.findIndex(s => s.id === id);
        if(idx > -1) {
            this.synths.splice(idx, 1);
            return true;
        }
        return false;
    },

    getSynth: function(id) {
        return this.synths.find(s => s.id === id);
    },

    scheduler: function() {
        while (this.nextNoteTime < this.ctx.currentTime + this.lookahead) {
            this.scheduleNote(window.AppState.currentPlayStep, window.AppState.currentPlayBlock, this.nextNoteTime);
            this.advanceNote();
        }
    },

    advanceNote: function() {
        const secPerBeat = 60.0 / window.AppState.bpm;
        const secPerStep = secPerBeat / 4;
        this.nextNoteTime += secPerStep;
        
        window.AppState.currentPlayStep++;
        if (window.AppState.currentPlayStep >= window.timeMatrix.totalSteps) {
            window.AppState.currentPlayStep = 0;
            window.AppState.currentPlayBlock++;
            if (window.AppState.currentPlayBlock >= window.timeMatrix.blocks.length) {
                window.AppState.currentPlayBlock = 0;
            }
        }
    },

    scheduleNote: function(step, block, time) {
        if(window.UI && window.UI.visualQueue) {
            window.UI.visualQueue.push({ step, block, time });
        }

        const data = window.timeMatrix.getStepData(step, block);
        if(!data) return;

        if(data.drums && this.drums) {
            data.drums.forEach(id => this.drums.play(id, time));
        }

        if(data.tracks) {
            Object.keys(data.tracks).forEach(tid => {
                const note = data.tracks[tid][step];
                if(note) {
                    const s = this.getSynth(tid);
                    if(s) s.play(note.note, note.octave, time, 0.25, note.slide, note.accent);
                }
            });
        }
    },

    start: function() {
        this.init();
        this.nextNoteTime = this.ctx.currentTime + 0.05;
        if(this.worker) this.worker.postMessage("start");
    },

    stop: function() {
        if(this.worker) this.worker.postMessage("stop");
    },

    // --- EXPORT FUNCTION ---
    renderWav: async function() {
        if(window.AppState.isPlaying) window.Main.togglePlay();
        
        const btn = document.getElementById('btn-start-render');
        if(btn) { btn.innerText = "RENDERING..."; btn.disabled = true; }

        try {
            const steps = window.timeMatrix.totalSteps;
            const blocks = window.timeMatrix.blocks.length;
            const reps = window.AppState.exportReps;
            const secondsPerStep = (60 / window.AppState.bpm) / 4;
            const duration = steps * blocks * reps * secondsPerStep + 2.0;

            const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            const oCtx = new OfflineCtx(2, 44100 * duration, 44100);
            
            const oMaster = oCtx.createGain();
            oMaster.gain.value = 0.6;
            oMaster.connect(oCtx.destination);

            // Clonar Sintes
            const oSynths = [];
            this.synths.forEach(src => {
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
                        // Drums
                        if(blk.drums && blk.drums[s]) blk.drums[s].forEach(d => oDrums.play(d, t));
                        // Bass
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
            const wav = this.bufferToWav(buffer);
            const url = URL.createObjectURL(wav);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ND23_Render_${Date.now()}.wav`;
            a.click();
            
            if(window.UI) window.UI.toggleExportModal();

        } catch(e) {
            console.error("Render Error", e);
            alert("Render Failed");
        } finally {
            if(btn) { btn.innerText = "RENDER"; btn.disabled = false; }
        }
    },

    bufferToWav: function(abuffer) {
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
};