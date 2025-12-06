/*
 * NEURODARK 23 - MAIN CONTROLLER v37
 * Central Hub: Global State
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

// Bootstrap Sequence
document.addEventListener('DOMContentLoaded', () => {
    console.log("[Main] Bootstrapping...");
    
    // 1. Validar Clases
    if(!window.TimeMatrix || typeof window.BassSynth === 'undefined') {
        console.error("CRITICAL: Missing Synth Classes");
        return;
    }

    // 2. Inicializar Matriz de Tiempo Global
    window.timeMatrix = new window.TimeMatrix();

    // 3. Inicializar Audio Engine (Lazy)
    window.AudioEngine.initData(); // Crea los arrays de sintes pero no el contexto

    // 4. Inicializar UI
    window.UI.init();

    // 5. Global Unlocks (Click Policy)
    const unlock = () => {
        window.AudioEngine.startContext();
        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
    };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);

    console.log("[Main] System Ready");
});