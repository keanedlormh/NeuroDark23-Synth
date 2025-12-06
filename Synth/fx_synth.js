/*
 * FX SYNTH MODULE
 * Centralized Sound Coloring Engines: Filter & Distortion
 * Refined for "NeuroDark" Acid Sound
 */

// --- 1. FILTER ENGINE (Timbre Shaping) ---
class BassFilter {
    /**
     * Creates and automates a BiquadFilterNode with complex Acid envelopes
     */
    static create(ctx, time, params, duration, slide, accent) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';

        // 1. Base Frequency Calculation
        // Map 0-100 to a logarithmic scale useful for bass (50Hz - 10000Hz)
        // This gives more control in the lower "meaty" range
        const normalizedCutoff = params.cutoff / 5000; // Assuming input is max 5000 from slider
        const baseCutoff = 60 + (normalizedCutoff * normalizedCutoff) * 3000;
        
        filter.frequency.setValueAtTime(baseCutoff, time);

        // 2. Resonance (Q) with Gain Compensation
        // High resonance usually drops bass. We keep it controlled.
        const currentRes = params.resonance; // 0-20 scale
        // Accent boosts resonance significantly but caps it to avoid ear-piercing whistles
        filter.Q.value = accent ? Math.min(25, currentRes * 1.8 + 2) : currentRes;

        // 3. Envelope Intensity (EnvMod)
        // How much the envelope opens the filter above the base cutoff
        // Accent creates a wider envelope range ("wow" effect)
        let envAmountHz = (params.envMod / 100) * 8000; 
        if (accent) envAmountHz *= 1.6; 

        // 4. Decay Calculation (The "Liquid" feel)
        // Slide notes have longer decay to blend into the next
        // Accent notes have shorter, snappier decay for impact
        let decayVal = params.decay / 100;
        let decayTimeSec = 0.1 + (decayVal * 0.6); // Base range 0.1s - 0.7s
        
        if (slide) decayTimeSec += 0.2; 
        if (accent) decayTimeSec *= 0.7; // Snappier

        // 5. Apply Envelope Automation
        const attackTime = slide ? 0.06 : 0.005; // Super fast attack for non-slides
        const peakFreq = Math.min(22000, baseCutoff + envAmountHz);

        // Rise to Peak
        filter.frequency.linearRampToValueAtTime(peakFreq, time + attackTime);
        // Fall to Sustain/Base (Acid style: almost exponential but controlled)
        filter.frequency.setTargetAtTime(baseCutoff, time + attackTime, decayTimeSec / 3);

        return {
            node: filter,
            decayTime: decayTimeSec
        };
    }
}

// --- 2. DISTORTION ENGINE (Saturation & Drive) ---
class BassDistortion {
    constructor(audioContext) {
        this.ctx = audioContext;
        
        // Chain: Input -> PreGain (Drive) -> Shaper (Curve) -> PostGain (Level) -> ToneFilter -> Output
        this.input = this.ctx.createGain();
        this.preGain = this.ctx.createGain();
        this.shaper = this.ctx.createWaveShaper();
        this.toneFilter = this.ctx.createBiquadFilter();
        this.postGain = this.ctx.createGain();
        this.output = this.ctx.createGain();
        
        // Configuration
        this.shaper.oversample = '4x'; // Critical for reducing digital aliasing
        
        // Tone Filter: Removes harsh high-end fizz from distortion
        this.toneFilter.type = 'lowpass';
        this.toneFilter.frequency.value = 12000; 
        this.toneFilter.Q.value = 0.5; // Smooth roll-off

        // Routing
        this.input.connect(this.preGain);
        this.preGain.connect(this.shaper);
        this.shaper.connect(this.toneFilter);
        this.toneFilter.connect(this.postGain);
        this.postGain.connect(this.output);
        
        // State
        this.amount = 0;
        this.curveCache = new Map();
        
        // Init default
        this.setDistortion(0);
    }

    connect(destination) {
        this.output.connect(destination);
    }

    setDistortion(amount) {
        // Amount 0-100
        if (this.amount === amount && amount !== 0) return;
        this.amount = amount;

        if (amount <= 0) {
            // Bypass mode behavior
            this.shaper.curve = null;
            this.preGain.gain.value = 1;
            this.postGain.gain.value = 1;
            this.toneFilter.frequency.value = 22000; // Open
        } else {
            // 1. Calculate Curve
            if (!this.curveCache.has(amount)) {
                this.curveCache.set(amount, this._makeDistortionCurve(amount));
            }
            this.shaper.curve = this.curveCache.get(amount);

            // 2. Drive Logic (The secret sauce)
            // As distortion increases, we boost input gain to hit the shaper harder (Compression effect)
            // and reduce output gain to keep volume steady.
            const drive = 1 + (amount / 10); // 1x to 11x gain
            this.preGain.gain.value = drive;
            
            // Compensation: roughly 1/root(drive) but tuned by ear
            this.postGain.gain.value = 1 / Math.pow(drive, 0.6);

            // 3. Tone Shaping
            // Darker tone as distortion increases to simulate cabinet
            this.toneFilter.frequency.value = 12000 - (amount * 80); 
        }
    }

    // Improved Sigmoid Curve for "Tube-like" warmth + hard clip edges
    _makeDistortionCurve(amount) {
        const k = amount * 1.5; // Intensity multiplier
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        
        for (let i = 0; i < n_samples; ++i) {
            let x = i * 2 / n_samples - 1;
            
            // Algoritmo modificado para más "cuerpo" en bajos y "crujido" en altos
            // WS Curve: (3 + k) * x * 20 * deg / (PI + k * abs(x))
            // Se mezcla con un hard clipper suave para dar agresividad
            
            let y = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
            
            // Soft Clamp limits
            if (y > 1) y = 1;
            if (y < -1) y = -1;
            
            curve[i] = y;
        }
        return curve;
    }
}

// Export classes globally
window.BassFilter = BassFilter;
window.BassDistortion = BassDistortion;