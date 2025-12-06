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
            cutoff: 800,
            resonance: 8,
            envMod: 60,
            decay: 40,
            waveform: 'sawtooth'
        };
    }

    init(audioContext, destinationNode) {
        this.ctx = audioContext;
        
        // 1. Setup FX Chain
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

    setDistortion(val) {
        this.params.distortion = val;
        if (this.fxChain) this.fxChain.setDistortion(val);
    }
    setCutoff(val) { this.params.cutoff = val; }
    setResonance(val) { this.params.resonance = val; }
    setEnvMod(val) { this.params.envMod = val; }
    setDecay(val) { this.params.decay = val; }
    setWaveform(val) { this.params.waveform = val; }

    play(note, octave, time, duration = 0.25, slide = false, accent = false) {
        if (!this.ctx || !this.output) return;

        // Frecuencia
        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;
        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        // Nodos
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain(); // VCA
        
        // Oscilador
        osc.type = this.params.waveform;
        
        // Portamento (Slide)
        if (!this.lastFreq) this.lastFreq = freq;
        if (slide) {
            osc.frequency.setValueAtTime(this.lastFreq, time);
            osc.frequency.exponentialRampToValueAtTime(freq, time + 0.1); 
        } else {
            osc.frequency.setValueAtTime(freq, time);
        }
        this.lastFreq = freq;

        // Filtro (FX Module)
        let filterNode = null;
        let filterDecay = 0.5;

        if (typeof window.BassFilter !== 'undefined') {
            const fResult = window.BassFilter.create(this.ctx, time, this.params, duration, slide, accent);
            filterNode = fResult.node;
            filterDecay = fResult.decayTime;
        } else {
            filterNode = this.ctx.createBiquadFilter(); 
            filterNode.frequency.value = this.params.cutoff;
        }

        // VCA (Amplifier Envelope)
        // La clave para una buena distorsión es cuánto nivel enviamos
        // Enviamos un nivel un poco más bajo para tener "headroom" y que el circuito de distorsión trabaje dinámicamente
        const peakVol = accent ? 0.8 : 0.6; 
        
        gain.gain.setValueAtTime(0, time);
        
        if (slide) {
            // Legato: Sostenido completo
            gain.gain.linearRampToValueAtTime(peakVol, time + 0.02);
            gain.gain.setValueAtTime(peakVol, time + duration); // Sustain
            gain.gain.linearRampToValueAtTime(0, time + duration + 0.05); // Quick Release
        } else {
            // Staccato: La caída de volumen sigue al filtro para ese sonido "plucky"
            // Importante: Dejamos un poco de cola para que la distorsión "respire"
            const release = Math.max(0.15, filterDecay); 
            
            gain.gain.linearRampToValueAtTime(peakVol, time + 0.005); // Attack rápido
            gain.gain.exponentialRampToValueAtTime(0.001, time + release); // Decay natural
        }

        // Routing: OSC -> FILTER -> VCA -> DISTORTION
        osc.connect(filterNode);
        filterNode.connect(gain);
        gain.connect(this.output);

        osc.start(time);
        osc.stop(time + duration + 1.0); // Margen de seguridad largo

        osc.onended = () => {
            try {
                osc.disconnect();
                gain.disconnect();
                if(filterNode) filterNode.disconnect();
            } catch(e) {}
        };
    }
}

window.BassSynth = BassSynth;