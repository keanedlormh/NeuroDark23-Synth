/*
 * NEURODARK 23 - MAIN CONTROLLER v36
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
        window.AudioEngine.toggleTransport();
    },

    addBass: function() {
        const id = `bass-${window.AudioEngine.synths.length + 1}`;
        window.AudioEngine.addSynth(id);
        window.timeMatrix.registerTrack(id);
        window.AppState.activeView = id;
        window.UI.renderAll();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // 1. Audio Engine
    window.AudioEngine.init(); 
    
    // 2. UI
    window.UI.init();
    
    // 3. Unlock Policy
    const unlock = () => {
        window.AudioEngine.init();
        if(window.AudioEngine.ctx && window.AudioEngine.ctx.state === 'running') {
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
        }
    };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
    
    // Helper global para HTML
    window.addBassSynth = window.Main.addBass;
});