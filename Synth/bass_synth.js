/*
 * BASS SYNTH MODULE (Voice Controller)
 * Orchestrates Oscillator, Filter (via FX), and VCA.
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
            cutoff: 400,
            resonance: 8,
            envMod: 60,
            decay: 40,
            waveform: 'sawtooth'
        };
    }

    init(audioContext, destinationNode) {
        this.ctx = audioContext;
        
        // 1. Setup Output & Distortion
        try {
            if (typeof window.BassDistortion !== 'undefined') {
                this.fxChain = new window.BassDistortion(this.ctx);
                this.fxChain.setDistortion(this.params.distortion);
                // Connect FX -> Destination
                this.fxChain.connect(destinationNode);
                // Synth output is FX Input
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
        const gain = this.ctx.createGain();
        
        // 3. Setup Oscillator (Pitch & Slide Logic)
        osc.type = this.params.waveform;
        if (!this.lastFreq) this.lastFreq = freq;

        if (slide) {
            osc.frequency.setValueAtTime(this.lastFreq, time);
            osc.frequency.exponentialRampToValueAtTime(freq, time + 0.12); // Portamento Glide
        } else {
            osc.frequency.setValueAtTime(freq, time);
        }
        this.lastFreq = freq;
        osc.detune.setValueAtTime((Math.random() * 6) - 3, time); // Analog drift

        // 4. Setup Filter (Delegate to FX Module)
        let filterNode = null;
        let filterDecay = 0.5;

        if (typeof window.BassFilter !== 'undefined') {
            const fResult = window.BassFilter.create(this.ctx, time, this.params, duration, slide, accent);
            filterNode = fResult.node;
            filterDecay = fResult.decayTime;
        } else {
            // Fallback if FX module missing
            filterNode = this.ctx.createBiquadFilter(); 
            filterNode.frequency.value = this.params.cutoff;
        }

        // 5. Setup VCA (Volume Envelope)
        const peakGain = accent ? 0.9 : 0.6;
        gain.gain.setValueAtTime(0, time);
        
        if (slide) {
            // Legato Mode: Fast attack, higher sustain
            gain.gain.linearRampToValueAtTime(peakGain, time + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.1, time + duration); 
        } else {
            // Staccato Mode: Punchy attack, decay follows filter
            gain.gain.linearRampToValueAtTime(peakGain, time + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, time + filterDecay + 0.1); 
        }

        // 6. Connect Graph: OSC -> FILTER -> VCA -> DISTORTION (Output)
        osc.connect(filterNode);
        filterNode.connect(gain);
        gain.connect(this.output);

        // 7. Schedule Start/Stop
        osc.start(time);
        osc.stop(time + duration + 0.2); // Release tail

        // 8. Garbage Collection
        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
            filterNode.disconnect();
        };
    }
}

window.BassSynth = BassSynth;