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
    lookahead: 0.1,
    interval: 25,
    
    // Inicialización (Lazy Load al primer click)
    init: function() {
        if (this.ctx && this.ctx.state === 'running') return;

        try {
            if (!this.ctx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                this.ctx = new AC({ latencyHint: 'interactive' });
                
                // Master Bus
                const comp = this.ctx.createDynamicsCompressor();
                comp.threshold.value = -2;
                comp.ratio.value = 12;
                
                this.master = this.ctx.createGain();
                this.master.gain.value = 0.7;
                
                this.master.connect(comp);
                comp.connect(this.ctx.destination);

                // Instanciar Batería
                if(typeof window.DrumSynth !== 'undefined') {
                    this.drums = new window.DrumSynth();
                    this.drums.init(this.ctx, this.master);
                }

                // Restaurar/Inicializar Sintes de Bajo
                if(this.synths.length === 0) {
                    this.addSynth('bass-1');
                } else {
                    this.synths.forEach(s => s.init(this.ctx, this.master));
                }

                // Iniciar Worker
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
        
        if(typeof window.BassSynth === 'undefined') {
            console.error("[Audio] BassSynth Class Missing");
            return;
        }

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

    // Secuenciador
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
        // Cola visual
        if(window.UI && window.UI.visualQueue) {
            window.UI.visualQueue.push({ step, block, time });
        }

        const data = window.timeMatrix.getStepData(step, block);
        if(!data) return;

        // Drums
        if(data.drums && this.drums) {
            data.drums.forEach(id => this.drums.play(id, time));
        }

        // Bass
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
    }
};