/*
 * USER INTERFACE MODULE
 * Namespace: window.UI
 */

window.UI = {
    visualQueue: [],
    drawFrame: null,
    lastStep: -1,

    init: function() {
        this.bindGlobalEvents();
        this.renderAll();
        this.setupDigitalRepeaters(); // Initialize digital controls
        console.log("[UI] Interface Initialized");
    },

    renderAll: function() {
        this.renderTabs();
        this.renderTrackBar();
        this.updateEditor();
        this.initClockSVG();
    },

    bindGlobalEvents: function() {
        // --- LOG PANEL ---
        const logBtn = document.getElementById('btn-toggle-log-internal');
        if(logBtn) logBtn.onclick = () => {
            const p = document.getElementById('sys-log-panel');
            p.classList.toggle('-translate-y-full');
            p.classList.toggle('translate-y-0');
            logBtn.innerText = p.classList.contains('translate-y-0') ? "[ HIDE ]" : "[ SHOW ]";
        };

        // --- OCTAVE CONTROLS ---
        const octUp = document.getElementById('oct-up');
        const octDown = document.getElementById('oct-down');
        
        if(octUp) octUp.onclick = () => {
            if(window.AppState.currentOctave < 6) window.AppState.currentOctave++;
            document.getElementById('oct-display').innerText = window.AppState.currentOctave;
        };
        if(octDown) octDown.onclick = () => {
            if(window.AppState.currentOctave > 1) window.AppState.currentOctave--;
            document.getElementById('oct-display').innerText = window.AppState.currentOctave;
        };

        // --- BPM CONTROL ---
        const bpmInput = document.getElementById('bpm-input');
        if(bpmInput) bpmInput.onchange = (e) => {
            let val = parseInt(e.target.value);
            if(val < 60) val = 60;
            if(val > 300) val = 300;
            window.AppState.bpm = val;
        };

        // --- EXPORT ---
        this.bindClick('btn-open-export', () => this.toggleExportModal());
        this.bindClick('btn-close-export', () => this.toggleExportModal());
        this.bindClick('btn-start-render', () => window.AudioEngine.renderWav());
        
        document.querySelectorAll('.export-rep-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.export-rep-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                window.AppState.exportReps = parseInt(btn.dataset.rep);
            };
        });

        // --- PIANO ---
        document.querySelectorAll('.piano-key').forEach(k => {
            const handler = (e) => {
                e.preventDefault(); 
                this.handlePianoInput(k.dataset.note);
            };
            k.addEventListener('mousedown', handler);
            k.addEventListener('touchstart', handler);
        });

        // --- EDIT TOOLS ---
        this.bindClick('btn-toggle-slide', () => this.toggleModifier('slide'));
        this.bindClick('btn-toggle-accent', () => this.toggleModifier('accent'));
        this.bindClick('btn-delete-note', () => this.clearStep());
        
        // --- TRANSPORT ---
        this.bindClick('btn-play', () => window.Main.togglePlay());
        this.bindClick('app-logo', () => window.Main.togglePlay());

        // --- MENU ---
        this.bindClick('btn-open-menu', () => {
            this.renderSynthMenu();
            document.getElementById('main-menu').classList.remove('hidden');
            document.getElementById('main-menu').classList.add('flex');
        });
        this.bindClick('btn-menu-close', () => {
            document.getElementById('main-menu').classList.add('hidden');
            document.getElementById('main-menu').classList.remove('flex');
        });

        // --- MODES & PANELS ---
        this.bindClick('btn-toggle-ui-mode', () => this.toggleUIMode());
        this.bindClick('btn-minimize-panel', () => this.togglePanel());
        this.bindClick('panel-header-trigger', () => this.togglePanel());
        this.bindClick('btn-waveform', () => this.toggleWaveform()); 

        // --- ANALOG SLIDERS ---
        this.bindSliders();
        
        // --- MATRIX EVENT ---
        window.addEventListener('stepSelect', (e) => {
            window.AppState.selectedStep = e.detail.index;
            this.updateEditor();
        });
    },

    bindClick: function(id, fn) {
        const el = document.getElementById(id);
        if(el) el.onclick = fn;
    },

    bindSliders: function() {
        const update = (param, val) => {
            const s = window.AudioEngine.getSynth(window.AppState.activeView);
            if(!s) return;
            
            if(param === 'cutoff' && val > 100) val = ((val - 100) / 4900) * 100; // Hz to %
            
            if(param === 'distortion') s.setDistortion(val);
            if(param === 'cutoff') s.setCutoff(val);
            if(param === 'resonance') s.setResonance(val);
            if(param === 'envMod') s.setEnvMod(val);
            if(param === 'decay') s.setDecay(val);
            
            this.syncControls(s);
        };

        ['dist', 'cutoff', 'res', 'env', 'dec'].forEach(p => {
            const elA = document.getElementById(`${p}-slider`);
            if(elA) elA.oninput = (e) => update(this.mapParamName(p), parseFloat(e.target.value));
        });
    },

    setupDigitalRepeaters: function() {
        // Maneja tanto los botones +/- como la entrada directa de texto
        const buttons = document.querySelectorAll('.dfx-btn');
        buttons.forEach(btn => {
            let intervalId = null;
            let timeoutId = null;
            const targetParam = btn.dataset.target; 
            const dir = parseInt(btn.dataset.dir); 

            const changeVal = () => {
                const s = window.AudioEngine.getSynth(window.AppState.activeView);
                if(!s) return;
                
                let current = 0;
                if(targetParam === 'distortion') current = s.params.distortion;
                else if(targetParam === 'envMod') current = s.params.envMod;
                else if(targetParam === 'decay') current = s.params.decay;
                else if(targetParam === 'resonance') current = s.params.resonance * 5; 
                else if(targetParam === 'cutoff') current = s.params.cutoff; 

                let next = Math.max(0, Math.min(100, current + dir));
                
                // Mapeo inverso para resonancia (0-100 UI -> 0-20 Engine)
                if(targetParam === 'resonance') s.setResonance(next / 5);
                else if(targetParam === 'distortion') s.setDistortion(next);
                else if(targetParam === 'envMod') s.setEnvMod(next);
                else if(targetParam === 'decay') s.setDecay(next);
                else if(targetParam === 'cutoff') s.setCutoff(next);
                
                this.syncControls(s);
            };

            const start = () => { changeVal(); timeoutId = setTimeout(() => { intervalId = setInterval(changeVal, 100); }, 400); };
            const stop = () => { clearTimeout(timeoutId); clearInterval(intervalId); };

            btn.addEventListener('mousedown', start);
            btn.addEventListener('mouseup', stop);
            btn.addEventListener('mouseleave', stop);
            btn.addEventListener('touchstart', (e) => { e.preventDefault(); start(); });
            btn.addEventListener('touchend', stop);
        });

        // Digital Inputs Typing
        ['dist', 'cutoff', 'res', 'env', 'dec'].forEach(p => {
            const el = document.getElementById(`${p}-digital`);
            if(el) {
                el.onchange = (e) => {
                    const s = window.AudioEngine.getSynth(window.AppState.activeView);
                    if(!s) return;
                    let val = parseInt(e.target.value);
                    if(isNaN(val)) val = 0;
                    val = Math.max(0, Math.min(100, val));
                    
                    const param = this.mapParamName(p);
                    if(param === 'resonance') s.setResonance(val / 5);
                    else if(param === 'distortion') s.setDistortion(val);
                    else if(param === 'cutoff') s.setCutoff(val);
                    else if(param === 'envMod') s.setEnvMod(val);
                    else if(param === 'decay') s.setDecay(val);
                    
                    this.syncControls(s);
                };
            }
        });
    },

    mapParamName: function(short) {
        const map = { 'dist': 'distortion', 'cutoff': 'cutoff', 'res': 'resonance', 'env': 'envMod', 'dec': 'decay' };
        return map[short];
    },

    handlePianoInput: function(note) {
        window.AudioEngine.init(); 
        const id = window.AppState.activeView;
        if(id === 'drum') return;

        const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
        if(!blk.tracks[id]) window.timeMatrix.registerTrack(id);

        const current = blk.tracks[id][window.AppState.selectedStep];
        
        blk.tracks[id][window.AppState.selectedStep] = {
            note: note,
            octave: window.AppState.currentOctave,
            slide: current ? current.slide : false,
            accent: current ? current.accent : false
        };

        const s = window.AudioEngine.getSynth(id);
        if(s) s.play(note, window.AppState.currentOctave, window.AudioEngine.ctx.currentTime);

        this.updateEditor();
    },

    updateEditor: function() {
        const id = window.AppState.activeView;
        const bEd = document.getElementById('editor-bass');
        const dEd = document.getElementById('editor-drum');
        
        document.getElementById('step-info-display').innerText = `STEP ${window.AppState.selectedStep + 1} // ${id.toUpperCase()}`;

        if(id === 'drum') {
            bEd.classList.add('hidden');
            dEd.classList.remove('hidden');
            this.renderDrumEditor();
        } else {
            bEd.classList.remove('hidden');
            dEd.classList.add('hidden');
            const s = window.AudioEngine.getSynth(id);
            if(s) this.syncControls(s);
            this.updateModifiers();
        }

        if(window.timeMatrix) {
            window.timeMatrix.selectedStep = window.AppState.selectedStep;
            window.timeMatrix.render(id, window.AppState.editingBlock);
        }
    },

    syncControls: function(synth) {
        const p = synth.params;
        const set = (id, v) => { const el = document.getElementById(id); if(el) el.value = Math.round(v); };
        
        // Analog
        set('dist-slider', p.distortion);
        set('res-slider', p.resonance);
        set('env-slider', p.envMod);
        set('dec-slider', p.decay);
        set('cutoff-slider', ((p.cutoff/100)*4900)+100);

        // Digital
        set('dist-digital', p.distortion);
        set('res-digital', p.resonance * 5); // Display 0-100
        set('env-digital', p.envMod);
        set('dec-digital', p.decay);
        set('cutoff-digital', p.cutoff);

        // Waveform
        const btnW = document.getElementById('btn-waveform');
        if(btnW) {
            btnW.innerHTML = p.waveform === 'square' 
                ? '<span class="text-xl font-bold leading-none mb-0.5">Π</span><span>SQR</span>' 
                : '<span class="text-xl font-bold leading-none mb-0.5">~</span><span>SAW</span>';
        }
    },

    updateModifiers: function() {
        const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
        const track = blk.tracks[window.AppState.activeView];
        const note = track ? track[window.AppState.selectedStep] : null;
        
        const sBtn = document.getElementById('btn-toggle-slide');
        const aBtn = document.getElementById('btn-toggle-accent');
        
        sBtn.className = `flex-1 py-1 border border-gray-700 bg-gray-900/50 text-gray-500 text-[10px] tracking-widest hover:text-green-400 hover:border-green-600 transition-all font-bold rounded ${note && note.slide ? '!text-green-400 !border-green-600 !bg-green-900/30' : ''}`;
        aBtn.className = `flex-1 py-1 border border-gray-700 bg-gray-900/50 text-gray-500 text-[10px] tracking-widest hover:text-green-400 hover:border-green-600 transition-all font-bold rounded ${note && note.accent ? '!text-green-400 !border-green-600 !bg-green-900/30' : ''}`;
    },

    // --- LOOP ---
    startLoop: function() {
        const loop = () => {
            if(!window.AudioEngine.ctx) return;
            const t = window.AudioEngine.ctx.currentTime;
            
            while(this.visualQueue.length && this.visualQueue[0].time <= t) {
                const ev = this.visualQueue.shift();
                
                if(this.lastStep !== ev.step) {
                    this.updateClockUI(ev.step);
                    
                    if(ev.block === window.AppState.editingBlock) {
                        window.timeMatrix.highlightPlayingStep(ev.step);
                        if(ev.step % 4 === 0) this.blinkLed();
                    } else {
                        window.timeMatrix.highlightPlayingStep(-1);
                    }
                    
                    if(window.AppState.followPlayback && ev.block !== window.AppState.editingBlock) {
                        window.AppState.editingBlock = ev.block;
                        this.renderTrackBar();
                        this.updateEditor();
                    }
                    
                    this.lastStep = ev.step;
                }
            }
            if(window.AppState.isPlaying) requestAnimationFrame(loop);
        };
        loop();
    },

    initClockSVG: function() {
        const svg = document.getElementById('play-clock-svg');
        if(!svg) return;
        svg.innerHTML = '';
        for(let i=0; i<16; i++) {
            const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            el.setAttribute("r", 45); el.setAttribute("cx", 50); el.setAttribute("cy", 50);
            el.setAttribute("fill", "transparent"); el.setAttribute("stroke-width", "4");
            el.setAttribute("stroke-dasharray", `${(Math.PI*90/16)-2} ${Math.PI*90}`);
            el.setAttribute("transform", `rotate(${(360/16)*i}, 50, 50)`);
            el.setAttribute("id", `clock-seg-${i}`);
            el.setAttribute("stroke", "#333");
            svg.appendChild(el);
        }
    },

    updateClockUI: function(step) {
        for(let i=0; i<16; i++) {
            const s = document.getElementById(`clock-seg-${i}`);
            if(s) s.setAttribute("stroke", i === step ? "#00ff41" : (i < step ? "#004411" : "#222"));
        }
    },

    blinkLed: function() {
        const l = document.getElementById('activity-led');
        if(l) { l.style.backgroundColor='#fff'; setTimeout(()=>l.style.backgroundColor='', 50); }
    },

    togglePanel: function() {
        const p = document.getElementById('editor-panel');
        const b = document.getElementById('btn-minimize-panel');
        if(p.classList.contains('panel-collapsed')) {
            p.classList.remove('panel-collapsed'); p.classList.add('panel-expanded');
            b.innerHTML = "&#9660;";
        } else {
            p.classList.remove('panel-expanded'); p.classList.add('panel-collapsed');
            b.innerHTML = "&#9650;";
        }
    },

    toggleUIMode: function() {
        window.AppState.uiMode = window.AppState.uiMode === 'analog' ? 'digital' : 'analog';
        const isDig = window.AppState.uiMode === 'digital';
        document.getElementById('fx-controls-analog').classList.toggle('hidden', isDig);
        document.getElementById('fx-controls-digital').classList.toggle('hidden', !isDig);
        document.getElementById('btn-toggle-ui-mode').innerText = isDig ? "UI MODE: DIGITAL" : "UI MODE: ANALOG";
        this.updateEditor();
    },

    toggleWaveform: function() {
        const s = window.AudioEngine.getSynth(window.AppState.activeView);
        if(s) {
            const next = s.params.waveform === 'sawtooth' ? 'square' : 'sawtooth';
            s.setWaveform(next);
            this.syncControls(s);
        }
    },

    toggleModifier: function(prop) {
        const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
        const track = blk.tracks[window.AppState.activeView];
        if(!track) return;
        const note = track[window.AppState.selectedStep];
        if(note) {
            note[prop] = !note[prop];
            this.updateEditor();
        }
    },

    clearStep: function() {
        const id = window.AppState.activeView;
        if(id === 'drum') return;
        const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
        if(blk.tracks[id]) {
            blk.tracks[id][window.AppState.selectedStep] = null;
            this.updateEditor();
        }
    },

    toggleExportModal: function() {
        const m = document.getElementById('export-modal');
        if(m) { 
            m.classList.toggle('hidden'); 
            m.classList.toggle('flex'); 
        }
    },

    renderTrackBar: function() {
        const c = document.getElementById('track-bar');
        if(!c) return;
        c.innerHTML = '';
        window.timeMatrix.blocks.forEach((_, i) => {
            const d = document.createElement('div');
            d.className = `track-block ${i === window.AppState.editingBlock ? 'track-block-editing' : ''} ${window.AppState.isPlaying && i === window.AppState.currentPlayBlock ? 'track-block-playing' : ''}`;
            d.innerText = i + 1;
            d.onclick = () => { window.AppState.editingBlock = i; this.updateEditor(); this.renderTrackBar(); };
            c.appendChild(d);
        });
        document.getElementById('display-current-block').innerText = window.AppState.editingBlock + 1;
        document.getElementById('display-total-blocks').innerText = window.timeMatrix.blocks.length;
    },

    renderTabs: function() {
        const c = document.getElementById('instrument-tabs-container');
        if(!c) return;
        c.innerHTML = '';
        window.AudioEngine.synths.forEach(s => {
            const b = document.createElement('button');
            const act = window.AppState.activeView === s.id;
            b.className = `px-3 py-1 text-[10px] font-bold border uppercase ${act ? 'text-green-400 bg-gray-900 border-green-500' : 'text-gray-500 border-transparent'}`;
            b.innerText = s.id;
            b.onclick = () => { window.AppState.activeView = s.id; this.updateEditor(); this.renderTabs(); };
            c.appendChild(b);
        });
        const d = document.createElement('button');
        d.className = `px-3 py-1 text-[10px] font-bold border uppercase ${window.AppState.activeView === 'drum' ? 'text-green-400 bg-gray-900 border-green-500' : 'text-gray-500 border-transparent'}`;
        d.innerText = "DRUMS";
        d.onclick = () => { window.AppState.activeView = 'drum'; this.updateEditor(); this.renderTabs(); };
        c.appendChild(d);
    },

    renderSynthMenu: function() {
        const c = document.getElementById('synth-list-container');
        c.innerHTML = '';
        window.AudioEngine.synths.forEach(s => {
            const r = document.createElement('div');
            r.className = 'flex justify-between bg-black p-2 border border-gray-800 text-xs';
            r.innerHTML = `<span class="text-green-500">${s.id}</span>`;
            const btn = document.createElement('button');
            btn.className = "text-red-500";
            btn.innerText = "X";
            btn.onclick = () => {
                if(window.AudioEngine.removeSynth(s.id)) {
                    window.timeMatrix.removeTrack(s.id);
                    if(window.AppState.activeView === s.id) window.AppState.activeView = 'drum'; 
                    this.renderAll();
                }
            };
            r.appendChild(btn);
            c.appendChild(r);
        });
    },

    renderDrumEditor: function() {
        const c = document.getElementById('editor-drum');
        c.innerHTML = '';
        const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
        const drums = blk.drums[window.AppState.selectedStep] || [];
        
        const kits = window.AudioEngine.drums ? window.AudioEngine.drums.kits : (window.DrumSynth.prototype.kits || []);
        
        kits.forEach(k => { 
             const act = drums.includes(k.id);
             const b = document.createElement('button');
             b.className = `w-full py-2 px-3 mb-1 border flex justify-between items-center text-[10px] ${act ? 'bg-gray-900 border-green-700 text-green-400' : 'bg-transparent border-gray-800 text-gray-500'}`;
             b.innerHTML = `<span>${k.name}</span><div class="w-2 h-2 rounded-full" style="background:${k.color}"></div>`;
             b.onclick = () => {
                 window.AudioEngine.init();
                 if(act) drums.splice(drums.indexOf(k.id), 1);
                 else {
                     drums.push(k.id);
                     if(window.AudioEngine.drums) window.AudioEngine.drums.play(k.id, window.AudioEngine.ctx.currentTime);
                 }
                 this.updateEditor();
             };
             c.appendChild(b);
        });
    }
};