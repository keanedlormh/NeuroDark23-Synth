/*
 * BASS SYNTH MODULE (Voice Controller)
 * Orchestrates Oscillator, Filter (via FX), and VCA.
 */

class BassSynth {
    constructor(id = 'bass-1') {
        this.id = id;
        this.ctx = null;
        this.output = null; 
        this.fxChain = null; 
        this.lastFreq = 0;
        
        this.params = {
            distortion: 20,
            cutoff: 40,
            resonance: 8,
            envMod: 60,
            decay: 40,
            waveform: 'sawtooth'
        };
    }

    init(audioContext, destinationNode) {
        this.ctx = audioContext;
        
        // Setup Distortion Chain
        if (typeof window.BassDistortion !== 'undefined') {
            this.fxChain = new window.BassDistortion(this.ctx);
            this.fxChain.setDistortion(this.params.distortion);
            this.fxChain.connect(destinationNode);
            this.output = this.fxChain.input; 
        } else {
            this.output = this.ctx.createGain();
            this.output.connect(destinationNode);
        }
    }

    // --- Params ---
    setDistortion(val) { this.params.distortion = val; if(this.fxChain) this.fxChain.setDistortion(val); }
    setCutoff(val) { this.params.cutoff = val; }
    setResonance(val) { this.params.resonance = val; }
    setEnvMod(val) { this.params.envMod = val; }
    setDecay(val) { this.params.decay = val; }
    setWaveform(val) { this.params.waveform = val; }

    play(note, octave, time, duration = 0.25, slide = false, accent = false) {
        if (!this.ctx || !this.output) return;

        // 1. Frequency
        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;
        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        // 2. Nodes
        const osc = this.ctx.createOscillator();
        const vca = this.ctx.createGain();
        
        // 3. Oscillator
        osc.type = this.params.waveform;
        // Drift analógico: +/- 3 cents de desafinación aleatoria
        osc.detune.value = (Math.random() * 6) - 3; 

        // 4. Portamento
        if (!this.lastFreq) this.lastFreq = freq;
        if (slide) {
            osc.frequency.setValueAtTime(this.lastFreq, time);
            osc.frequency.exponentialRampToValueAtTime(freq, time + 0.1); 
        } else {
            osc.frequency.setValueAtTime(freq, time);
        }
        this.lastFreq = freq;

        // 5. Filter (FX Module)
        let filterNode = null;
        let filterDecay = 0.5;

        if (typeof window.BassFilter !== 'undefined') {
            const fResult = window.BassFilter.create(this.ctx, time, this.params, duration, slide, accent);
            filterNode = fResult.node;
            filterDecay = fResult.decayTime;
        } else {
            filterNode = this.ctx.createBiquadFilter();
            filterNode.frequency.value = 1000; 
        }

        // 6. VCA (Volume Envelope)
        // El volumen debe alimentar la distorsión correctamente.
        // Si es muy alto, la distorsión satura demasiado pronto.
        // Si es muy bajo, no satura.
        const peakVol = accent ? 0.9 : 0.7; 
        
        vca.gain.setValueAtTime(0, time);
        
        if (slide) {
            // Legato
            vca.gain.linearRampToValueAtTime(peakVol, time + 0.02);
            vca.gain.setValueAtTime(peakVol, time + duration);
            vca.gain.linearRampToValueAtTime(0, time + duration + 0.05);
        } else {
            // Staccato
            vca.gain.linearRampToValueAtTime(peakVol, time + 0.005);
            
            // Release: Vinculado al filtro.
            // Si el filtro es corto, el volumen baja rápido.
            // Si el filtro es largo, el volumen acompaña para oír la resonancia.
            const releaseTime = Math.max(0.2, filterDecay); 
            
            // Caída exponencial suave
            vca.gain.setTargetAtTime(0, time + 0.05, releaseTime / 4);
        }

        // 7. Routing: OSC -> FILTER -> VCA -> [DISTORTION INPUT]
        osc.connect(filterNode);
        filterNode.connect(vca);
        vca.connect(this.output); 

        // 8. Lifecycle
        osc.start(time);
        osc.stop(time + duration + 2.0); // Dejamos tiempo de sobra para colas de efectos

        osc.onended = () => {
            try {
                osc.disconnect();
                vca.disconnect();
                filterNode.disconnect();
            } catch(e) {}
        };
    }
}

window.BassSynth = BassSynth;