/*
 * NEURODARK 23 - MAIN CONTROLLER v35
 */

window.AppState = {
    isPlaying: false,
    bpm: 174,
    currentPlayStep: 0,
    currentPlayBlock: 0,
    editingBlock: 0,
    selectedStep: 0,
    activeView: 'bass-1',
    currentOctave: 3,
    uiMode: 'analog',
    exportReps: 1,
    followPlayback: false
};

window.Main = {
    togglePlay: function() {
        window.AudioEngine.init();
        window.AppState.isPlaying = !window.AppState.isPlaying;
        
        const btn = document.getElementById('btn-play');
        
        if(window.AppState.isPlaying) {
            btn.innerHTML = "&#10074;&#10074;";
            btn.classList.add('border-green-500', 'text-green-500');
            
            window.AppState.currentPlayStep = 0;
            window.AppState.currentPlayBlock = window.AppState.editingBlock;
            window.AudioEngine.nextNoteTime = window.AudioEngine.ctx.currentTime + 0.05;
            window.UI.visualQueue = [];
            window.UI.lastStep = -1;

            window.AudioEngine.start();
            window.UI.startLoop();
            
        } else {
            btn.innerHTML = "&#9658;";
            btn.classList.remove('border-green-500', 'text-green-500');
            
            window.AudioEngine.stop();
            window.timeMatrix.highlightPlayingStep(-1);
            window.UI.updateClockUI(-1);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    console.log("[Boot] Initializing...");
    
    // 1. Audio Engine Init (State only)
    window.AudioEngine.init(); 
    
    // 2. UI Init
    window.UI.init();
    
    // 3. Global Unlocks
    const unlock = () => {
        window.AudioEngine.init();
        if(window.AudioEngine.ctx && window.AudioEngine.ctx.state === 'running') {
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
        }
    };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
    
    // Helpers Globales para el HTML
    window.addBassSynth = function() {
        const id = `bass-${window.AudioEngine.synths.length + 1}`;
        window.AudioEngine.addSynth(id);
        window.timeMatrix.registerTrack(id);
        window.setTab(id);
    };
    
    window.setTab = (id) => {
        window.AppState.activeView = id;
        window.UI.renderAll();
    };
});