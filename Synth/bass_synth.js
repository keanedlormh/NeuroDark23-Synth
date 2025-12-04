/*
 * BASS SYNTH MODULE (With FX Chain & Accent/Slide)
 */

class BassSynth {
    constructor(id = 'bass-1') {
        this.id = id;
        this.ctx = null;
        this.output = null;
        this.fxChain = null;
        
        // Internal State for Slides
        this.lastFreq = 0;
        
        this.params = {
            distortion: 20,
            cutoff: 800,
            resonance: 4
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

        // --- OSCILLATOR ---
        osc.type = 'sawtooth';
        
        if (slide && this.lastFreq > 0) {
            // Slide: Start from previous frequency
            osc.frequency.setValueAtTime(this.lastFreq, time);
            osc.frequency.linearRampToValueAtTime(freq, time + 0.1); // Glide time
        } else {
            // No Slide: Start instant
            osc.frequency.setValueAtTime(freq, time);
        }
        
        // Store for next step
        this.lastFreq = freq;
        
        osc.detune.setValueAtTime((Math.random() * 8) - 4, time); 

        // --- FILTER ---
        filter.type = 'lowpass';
        const baseCutoff = this.params.cutoff;
        filter.frequency.setValueAtTime(baseCutoff, time);
        
        // ACCENT: More Resonance & Filter Envelope
        filter.Q.value = accent ? this.params.resonance * 1.5 : this.params.resonance;
        const envAmount = accent ? 2000 : 1000;

        const attackTime = slide ? 0.05 : 0.05; 
        const decayTime = duration;
        
        // Filter Envelope
        filter.frequency.linearRampToValueAtTime(baseCutoff + envAmount, time + attackTime);
        filter.frequency.exponentialRampToValueAtTime(baseCutoff, time + attackTime + decayTime);

        // --- AMPLIFIER (VCA) ---
        // ACCENT: Higher Volume
        const peakGain = accent ? 0.8 : 0.5;

        gain.gain.setValueAtTime(0, time);
        if (slide) {
             // Slide Legato: Attack is faster/immediate
            gain.gain.linearRampToValueAtTime(peakGain, time + 0.01);
        } else {
            gain.gain.linearRampToValueAtTime(peakGain, time + 0.02);
        }
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

        // --- ROUTING ---
        osc.connect(filter);
        filter.connect(gain);
        
        if (this.fxChain) {
            gain.connect(this.fxChain.input);
        } else {
            gain.connect(this.output);
        }

        osc.start(time);
        osc.stop(time + duration + 0.1);

        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
            filter.disconnect();
        };
    }
}

window.BassSynth = BassSynth;