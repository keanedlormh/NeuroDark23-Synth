/*
 * FX SYNTH MODULE (Integrated Channel Strip)
 * Architecture: Cascaded Filters + Dynamic Saturation
 * Designed for: "Liquid" Acid Bass without digital artifacts
 */

class NeuroFX {
    constructor(ctx) {
        this.ctx = ctx;
        
        // --- 1. FILTER SECTION (12dB + 6dB Cascade = 18dBish feel) ---
        // Usamos dos filtros en serie para lograr una pendiente más pronunciada
        // típica de sintes acid (estilo TB-303 que es 18dB/24dB)
        this.filter1 = this.ctx.createBiquadFilter();
        this.filter1.type = 'lowpass';
        
        this.filter2 = this.ctx.createBiquadFilter();
        this.filter2.type = 'lowpass'; // Suaviza la resonancia del primero

        // --- 2. SATURATION STAGE (Warmth) ---
        this.shaper = this.ctx.createWaveShaper();
        this.shaper.oversample = '4x'; // Alta calidad
        
        // --- 3. EQ CORRECTION ---
        // Elimina el "barro" subgrave y el "fizz" agudo post-distorsión
        this.eqLowCut = this.ctx.createBiquadFilter();
        this.eqLowCut.type = 'highpass';
        this.eqLowCut.frequency.value = 120; // Limpia graves para la distorsión
        
        this.eqHiCut = this.ctx.createBiquadFilter();
        this.eqHiCut.type = 'lowpass';
        this.eqHiCut.frequency.value = 6000; // Simula gabinete/altavoz

        // --- 4. GAIN STAGING ---
        this.input = this.filter1; // Entrada al primer filtro
        this.driveGain = this.ctx.createGain(); // Empuje hacia el saturador
        this.makeUpGain = this.ctx.createGain(); // Volumen final

        // ROUTING
        // Osc -> Filter1 -> Filter2 -> LowCut -> Drive -> Shaper -> HiCut -> Output
        this.filter1.connect(this.filter2);
        this.filter2.connect(this.eqLowCut);
        this.eqLowCut.connect(this.driveGain);
        this.driveGain.connect(this.shaper);
        this.shaper.connect(this.eqHiCut);
        this.eqHiCut.connect(this.makeUpGain);
        
        this.output = this.makeUpGain;

        // Cache de curvas
        this.curveCache = new Map();
        
        // Init Defaults
        this.setDistortion(0);
    }

    // --- CONTROL METHODS ---

    /**
     * Aplica la envolvente de filtro (El efecto "Wow")
     */
    applyFilterEnv(time, params, duration, isSlide, isAccent) {
        // Mapeo de Frecuencia (Logarítmico)
        // 0-100 -> 100Hz - 8000Hz
        const cutoffNorm = params.cutoff / 100;
        const baseFreq = 100 + (cutoffNorm * cutoffNorm) * 8000;

        // Resonancia
        // La resonancia es peligrosa digitalmente. La limitamos.
        let q = params.resonance * 0.2; // 0-100 -> 0-20
        if (isAccent) q += 5; // Extra "chirrido" en acento
        
        // Aplicamos Q al primer filtro (el que da el carácter)
        this.filter1.Q.value = Math.min(25, q);
        this.filter2.Q.value = 0.5; // El segundo filtro solo suaviza (Butterworth)

        // Intensidad de Envolvente
        const envAmount = params.envMod / 100;
        const peakFreq = Math.min(22000, baseFreq + (envAmount * 10000));

        // Tiempos
        const attack = isSlide ? 0.1 : 0.005;
        let decay = 0.1 + (params.decay / 100) * 0.5; // 0.1s - 0.6s
        if (isAccent) decay = 0.15; // Acentos rápidos
        if (isSlide) decay = duration; // Slide sostenido

        // Automatización de ambos filtros
        [this.filter1.frequency, this.filter2.frequency].forEach(param => {
            param.cancelScheduledValues(time);
            param.setValueAtTime(baseFreq, time);
            param.linearRampToValueAtTime(peakFreq, time + attack);
            param.setTargetAtTime(baseFreq, time + attack, decay / 3);
        });
        
        return decay; // Devolvemos el tiempo de decay para sincronizar el VCA
    }

    setDistortion(amount) {
        // Generar curva si no existe
        if (!this.curveCache.has(amount)) {
            this.curveCache.set(amount, this._makeSaturationCurve(amount));
        }
        this.shaper.curve = this.curveCache.get(amount);

        // Drive Logic (Compensación automática de ganancia)
        // A más distorsión, más entrada pero menos salida
        const drive = 1 + (amount / 5); // 1x a 21x
        
        this.driveGain.gain.value = drive;
        this.makeUpGain.gain.value = 1 / Math.sqrt(drive); // Mantiene volumen estable

        // Ajuste de tono dinámico: A más distorsión, cerramos un poco el HiCut
        // para evitar que suene a "arena"
        const toneFreq = 8000 - (amount * 40); 
        this.eqHiCut.frequency.value = Math.max(2000, toneFreq);
    }

    // Curva "Soft Clipper" (Musical)
    _makeSaturationCurve(amount) {
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const k = amount * 0.1; // Dureza suave
        
        for (let i = 0; i < n_samples; i++) {
            const x = (i * 2) / n_samples - 1;
            // Algoritmo: x / (1 + k*|x|) -> Curva asintótica suave
            // Evita el corte duro (hard clipping)
            if (amount === 0) curve[i] = x;
            else curve[i] = (1 + k) * x / (1 + k * Math.abs(x));
        }
        return curve;
    }
}

window.NeuroFX = NeuroFX;