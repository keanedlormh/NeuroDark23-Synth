/*
 * FX SYNTH MODULE (NeuroChannel Strip)
 * Architecture: 18dB Acid Filter -> Tube Saturation -> Cab Sim
 * Designed for: High headroom, warm distortion, and organic resonance.
 */

class NeuroFX {
    constructor(ctx) {
        this.ctx = ctx;
        
        // --- 1. PRE-AMP & FILTER SECTION ---
        // Usamos cascada de filtros para simular la pendiente de 18dB/24dB de un 303
        this.filter1 = this.ctx.createBiquadFilter();
        this.filter1.type = 'lowpass';
        this.filter1.Q.value = 0; // La resonancia principal la maneja este filtro

        this.filter2 = this.ctx.createBiquadFilter();
        this.filter2.type = 'lowpass';
        this.filter2.Q.value = 0.5; // Suavizado Butterworth

        // --- 2. TIGHTENER (Pre-Distortion EQ) ---
        // Quita el "barro" de graves (<100Hz) antes de entrar a la distorsión
        // Esto hace que la distorsión sea "crujiente" y no "pedorra"
        this.preEq = this.ctx.createBiquadFilter();
        this.preEq.type = 'highpass';
        this.preEq.frequency.value = 120;

        // --- 3. SATURATION STAGE (Tube Driver) ---
        this.driveGain = this.ctx.createGain(); // Input Drive
        this.shaper = this.ctx.createWaveShaper();
        this.shaper.oversample = '4x'; // CRÍTICO: Elimina el aliasing metálico
        
        // --- 4. CABINET SIMULATOR (Post-Distortion EQ) ---
        // Simula la respuesta de frecuencia de un altavoz de bajo, cortando el "fizz" digital
        this.cabSim = this.ctx.createBiquadFilter();
        this.cabSim.type = 'lowpass';
        this.cabSim.frequency.value = 5000; 

        // --- 5. OUTPUT GAIN ---
        this.makeUpGain = this.ctx.createGain();

        // --- ROUTING ---
        // Input -> Filter1 -> Filter2 -> PreEQ -> Drive -> Shaper -> CabSim -> Output
        this.input = this.filter1; 
        
        this.filter1.connect(this.filter2);
        this.filter2.connect(this.preEq);
        this.preEq.connect(this.driveGain);
        this.driveGain.connect(this.shaper);
        this.shaper.connect(this.cabSim);
        this.cabSim.connect(this.makeUpGain);
        
        this.output = this.makeUpGain;

        // Cache
        this.curveCache = new Map();
        this.setDistortion(0); // Init
    }

    /**
     * Aplica la envolvente "Acid" al filtro
     * Devuelve el tiempo estimado de decaimiento para sincronizar el VCA
     */
    applyFilterEnv(time, params, duration, isSlide, isAccent) {
        // A. FRECUENCIA BASE (Logarítmica para sliders musicales)
        // 0-100 mapeado a 50Hz - 10,000Hz
        const t = params.cutoff / 100;
        const baseFreq = 50 + (t * t) * 10000;

        // B. RESONANCIA ADAPTATIVA
        // Evitamos que la resonancia rompa los oídos en frecuencias altas
        let q = params.resonance * 0.2; // Escala 0-20
        if (isAccent) q += 8; // Boost agresivo en acento
        
        // Compensación de ganancia automática al subir resonancia
        // (Los filtros digitales suelen subir mucho el volumen con Q alto)
        const qComp = 1.0 - (q / 50); 
        this.filter2.gain = qComp; 

        this.filter1.Q.value = Math.min(25, q);

        // C. ENVOLVENTE (Rango Dinámico)
        const envStrength = params.envMod / 100;
        const peakFreq = Math.min(22000, baseFreq + (envStrength * 8000));

        // D. TIEMPOS (Organic Feel)
        const attack = isSlide ? 0.1 : 0.005; // 5ms attack (muy rápido)
        let decay = 0.1 + (params.decay / 100) * 0.5; // 0.1s - 0.6s
        
        if (isAccent) decay = 0.15; // "Zap" rápido
        if (isSlide) decay = duration; // Sostenido

        // E. AUTOMATIZACIÓN
        const targetFreq = [this.filter1.frequency, this.filter2.frequency];
        
        targetFreq.forEach(p => {
            p.cancelScheduledValues(time);
            p.setValueAtTime(baseFreq, time);
            p.linearRampToValueAtTime(peakFreq, time + attack);
            // setTargetAtTime crea esa curva exponencial "gomosa" característica del hardware
            p.setTargetAtTime(baseFreq, time + attack, decay / 4); 
        });

        return decay;
    }

    setDistortion(amount) {
        // Amount 0-100
        
        // 1. Curva de Saturación
        if (!this.curveCache.has(amount)) {
            this.curveCache.set(amount, this._makeSaturationCurve(amount));
        }
        this.shaper.curve = this.curveCache.get(amount);

        // 2. Drive (Empuje)
        // Escalamos suavemente: 0 = 1x, 100 = 10x
        const drive = 1 + (amount * 0.15); 
        this.driveGain.gain.value = drive;

        // 3. Compensación de Salida (Make-up Gain)
        // Mantiene el volumen constante mientras subes la distorsión
        this.makeUpGain.gain.value = 1 / Math.sqrt(drive);

        // 4. Color del Gabinete (Tone)
        // A más distorsión, cerramos más el filtro de salida para ocultar imperfecciones
        const toneFreq = 6000 - (amount * 40); 
        this.cabSim.frequency.value = Math.max(2000, toneFreq);
    }

    // Curva "Soft Clipper" Asimétrica (Simula Válvulas/Cinta)
    _makeSaturationCurve(amount) {
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const k = amount * 0.2; // Factor de dureza
        
        for (let i = 0; i < n_samples; i++) {
            const x = (i * 2) / n_samples - 1;
            
            // Algoritmo: Soft Knee Compression
            // Mantiene el centro lineal (limpio) y comprime suavemente los extremos
            if (Math.abs(x) < 0.5) {
                curve[i] = x;
            } else {
                // Tanh suave para los picos
                curve[i] = Math.tanh(x * (1 + k)); 
            }
        }
        return curve;
    }
}

window.NeuroFX = NeuroFX;