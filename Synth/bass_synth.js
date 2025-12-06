/*
 * BASS SYNTH MODULE (CORE VOICE)
 * Orchestrates: Osc -> [NeuroFX Strip] -> Out
 * Focus: Clean signal path and VCA/VCF sync
 */

class BassSynth {
    constructor(id = 'bass-1') {
        this.id = id;
        this.ctx = null;
        this.output = null; 
        
        this.lastFreq = 0; // Para slide
        
        // Parámetros internos (0-100)
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

    // Setters (Optimizados para actualizar en tiempo real si es necesario)
    setDistortion(val) { this.params.distortion = val; }
    setCutoff(val) { this.params.cutoff = val; }
    setResonance(val) { this.params.resonance = val; }
    setEnvMod(val) { this.params.envMod = val; }
    setDecay(val) { this.params.decay = val; }
    setWaveform(val) { this.params.waveform = val; }

    play(note, octave, time, duration = 0.25, slide = false, accent = false) {
        if (!this.ctx) return;

        // 1. FRECUENCIA
        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;
        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        // 2. CREAR CADENA DE EFECTOS (Por Voz)
        // Instanciamos el FX Strip para esta nota/voz
        const fx = new window.NeuroFX(this.ctx);
        // Configuramos el FX con los parámetros actuales
        fx.setDistortion(this.params.distortion);

        // 3. OSCILADOR
        const osc = this.ctx.createOscillator();
        osc.type = this.params.waveform;
        
        // Slide Logic
        if (!this.lastFreq) this.lastFreq = freq;
        if (slide) {
            osc.frequency.setValueAtTime(this.lastFreq, time);
            osc.frequency.exponentialRampToValueAtTime(freq, time + 0.1); 
        } else {
            osc.frequency.setValueAtTime(freq, time);
        }
        this.lastFreq = freq;

        // 4. VCA (Amplificador Dinámico)
        // IMPORTANTE: El VCA va ANTES de la distorsión en nuestra cadena lógica,
        // para que la "cola" de la nota se limpie a medida que baja el volumen.
        const vca = this.ctx.createGain();
        
        // Niveles
        const peakVol = accent ? 1.0 : 0.7; // Acento satura más
        
        vca.gain.setValueAtTime(0, time);
        
        // Aplicar Envolvente de Filtro y obtener tiempo de decay óptimo
        const filterDecay = fx.applyFilterEnv(time, this.params, duration, slide, accent);

        // Envolvente de Volumen (VCA)
        if (slide) {
            // Legato
            vca.gain.linearRampToValueAtTime(peakVol, time + 0.02);
            vca.gain.setValueAtTime(peakVol, time + duration);
            // Salida rápida para no clickear
            vca.gain.linearRampToValueAtTime(0, time + duration + 0.05); 
        } else {
            // Staccato
            vca.gain.linearRampToValueAtTime(peakVol, time + 0.005); // Attack
            
            // Release: Debe ser ligeramente más largo que el decay del filtro
            // para escuchar la resonancia bajando
            let release = Math.max(0.2, filterDecay * 1.2);
            
            // Usamos setTargetAtTime para una caída natural tipo condensador
            vca.gain.setTargetAtTime(0, time + 0.05, release / 4);
        }

        // 5. CONEXIONES
        // Osc -> VCA -> FX Strip -> Master Output
        osc.connect(vca);
        vca.connect(fx.input);
        fx.output.connect(this.output);

        // 6. START / STOP
        osc.start(time);
        
        // Matar el oscilador con margen de seguridad
        const stopTime = time + duration + 1.0;
        osc.stop(stopTime);

        // Garbage Collection
        osc.onended = () => {
            // Desconectar todo para liberar memoria
            try {
                osc.disconnect();
                vca.disconnect();
                // Desconectar nodos internos del FX es complejo, 
                // pero al desconectar la salida del FX del master,
                // el Garbage Collector de JS debería encargarse.
                fx.output.disconnect(); 
            } catch(e) {}
        };
    }
}

window.BassSynth = BassSynth;