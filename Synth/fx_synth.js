/*
 * FX SYNTH MODULE
 * Contains Sound Coloring Engines: Filter & Distortion
 */

// --- 1. FILTER ENGINE (Timbre Shaping) ---
class BassFilter {
    static create(ctx, time, params, duration, slide, accent) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';

        // 1. Base Frequency
        // Clamp low end to avoid silence (50Hz min)
        const baseCutoff = Math.max(50, params.cutoff);
        filter.frequency.setValueAtTime(baseCutoff, time);

        // 2. Resonance (Q)
        // Accent boosts resonance significantly
        const currentRes = params.resonance;
        filter.Q.value = accent ? Math.min(30, currentRes * 1.5 + 5) : currentRes;

        // 3. Envelope Calculation (The "Wow" factor)
        // EnvMod: 0-100 -> Maps to 0Hz - 4500Hz added to cutoff
        let envAmountHz = (params.envMod / 100) * 4500;
        if (accent) envAmountHz *= 1.5; // Accent opens filter wider

        // Decay Calculation
        // Decay: 0-100 -> Maps to 0.1s - 0.9s
        let decayTimeSec = 0.1 + (params.decay / 100) * 0.8;
        if (accent) decayTimeSec = Math.max(0.1, decayTimeSec * 0.6); // Accent is snappier (shorter decay)

        // 4. Apply Envelope Automation
        const attackTime = slide ? 0.08 : 0.02; // Slide has smoother attack
        
        // Rise to Peak
        filter.frequency.linearRampToValueAtTime(baseCutoff + envAmountHz, time + attackTime);
        // Fall to Sustain/Base
        filter.frequency.exponentialRampToValueAtTime(baseCutoff, time + attackTime + decayTimeSec);

        return {
            node: filter,
            decayTime: decayTimeSec // Return decay to sync VCA if needed
        };
    }
}

// --- 2. DISTORTION ENGINE (Drive) ---
class BassDistortion {
    constructor(audioContext) {
        this.ctx = audioContext;
        this.input = this.ctx.createGain();
        this.output = this.ctx.createGain();
        
        // WaveShaper Node
        this.shaper = this.ctx.createWaveShaper();
        this.shaper.oversample = '4x'; // High quality
        
        // Routing
        this.input.connect(this.shaper);
        this.shaper.connect(this.output);
        
        // Cache
        this.amount = 0;
        this.curveCache = new Map(); // Cache curves to avoid re-calculation
    }

    connect(destination) {
        this.output.connect(destination);
    }

    setDistortion(amount) {
        // Optimization: Don't recalculate if same amount
        if (amount === this.amount) return;
        this.amount = amount;
        
        if (amount <= 0) {
            this.shaper.curve = null;
        } else {
            // Check cache first
            if (!this.curveCache.has(amount)) {
                this.curveCache.set(amount, this._makeDistortionCurve(amount));
            }
            this.shaper.curve = this.curveCache.get(amount);
        }
    }

    _makeDistortionCurve(amount) {
        const k = amount;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        
        for (let i = 0; i < n_samples; ++i) {
            let x = i * 2 / n_samples - 1;
            // Classic sigmoid distortion curve
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }
}

// Export classes globally
window.BassFilter = BassFilter;
window.BassDistortion = BassDistortion;