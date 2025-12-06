/*
 * BASS SYNTH MODULE (VOICE CORE)
 * Orchestrates: Oscillator -> VCA -> NeuroFX -> Output
 */

class BassSynth {
    constructor(id = 'bass-1') {
        this.id = id;
        this.ctx = null;
        this.output = null; 
        
        this.lastFreq = 0; // Memoria para Slide
        
        // Parámetros normalizados (0-100)
        this.params = {
            distortion: 20,
            cutoff: 40,
            resonance: 8,
            envMod: 60,
            decay: 40,
            waveform: 'sawtooth'
        };
    }

    init(audioContext, destinationNode) {
        this.ctx = audioContext;
        this.output = destinationNode;
    }

    // Setters ligeros (el trabajo pesado ocurre en play())
    setDistortion(val) { this.params.distortion = val; }
    setCutoff(val) { this.params.cutoff = val; }
    setResonance(val) { this.params.resonance = val; }
    setEnvMod(val) { this.params.envMod = val; }
    setDecay(val) { this.params.decay = val; }
    setWaveform(val) { this.params.waveform = val; }

    /**
     * Dispara una nota.
     * Flujo: Oscilador -> VCA (Volumen) -> NeuroFX (Filtro+Drive) -> Master
     */
    play(note, octave, time, duration = 0.25, slide = false, accent = false) {
        if (!this.ctx || !this.output) return;

        // 1. FRECUENCIA
        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;
        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        // 2. OSCILADOR
        const osc = this.ctx.createOscillator();
        osc.type = this.params.waveform;
        
        // Drift Analógico (Vital para sonido orgánico)
        osc.detune.value = (Math.random() * 6) - 3; 

        // Lógica de Slide (Portamento)
        if (!this.lastFreq) this.lastFreq = freq;
        if (slide) {
            osc.frequency.setValueAtTime(this.lastFreq, time);
            osc.frequency.exponentialRampToValueAtTime(freq, time + 0.1); 
        } else {
            osc.frequency.setValueAtTime(freq, time);
        }
        this.lastFreq = freq;

        // 3. FX STRIP (Instancia única por nota para polifonía/colas limpias)
        const fx = new window.NeuroFX(this.ctx);
        fx.setDistortion(this.params.distortion);
        
        // Aplicamos envolvente al filtro y obtenemos el tiempo de caída
        const filterDecayTime = fx.applyFilterEnv(time, this.params, duration, slide, accent);

        // 4. VCA (Amplificador Controlado por Voltaje)
        // Controla el volumen ANTES de entrar al FX. Esto es clave para la distorsión dinámica.
        const vca = this.ctx.createGain();
        
        // Headroom: Dejamos espacio para que la resonancia no clipee
        const peakVol = accent ? 0.8 : 0.6; 
        
        vca.gain.setValueAtTime(0, time);
        
        // Envolvente de Volumen (ADSR simplificado)
        if (slide) {
            // LEGATO: Sostenido completo
            vca.gain.linearRampToValueAtTime(peakVol, time + 0.02);
            vca.gain.setValueAtTime(peakVol, time + duration);
            vca.gain.linearRampToValueAtTime(0, time + duration + 0.05); // Quick fade
        } else {
            // STACCATO: Golpe percusivo
            vca.gain.linearRampToValueAtTime(peakVol, time + 0.005); // Attack instantáneo
            
            // Release Inteligente:
            // El volumen debe durar un poco MÁS que el filtro para oír la resonancia "morir"
            // Si cortamos el volumen antes que el filtro, suena cortado/digital.
            const release = Math.max(0.2, filterDecayTime * 1.5);
            
            // Caída Exponencial (Natural)
            vca.gain.setTargetAtTime(0, time + 0.05, release / 5);
        }

        // 5. CONEXIONES
        osc.connect(vca);
        vca.connect(fx.input);
        fx.output.connect(this.output);

        // 6. EJECUCIÓN
        osc.start(time);
        // Detenemos el oscilador con margen de seguridad para colas de efectos
        osc.stop(time + duration + 1.0); 

        // 7. LIMPIEZA DE MEMORIA
        osc.onended = () => {
            try {
                osc.disconnect();
                vca.disconnect();
                // Desconectar FX del master permite al Garbage Collector limpiar la cadena
                fx.output.disconnect(); 
            } catch(e) {}
        };
    }
}

window.BassSynth = BassSynth;