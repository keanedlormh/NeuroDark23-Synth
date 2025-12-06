/*
 * BASS SYNTH MODULE (Voice Controller)
 * Orchestrates Oscillator, Filter (via FX), and VCA.
 * Updated for Extended Sustain and Drift.
 */

class BassSynth {
    constructor(id = 'bass-1') {
        this.id = id;
        this.ctx = null;
        this.output = null; // To Master
        this.fxChain = null; // Distortion instance
        
        // Internal State for Portamento
        this.lastFreq = 110.0; 
        
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
        
        // 1. Setup Output & Distortion Chain
        try {
            if (typeof window.BassDistortion !== 'undefined') {
                this.fxChain = new window.BassDistortion(this.ctx);
                this.fxChain.setDistortion(this.params.distortion);
                // Connect FX -> Destination
                this.fxChain.connect(destinationNode);
                // Synth output acts as input for the FX chain
                this.output = this.fxChain.input; 
            } else {
                console.warn("BassDistortion module not loaded. Using bypass.");
                this.output = this.ctx.createGain();
                this.output.connect(destinationNode);
            }
        } catch (e) {
            console.error("Init Error:", e);
        }
    }

    // --- Parameter Setters ---
    setDistortion(val) {
        this.params.distortion = val;
        if (this.fxChain) this.fxChain.setDistortion(val);
    }
    setCutoff(val) { this.params.cutoff = val; }
    setResonance(val) { this.params.resonance = val; }
    setEnvMod(val) { this.params.envMod = val; }
    setDecay(val) { this.params.decay = val; }
    setWaveform(val) { this.params.waveform = val; }

    // --- Voice Generation ---
    play(note, octave, time, duration = 0.25, slide = false, accent = false) {
        if (!this.ctx || !this.output) return;

        // 1. Calculate Frequency
        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;

        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        // 2. Create Nodes
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain(); // VCA
        
        // 3. Setup Oscillator (Pitch & Drift)
        osc.type = this.params.waveform;
        
        // Analog Drift: Slight detune per note for thickness
        const drift = (Math.random() * 4) - 2; 
        osc.detune.setValueAtTime(drift, time);

        // Portamento / Slide Logic
        if (!this.lastFreq) this.lastFreq = freq;

        if (slide) {
            osc.frequency.setValueAtTime(this.lastFreq, time);
            osc.frequency.exponentialRampToValueAtTime(freq, time + 0.1); // Classic 303 glide time
        } else {
            osc.frequency.setValueAtTime(freq, time);
        }
        this.lastFreq = freq;

        // 4. Setup Filter (Delegate to FX Module)
        let filterNode = null;
        let filterDecay = 0.5;

        if (typeof window.BassFilter !== 'undefined') {
            const fResult = window.BassFilter.create(this.ctx, time, this.params, duration, slide, accent);
            filterNode = fResult.node;
            filterDecay = fResult.decayTime;
        } else {
            // Fallback
            filterNode = this.ctx.createBiquadFilter(); 
            filterNode.frequency.value = this.params.cutoff;
        }

        // 5. Setup VCA (Volume Envelope) - EXTENDED TAILS
        // We ensure the VCA stays open long enough for the distortion to "grab" the tail
        const peakGain = accent ? 0.9 : 0.7; // Headroom for distortion
        
        gain.gain.setValueAtTime(0, time);
        
        if (slide) {
            // Legato: Smoother attack, full sustain until next note
            gain.gain.linearRampToValueAtTime(peakGain, time + 0.02);
            gain.gain.setValueAtTime(peakGain, time + duration - 0.05); 
            // Quick fade out at the very end of the step to prevent click
            gain.gain.exponentialRampToValueAtTime(0.01, time + duration);
        } else {
            // Staccato/Normal: Punchy attack, but release depends on Filter Decay
            // This couples the volume decay to the filter decay (classic subtractive synth behavior)
            const releaseTime = Math.max(0.1, filterDecay * 0.8); 
            
            gain.gain.linearRampToValueAtTime(peakGain, time + 0.005); // Snap attack
            // Exponential decay to silence
            gain.gain.exponentialRampToValueAtTime(0.001, time + releaseTime + 0.15); 
        }

        // 6. Connect Graph: OSC -> FILTER -> VCA -> [DISTORTION INPUT]
        // Note: Connecting VCA to Distortion allows the distortion to react to the volume envelope (dynamic saturation)
        osc.connect(filterNode);
        filterNode.connect(gain);
        gain.connect(this.output);

        // 7. Schedule Start/Stop
        osc.start(time);
        
        // Stop time must cover the full release tail to avoid clicking
        // We add extra buffer time (0.5s) to let the filter/reverb tails die out naturally
        osc.stop(time + duration + 0.5); 

        // 8. Garbage Collection
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