/*
 * NEURODARK 23 - MAIN CONTROLLER v38
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
        window.UI.toggleTransport();
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
    // 1. Matriz de Tiempo
    if(window.TimeMatrix) window.timeMatrix = new window.TimeMatrix();
    else console.error("Missing TimeMatrix!");

    // 2. Audio Engine (Datos)
    window.AudioEngine.initData(); 
    
    // 3. UI Init
    window.UI.init();
    
    // 4. Global Unlocks (Políticas de Audio de Navegador)
    const unlock = () => {
        window.AudioEngine.init();
        if(window.AudioEngine.ctx && window.AudioEngine.ctx.state === 'running') {
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
        }
    };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
    
    console.log("[System] Boot Complete");
});