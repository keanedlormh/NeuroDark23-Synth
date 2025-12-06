/*
 * USER INTERFACE MODULE
 * Namespace: window.UI
 */

window.UI = {
    visualQueue: [],
    drawFrame: null,
    lastStep: -1,

    // --- INICIALIZACIÓN ---
    init: function() {
        this.bindGlobalEvents();
        this.renderAll();
        console.log("[UI] Interface Initialized");
    },

    renderAll: function() {
        this.renderTabs();
        this.renderTrackBar();
        this.updateEditor();
        this.initClockSVG();
    },

    // --- BINDINGS DE EVENTOS ---
    bindGlobalEvents: function() {
        // Log Panel
        const logBtn = document.getElementById('btn-toggle-log-internal');
        if(logBtn) logBtn.onclick = () => {
            const p = document.getElementById('sys-log-panel');
            p.classList.toggle('-translate-y-full');
            p.classList.toggle('translate-y-0');
            logBtn.innerText = p.classList.contains('translate-y-0') ? "[ HIDE ]" : "[ SHOW ]";
        };

        // Custom Event: Step Select (Desde TimeMatrix)
        window.addEventListener('stepSelect', (e) => {
            window.AppState.selectedStep = e.detail.index;
            this.updateEditor();
        });

        // Piano Keys
        document.querySelectorAll('.piano-key').forEach(k => {
            const handler = (e) => {
                e.preventDefault(); // Importante para touch
                this.handlePianoInput(k.dataset.note);
            };
            k.addEventListener('mousedown', handler);
            k.addEventListener('touchstart', handler);
        });

        // Controles de Edición
        this.bindClick('btn-toggle-slide', () => this.toggleModifier('slide'));
        this.bindClick('btn-toggle-accent', () => this.toggleModifier('accent'));
        this.bindClick('btn-delete-note', () => this.clearStep());
        
        // Transporte
        this.bindClick('btn-play', () => window.Main.togglePlay());
        this.bindClick('app-logo', () => window.Main.togglePlay());

        // Menú
        this.bindClick('btn-open-menu', () => {
            this.renderSynthMenu();
            document.getElementById('main-menu').classList.remove('hidden');
            document.getElementById('main-menu').classList.add('flex');
        });
        this.bindClick('btn-menu-close', () => {
            document.getElementById('main-menu').classList.add('hidden');
            document.getElementById('main-menu').classList.remove('flex');
        });

        // UI Modes
        this.bindClick('btn-toggle-ui-mode', () => this.toggleUIMode());
        this.bindClick('btn-minimize-panel', () => this.togglePanel());
        this.bindClick('panel-header-trigger', () => this.togglePanel());

        // Sliders
        this.bindSliders();
    },

    bindClick: function(id, fn) {
        const el = document.getElementById(id);
        if(el) el.onclick = fn;
    },

    bindSliders: function() {
        const update = (param, val) => {
            const s = window.AudioEngine.getSynth(window.AppState.activeView);
            if(!s) return;
            
            // Map Cutoff Hz for analog slider
            if(param === 'cutoff' && val > 100) {
                val = ((val - 100) / 4900) * 100;
            }
            
            // Set param
            if(param === 'distortion') s.setDistortion(val);
            if(param === 'cutoff') s.setCutoff(val);
            if(param === 'resonance') s.setResonance(val);
            if(param === 'envMod') s.setEnvMod(val);
            if(param === 'decay') s.setDecay(val);
            
            this.syncControls(s);
        };

        ['dist', 'cutoff', 'res', 'env', 'dec'].forEach(p => {
            // Analog
            const elA = document.getElementById(`${p}-slider`);
            if(elA) elA.oninput = (e) => update(this.mapParamName(p), parseFloat(e.target.value));
            
            // Digital
            const elD = document.getElementById(`${p}-digital`);
            if(elD) elD.onchange = (e) => update(this.mapParamName(p), parseFloat(e.target.value));
        });
    },

    mapParamName: function(short) {
        const map = { 'dist': 'distortion', 'cutoff': 'cutoff', 'res': 'resonance', 'env': 'envMod', 'dec': 'decay' };
        return map[short];
    },

    // --- LÓGICA DE DIBUJADO ---
    
    handlePianoInput: function(note) {
        window.AudioEngine.init(); // Asegurar audio
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

        // Preview
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
            
            // Sync params
            const s = window.AudioEngine.getSynth(id);
            if(s) this.syncControls(s);
            
            // Sync buttons
            this.updateModifiers();
        }

        // Render Matrix
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
        set('res-digital', p.resonance);
        set('env-digital', p.envMod);
        set('dec-digital', p.decay);
        set('cutoff-digital', p.cutoff);
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

    // --- LOOP VISUAL ---
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

    // --- MODALES Y PANELES ---
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
        // Drums Tab
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
                    if(window.AppState.activeView === s.id) window.AppState.activeView = 'drum'; // Fallback
                    this.renderAll();
                }
            };
            r.appendChild(btn);
            c.appendChild(r);
        });
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

    renderDrumEditor: function() {
        const c = document.getElementById('editor-drum');
        c.innerHTML = '';
        const blk = window.timeMatrix.blocks[window.AppState.editingBlock];
        const drums = blk.drums[window.AppState.selectedStep] || [];
        
        window.DrumSynth.prototype.kits.forEach(k => { // Acceso estático si es posible, sino hardcode
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