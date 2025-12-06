/*
 * FX SYNTH MODULE
 * Centralized Sound Coloring Engines: Filter & Distortion
 * RE-ENGINEERED for Studio Quality Acid Sound
 */

// --- 1. FILTER ENGINE (Timbre Shaping) ---
class BassFilter {
    static create(ctx, time, params, duration, slide, accent) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';

        // Mapeo logarítmico para el Cutoff (más resolución en graves/medios)
        // Slider 0-100 -> Hz
        const minFreq = 40;
        const maxFreq = 6000; 
        // Formula exponencial para que el slider se sienta natural
        const normalized = params.cutoff / 100; // asumiendo que llega 0-100 desde el slider (si llega raw Hz, ajustar)
        // Si params.cutoff viene en Hz raw (ej 100-5000), normalizar primero:
        let cutoffHz = params.cutoff;
        
        // Ajuste de rango dinámico
        filter.frequency.setValueAtTime(cutoffHz, time);

        // Resonancia Compensada
        // En sintes analógicos, mucha resonancia mata los graves.
        // Aquí limitamos la Q máxima para que no "pite" demasiado.
        let qVal = params.resonance; 
        if (accent) {
            qVal = Math.min(20, qVal * 1.5 + 2); // Boost controlado en acento
        }
        filter.Q.value = qVal;

        // Envelope Generator
        // Cuánto abre el filtro la envolvente
        const envAmt = params.envMod / 100; // 0.0 - 1.0
        const envPeakHz = Math.min(22000, cutoffHz + (envAmt * 6000));
        
        // Tiempos de Envolvente
        let attack = slide ? 0.1 : 0.003; // Ataque ultrarrápido para el "bite"
        
        // Decay "Líquido"
        // El decay varía según si es acento o slide para dar movimiento
        let decay = 0.1 + (params.decay / 100); // 0.1s a 1.1s
        if (accent) decay = 0.25; // Acentos son percusivos y cortos
        if (slide) decay = duration; // En slide, el filtro se mantiene abierto más tiempo

        // Automatización
        filter.frequency.setValueAtTime(cutoffHz, time);
        filter.frequency.linearRampToValueAtTime(envPeakHz, time + attack);
        // Usamos setTargetAtTime para una caída exponencial orgánica
        filter.frequency.setTargetAtTime(cutoffHz, time + attack, decay / 4); 

        return { node: filter, decayTime: decay };
    }
}

// --- 2. DISTORTION ENGINE (Tube Simulation) ---
class BassDistortion {
    constructor(audioContext) {
        this.ctx = audioContext;
        
        // CADENA DE PROCESAMIENTO:
        // Input -> HighPass (limpiar barro) -> PreGain (Drive) -> Shaper (Saturación) -> Tone Filter (Quitar fizz) -> Output
        
        this.input = this.ctx.createGain();
        
        // 1. Tightener: Filtro pasa-altos antes de distorsionar
        // Esto evita que los subgraves colapsen la distorsión ("farting sound")
        this.preFilter = this.ctx.createBiquadFilter();
        this.preFilter.type = 'highpass';
        this.preFilter.frequency.value = 80; 

        this.preGain = this.ctx.createGain(); // Drive knob
        
        this.shaper = this.ctx.createWaveShaper();
        this.shaper.oversample = '4x'; // CRÍTICO para calidad de audio
        
        this.toneFilter = this.ctx.createBiquadFilter();
        this.toneFilter.type = 'lowpass';
        this.toneFilter.frequency.value = 8000; // Suaviza agudos duros

        this.output = this.ctx.createGain(); // Make up gain

        // Conexiones
        this.input.connect(this.preFilter);
        this.preFilter.connect(this.preGain);
        this.preGain.connect(this.shaper);
        this.shaper.connect(this.toneFilter);
        this.toneFilter.connect(this.output);

        this.curveCache = new Map();
        this.currentAmount = -1;
    }

    connect(dest) {
        this.output.connect(dest);
    }

    setDistortion(amount) {
        // Amount 0-100
        if (amount === this.currentAmount) return;
        this.currentAmount = amount;

        if (amount <= 0) {
            // Bypass "Clean"
            this.shaper.curve = null;
            this.preGain.gain.value = 1;
            this.output.gain.value = 1;
            this.toneFilter.frequency.value = 22000;
        } else {
            // Generar curva si no existe
            if (!this.curveCache.has(amount)) {
                this.curveCache.set(amount, this._makeSaturationCurve(amount));
            }
            this.shaper.curve = this.curveCache.get(amount);

            // Gestión de Ganancia (Drive)
            // A más distorsión, más ganancia de entrada para "apretar" la onda
            // Rango: 1x a 20x (+26dB)
            const drive = 1 + (amount / 4); 
            this.preGain.gain.value = drive;

            // Compensación de volumen de salida
            // A más drive, bajamos la salida para mantener nivel constante
            this.output.gain.value = 1 / Math.pow(drive, 0.5); // Ajuste suave

            // Tone Mapping: La distorsión oscurece un poco al subir para simular gabinete
            // 8000Hz -> 3000Hz
            const toneFreq = 10000 - (amount * 60);
            this.toneFilter.frequency.setValueAtTime(toneFreq, this.ctx.currentTime);
        }
    }

    // Curva "Soft Clipper" más musical que la sigmoide estándar
    _makeSaturationCurve(amount) {
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const k = amount * 0.5; // Factor de dureza
        
        for (let i = 0; i < n_samples; i++) {
            let x = (i * 2) / n_samples - 1;
            
            // Algoritmo: Soft Clipping asimétrico (simula válvulas/transistores)
            // Math.tanh es excelente para esto, suena redondo.
            
            // Pre-shape
            let y = x * (1 + k/10); 
            
            // Core saturation
            if (Math.abs(y) < 0.5) {
                // Zona lineal (limpia)
                curve[i] = y; 
            } else {
                // Zona de compresión (tanh suaviza los picos)
                curve[i] = Math.tanh(y * (1 + k/100)); 
            }
            
            // Hard limit final por seguridad
            curve[i] = Math.max(-1, Math.min(1, curve[i]));
        }
        return curve;
    }
}

window.BassFilter = BassFilter;
window.BassDistortion = BassDistortion;