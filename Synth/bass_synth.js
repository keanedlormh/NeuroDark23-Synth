/*
 * BASS SYNTH MODULE (Acid Edition)
 * Optimized for Slide (Legato) and Accent emulation.
 */

class BassSynth {
    constructor(id = 'bass-1') {
        this.id = id;
        this.ctx = null;
        this.output = null;
        this.fxChain = null;
        
        // Estado interno para el Portamento (Slide)
        this.lastFreq = 110.0; 
        
        this.params = {
            distortion: 20,
            cutoff: 400,      // Frecuencia base
            resonance: 8,
            envMod: 60,       // Cantidad de envolvente [0-100]
            decay: 40,        // Tiempo de decaimiento [0-100]
            waveform: 'sawtooth'
        };
    }

    init(audioContext, destinationNode) {
        this.ctx = audioContext;
        
        // Main Output
        this.output = this.ctx.createGain();
        this.output.connect(destinationNode);

        // Load FX Chain
        try {
            if (typeof window.BassFXChain !== 'undefined') {
                this.fxChain = new window.BassFXChain(this.ctx);
                this.fxChain.setDistortion(this.params.distortion);
                this.fxChain.connect(this.output);
            }
        } catch (e) {
            console.warn("FX Chain Error", e);
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
        if (!this.ctx) return;

        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;

        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        // --- 1. OSCILADOR ---
        osc.type = this.params.waveform; 
        
        if (!this.lastFreq) this.lastFreq = freq;

        if (slide) {
            osc.frequency.setValueAtTime(this.lastFreq, time);
            osc.frequency.exponentialRampToValueAtTime(freq, time + 0.12);
        } else {
            osc.frequency.setValueAtTime(freq, time);
        }
        
        this.lastFreq = freq;
        osc.detune.setValueAtTime((Math.random() * 6) - 3, time); 

        // --- 2. FILTRO (CRITICAL UPDATE) ---
        filter.type = 'lowpass';
        
        // Base Cutoff (Clamp low end to avoid silence)
        const baseCutoff = Math.max(50, this.params.cutoff);
        filter.frequency.setValueAtTime(baseCutoff, time);
        
        // Resonance
        const currentRes = this.params.resonance;
        filter.Q.value = accent ? Math.min(30, currentRes * 1.5 + 5) : currentRes;
        
        // Envelope Calculation
        // EnvMod: 0-100 -> 0Hz - 5000Hz range added to cutoff
        let envAmountHz = (this.params.envMod / 100) * 4500;
        if (accent) envAmountHz *= 1.5; // Accent boosts envelope height

        // Decay Calculation
        // Decay: 0-100 -> 0.1s - 1.0s
        // Accent usually has fixed decay (short/punchy), but we can adapt
        let decayTimeSec = 0.1 + (this.params.decay / 100) * 0.8;
        if (accent) decayTimeSec = Math.max(0.1, decayTimeSec * 0.6); // Accent is snappier
        
        // Filter Envelope
        const attackTime = slide ? 0.08 : 0.02; // Fast attack
        
        // Envelope peak
        filter.frequency.linearRampToValueAtTime(baseCutoff + envAmountHz, time + attackTime);
        // Envelope decay
        filter.frequency.exponentialRampToValueAtTime(baseCutoff, time + attackTime + decayTimeSec);

        // --- 3. AMPLIFICADOR ---
        const peakGain = accent ? 0.9 : 0.6;

        gain.gain.setValueAtTime(0, time);
        
        if (slide) {
            gain.gain.linearRampToValueAtTime(peakGain, time + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.1, time + duration); // Sustain for slide
        } else {
            gain.gain.linearRampToValueAtTime(peakGain, time + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, time + decayTimeSec); // Amp follows Filter Decay mostly
        }

        // --- RUTEO ---
        osc.connect(filter);
        filter.connect(gain);
        
        if (this.fxChain) {
            gain.connect(this.fxChain.input);
        } else {
            gain.connect(this.output);
        }

        osc.start(time);
        osc.stop(time + duration + 0.2); // Extra release time

        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
            filter.disconnect();
        };
    }
}

window.BassSynth = BassSynth;