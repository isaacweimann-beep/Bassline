/**
 * app.js
 * -----------------------------------------------------------------------
 * Único módulo que conoce a todos los demás. Arranca la aplicación,
 * mantiene el estado actual (patrón vigente) y conecta los eventos de
 * la UI con el motor de generación, el scheduler y Web MIDI.
 * -----------------------------------------------------------------------
 */
(function () {
  'use strict';

  const ui = window.BG.UI.createUI();
  const midi = window.BG.Midi.createMidiController();
  const sequencer = window.BG.Sequencer.createSequencer(midi);

  let currentPattern = null;

  function generateAndLoad() {
    const params = ui.readGeneratorParams();
    currentPattern = window.BG.Generator.generate(params);
    ui.renderPattern(currentPattern);
    sequencer.setPattern(currentPattern);
  }

  function randomSeed() {
    const newSeed = Math.floor(Math.random() * 1_000_000);
    ui.setSeed(newSeed);
  }

  async function initMidi() {
    try {
      await midi.requestAccess();
      refreshMidiOutputs();
      // Si el usuario conecta/desconecta hardware en caliente, refrescamos.
      const access = midi.requestAccess; // ya resuelto arriba, solo para claridad
    } catch (err) {
      ui.setMidiStatus(err.message || 'No se pudo acceder a Web MIDI', 'error');
    }
  }

  function refreshMidiOutputs() {
    const outputs = midi.listOutputs();
    ui.populateMidiOutputs(outputs);
    if (outputs.length === 0) {
      ui.setMidiStatus('sin dispositivos MIDI conectados', 'warn');
      return;
    }
    ui.setMidiStatus(outputs.length + ' dispositivo(s) MIDI listo(s)', 'ok');
    applyMidiSelection();
  }

  function applyMidiSelection() {
    const outputId = ui.dom.midiOutput.value;
    if (outputId) midi.selectOutputById(outputId);
    midi.selectChannel(Number(ui.dom.midiChannel.value));
  }

  function bindEvents() {
    ui.bindKnobDisplays();

    ui.dom.btnGenerate.addEventListener('click', generateAndLoad);
    ui.dom.btnNewSeed.addEventListener('click', () => {
      randomSeed();
      generateAndLoad();
    });

    ui.dom.btnPlay.addEventListener('click', () => {
      if (!currentPattern) generateAndLoad();
      sequencer.setTempo(ui.readTempo());
      sequencer.start();
      ui.setPlayingState(true);
    });

    ui.dom.btnStop.addEventListener('click', () => {
      sequencer.stop();
      ui.setPlayingState(false);
    });

    ui.dom.btnPanic.addEventListener('click', () => midi.panic());

    ui.dom.tempo.addEventListener('change', () => sequencer.setTempo(ui.readTempo()));
    ui.dom.midiOutput.addEventListener('change', applyMidiSelection);
    ui.dom.midiChannel.addEventListener('change', applyMidiSelection);

    // Seguridad: apagar todas las notas si se cierra/recarga la pestaña.
    window.addEventListener('beforeunload', () => midi.panic());

    sequencer.onStepScheduled = (stepIndex, timeMs) => ui.scheduleStepHighlight(stepIndex, timeMs);
  }

  function init() {
    ui.populateStaticOptions();
    bindEvents();
    initMidi();
    generateAndLoad(); // arranca con un patrón ya generado, listo para tocar
  }

  document.addEventListener('DOMContentLoaded', init);
})();
