/*
 * FX SYNTH MODULE (RE-ENGINEERED v3.0)
 * Architecture: "Stompbox" Analog Modeling
 * Focus: Warmth, Cabinet Simulation, and Liquid Filter
 */

// --- 1. FILTER ENGINE (Rubber Acid Filter) ---
class BassFilter {
    static create(ctx, time, params, duration, slide, accent) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';

        // --- A. FREQUENCY MAPPING ---
        // Mapeo no lineal para que el slider se sienta musical
        // 0-100 -> Rango útil de 100Hz a 10000Hz
        const t = params.cutoff / 100;
        const baseFreq = 60 + (Math.pow(t, 2) * 10000); 
        
        filter.frequency.setValueAtTime(baseFreq, time);

        // --- B. RESONANCE CONTROL ---
        // La resonancia digital pura puede ser dolorosa.
        // Limitamos y compensamos.
        let qVal = params.resonance;
        
        // Boost en acentos, pero con "techo"
        if (accent) qVal = Math.min(25, qVal * 1.3 + 3);
        
        // Reducimos Q si la frecuencia es muy alta para evitar silbidos
        if (baseFreq > 8000) qVal *= 0.5;
        
        filter.Q.value = Math.min(20, qVal);

        // --- C. ENVELOPE (The "Wow") ---
        const envStrength = params.envMod / 100; 
        // Cuánto sube la frecuencia (rango dinámico de la envolvente)
        const peakFreq = Math.min(22050, baseFreq + (envStrength * 7000));
        
        // --- D. TIMING (Organic) ---
        // Attack: Instantáneo pero no "clicky"
        const attackTime = slide ? 0.1 : 0.005;
        
        // Decay: "Gomoso"
        let decayTime = 0.1 + (params.decay / 100) * 0.5; // 0.1s - 0.6s
        if (accent) decayTime = 0.15; // Acentos son cortos y percusivos
        if (slide) decayTime = duration; // En slide el filtro no cierra

        // --- E. AUTOMATION ---
        filter.frequency.setValueAtTime(baseFreq, time);
        filter.frequency.linearRampToValueAtTime(peakFreq, time + attackTime);
        
        // Usamos setTargetAtTime para una curva exponencial real (estilo capacitor analógico)
        filter.frequency.setTargetAtTime(baseFreq, time + attackTime, decayTime / 3);

        return { node: filter, decayTime: decayTime };
    }
}

// --- 2. DISTORTION ENGINE (The "Tube Screamer" Topology) ---
class BassDistortion {
    constructor(audioContext) {
        this.ctx = audioContext;
        
        // TOPOLOGÍA ANALÓGICA:
        // Input -> Tight (HPF) -> Drive -> Clip -> Cab Sim (LPF) -> Output
        
        this.input = this.ctx.createGain();
        
        // 1. TIGHT FILTER: Quita graves extremos antes de distorsionar
        // Evita que el sonido se "ahogue" o suene a "pedo" (farting bass)
        this.tightFilter = this.ctx.createBiquadFilter();
        this.tightFilter.type = 'highpass';
        this.tightFilter.frequency.value = 150; // Corta el sub-barro
        this.tightFilter.Q.value = 0.7;

        // 2. PRE-GAIN (Drive)
        this.preGain = this.ctx.createGain();

        // 3. SHAPER (The Tube)
        this.shaper = this.ctx.createWaveShaper();
        this.shaper.oversample = '4x'; // CRÍTICO: Elimina el aliasing metálico

        // 4. CABINET SIMULATOR (Post-Filter)
        // La distorsión genera armónicos infinitos. Necesitamos simular
        // un altavoz que no reproduce agudos extremos (mosquito fizz).
        this.cabFilter = this.ctx.createBiquadFilter();
        this.cabFilter.type = 'lowpass';
        this.cabFilter.frequency.value = 4500; // Rolloff de guitarra/bajo típico
        this.cabFilter.Q.value = 0.6; // Suave

        // 5. POST-GAIN (Level Compensation)
        this.output = this.ctx.createGain();

        // ROUTING
        this.input.connect(this.tightFilter);
        this.tightFilter.connect(this.preGain);
        this.preGain.connect(this.shaper);
        this.shaper.connect(this.cabFilter);
        this.cabFilter.connect(this.output);

        this.curveCache = new Map();
        this.currentAmt = -1;
    }

    connect(dest) {
        this.output.connect(dest);
    }

    setDistortion(amount) {
        // Amount 0-100
        if (amount === this.currentAmt) return;
        this.currentAmt = amount;

        if (amount <= 1) {
            // BYPASS MODE (True Bypass)
            this.shaper.curve = null;
            this.preGain.gain.value = 1;
            this.output.gain.value = 1;
            this.tightFilter.frequency.value = 10; // Dejar pasar graves
            this.cabFilter.frequency.value = 22000; // Dejar pasar agudos
        } else {
            // ACTIVE MODE
            
            // 1. Filtros activos
            this.tightFilter.frequency.value = 120; 
            // A más distorsión, cerramos un poco más el gabinete para oscurecer el ruido
            this.cabFilter.frequency.value = 6000 - (amount * 30); 

            // 2. Generar Curva
            if (!this.curveCache.has(amount)) {
                this.curveCache.set(amount, this._makeAnalogCurve(amount));
            }
            this.shaper.curve = this.curveCache.get(amount);

            // 3. Drive inteligente
            // Empujamos la señal contra el techo.
            // 0-100 -> 1x a 20x de ganancia
            const drive = 1 + (amount / 3);
            this.preGain.gain.value = drive;

            // 4. Compensación de Volumen (Auto-Gain)
            // Mantiene el volumen percibido estable
            this.output.gain.value = 1 / (Math.sqrt(drive) * 0.8); 
        }
    }

    // Curva "Soft Asymmetric" (Simulación de Diodos)
    // Mucho más musical que Math.tanh estándar
    _makeAnalogCurve(amount) {
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        
        // Ajustamos la "dureza" basada en el slider
        const k = amount * 0.8; 

        for (let i = 0; i < n_samples; i++) {
            let x = (i * 2) / n_samples - 1;
            
            // Algoritmo modificado para asimetría (más armónicos pares = más calidez)
            if (x < -0.08905) {
                curve[i] = -0.75 * (1 - (Math.pow(1 - (Math.abs(x) - 0.03), 12)) * 0.33) + 0.01;
            } else if (x > 0.21) {
                curve[i] = 0.9 * (1 - (Math.pow(1 - (x - 0.21), 12)) * 0.33) - 0.01;
            } else {
                // Zona lineal central (limpia)
                curve[i] = x * 1.1; 
            }

            // Soft Clipper final para seguridad
            curve[i] = Math.max(-1, Math.min(1, curve[i]));
        }
        return curve;
    }
}

window.BassFilter = BassFilter;
window.BassDistortion = BassDistortion;