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

  // Slots de patrón: 8 casilleros en memoria para guardar variantes y
  // volver a ellas sin perderlas. `activeSlotIndex` es el slot cargado
  // ahora mismo (-1 si el patrón actual no coincide con ningún slot
  // guardado, p.ej. porque se generó o editó algo después de cargarlo).
  const SLOT_COUNT = 8;
  const patternSlots = new Array(SLOT_COUNT).fill(null);
  let activeSlotIndex = -1;

  function refreshSlotButtons() {
    ui.renderSlotButtons(patternSlots.map((slot, i) => ({ filled: !!slot, active: i === activeSlotIndex })));
  }

  function markSlotDirty() {
    if (activeSlotIndex !== -1) {
      activeSlotIndex = -1;
      refreshSlotButtons();
    }
  }

  function onSlotClick(index) {
    const saveArmed = ui.dom.btnSaveSlot.getAttribute('aria-pressed') === 'true';

    if (saveArmed) {
      if (!currentPattern) return;
      patternSlots[index] = window.BG.Pattern.clonePattern(currentPattern);
      activeSlotIndex = index;
      ui.dom.btnSaveSlot.setAttribute('aria-pressed', 'false'); // un solo guardado por activación
      refreshSlotButtons();
      return;
    }

    const saved = patternSlots[index];
    if (!saved) return; // slot vacío: no hay nada para cargar

    currentPattern = window.BG.Pattern.clonePattern(saved); // clon: editar después no debe tocar lo guardado
    activeSlotIndex = index;
    ui.renderPattern(currentPattern);
    sequencer.setPattern(currentPattern); // cargar un slot es un salto deliberado: reinicia posición, como Generate
    refreshSlotButtons();
  }

  function buildPattern() {
    const params = ui.readGeneratorParams();
    params.previousPattern = currentPattern; // para que los locks puedan reutilizarlo
    return window.BG.Generator.generate(params);
  }

  /** Generate explícito: patrón nuevo, la reproducción vuelve al paso 1. */
  function generateAndLoad() {
    currentPattern = buildPattern();
    markSlotDirty();
    ui.renderPattern(currentPattern);
    sequencer.setPattern(currentPattern);
  }

  /**
   * Regeneración en vivo (al mover un control): igual que Generate, pero el
   * patrón se reemplaza "en caliente", sin reiniciar la posición ni cortar
   * las notas que están sonando.
   */
  function regenerateLive() {
    currentPattern = buildPattern();
    markSlotDirty();
    ui.renderPattern(currentPattern);
    sequencer.replacePattern(currentPattern);
  }

  // Un slider dispara decenas de eventos por segundo: los agrupamos para
  // regenerar como mucho una vez por frame de animación.
  let liveRegenPending = false;
  const nextFrame = window.requestAnimationFrame
    ? (fn) => window.requestAnimationFrame(fn)
    : (fn) => setTimeout(fn, 16);

  function scheduleLiveRegenerate() {
    if (liveRegenPending) return;
    liveRegenPending = true;
    nextFrame(() => {
      liveRegenPending = false;
      regenerateLive();
    });
  }

  /**
   * Prende/apaga un paso a mano. Muta el mismo objeto Pattern (no crea uno
   * nuevo), así el scheduler -que ya tiene una referencia a ese objeto- ve
   * el cambio de inmediato, incluso con el patrón sonando, sin necesidad
   * de reiniciar la posición de reproducción ni disparar un panic.
   */
  function toggleStep(index) {
    if (!currentPattern) return;
    const p = currentPattern;
    markSlotDirty();
    p.active[index] = !p.active[index];

    if (p.active[index]) {
      // La curva de pitch existe para todos los pasos, así que al prenderlo
      // toma la nota que ya tenía. Solo si por algún motivo no hubiera
      // ninguna (patrón viejo), caemos a la tónica como red de seguridad.
      if (p.note[index] == null) {
        p.note[index] = window.BG.Scales.rootMidi(p.root, p.octave);
      }
      if (!p.velocity[index]) p.velocity[index] = 100;
      if (!p.gate[index]) p.gate[index] = 0.7;
    } else {
      p.velocity[index] = 0;
      p.gate[index] = 0;
    }

    ui.renderPattern(p);
  }

  /** Rota el patrón actual (en el lugar) y refresca la vista. */
  function shiftPattern(amount) {
    if (!currentPattern) return;
    markSlotDirty();
    window.BG.Pattern.rotate(currentPattern, amount);
    ui.renderPattern(currentPattern);
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
    ui.bindToggleButton(ui.dom.btnLockRhythm);
    ui.bindToggleButton(ui.dom.btnLockPitch);
    ui.bindToggleButton(ui.dom.btnSaveSlot);
    ui.setSlotClickHandler(onSlotClick);

    // Regeneración en vivo: sliders del generator, selects musicales y seed.
    [
      ui.dom.density, ui.dom.complexity, ui.dom.seed,
      ui.dom.restsOnbeat, ui.dom.restsOffbeat, ui.dom.accentOnbeat, ui.dom.accentOffbeat,
      ui.dom.weightRoot, ui.dom.weightFifth, ui.dom.weightThird, ui.dom.weightOther,
      ui.dom.variationAmountOnbeat, ui.dom.variationAmountOffbeat,
    ].forEach((el) => el.addEventListener('input', scheduleLiveRegenerate));
    ui.dom.variationShapeOnbeat.addEventListener('change', scheduleLiveRegenerate);
    ui.dom.variationShapeOffbeat.addEventListener('change', scheduleLiveRegenerate);
    [ui.dom.rootNote, ui.dom.scale, ui.dom.octave, ui.dom.octaveMin, ui.dom.octaveMax, ui.dom.steps, ui.dom.rate]
      .forEach((el) => el.addEventListener('change', scheduleLiveRegenerate));

    ui.dom.btnGenerate.addEventListener('click', generateAndLoad);
    ui.dom.btnNewSeed.addEventListener('click', () => {
      randomSeed();
      generateAndLoad();
    });

    ui.dom.btnPlay.addEventListener('click', () => {
      if (!currentPattern) generateAndLoad();
      sequencer.setTempo(ui.readTempo());
      sequencer.setSwing(ui.readSwing());
      sequencer.start();
      ui.setClockMode(sequencer.clockMode);
      ui.setPlayingState(true);
    });

    ui.dom.btnStop.addEventListener('click', () => {
      sequencer.stop();
      ui.setPlayingState(false);
    });

    ui.dom.btnPanic.addEventListener('click', () => midi.panic());

    ui.dom.tempo.addEventListener('change', () => sequencer.setTempo(ui.readTempo()));
    ui.dom.swing.addEventListener('input', () => sequencer.setSwing(ui.readSwing()));
    ui.dom.btnShiftLeft.addEventListener('click', () => shiftPattern(-1));
    ui.dom.btnShiftRight.addEventListener('click', () => shiftPattern(1));
    ui.dom.midiOutput.addEventListener('change', applyMidiSelection);
    ui.dom.midiChannel.addEventListener('change', applyMidiSelection);

    // Seguridad: apagar todas las notas si se cierra/recarga la pestaña.
    window.addEventListener('beforeunload', () => midi.panic());

    sequencer.onStepScheduled = (stepIndex, timeMs) => ui.scheduleStepHighlight(stepIndex, timeMs);
    ui.setStepClickHandler(toggleStep);
  }

  function init() {
    ui.populateStaticOptions();
    refreshSlotButtons();
    bindEvents();
    window.BG.KnobUI.enhanceApp(ui); // capa puramente visual (Etapa 1 del rediseño), no toca lógica
    initMidi();
    generateAndLoad(); // arranca con un patrón ya generado, listo para tocar
  }

  document.addEventListener('DOMContentLoaded', init);
})();
