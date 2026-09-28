/**
 * ui.js
 * -----------------------------------------------------------------------
 * Única capa que toca el DOM. No genera patrones ni manda MIDI: recibe
 * callbacks de app.js y los dispara ante eventos de usuario; y expone
 * funciones de renderizado que app.js llama cuando hay un Pattern nuevo.
 * -----------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const Scales = global.BG.Scales;

  // Sensibilidad de los gestos de arrastre vertical sobre un paso.
  const PITCH_DRAG_PX_PER_SEMITONE = 10; // cuántos px hay que mover para subir/bajar 1 semitono
  const GATE_DRAG_PX_FULL_RANGE = 120;   // cuántos px de arrastre cubren todo el rango de gate
  const VELOCITY_DRAG_PX_FULL_RANGE = 120; // cuántos px de arrastre cubren todo el rango de velocity
  const GATE_MIN = 0.1;
  const GATE_MAX = 1.5;

  function $(id) { return document.getElementById(id); }

  /**
   * Adjunta un gesto de "click o arrastre vertical" a un elemento.
   * Distingue ambos casos por distancia recorrida (threshold en px):
   * si el mouse se mueve más que el threshold, es un drag (dispara
   * onDrag en cada movimiento con el deltaY acumulado desde el inicio);
   * si no, al soltar se considera un click simple (onClick).
   */
  function attachDragHandlers(el, handlers) {
    const threshold = handlers.threshold != null ? handlers.threshold : 4;

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      let dragging = false;
      const startY = e.clientY;
      if (handlers.onDragStart) handlers.onDragStart();

      function onMove(ev) {
        const deltaY = ev.clientY - startY;
        if (!dragging && Math.abs(deltaY) > threshold) dragging = true;
        if (dragging && handlers.onDrag) handlers.onDrag(deltaY);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (dragging) {
          if (handlers.onDragEnd) handlers.onDragEnd();
        } else if (handlers.onClick) {
          handlers.onClick();
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function clampGate(v) {
    return Math.max(GATE_MIN, Math.min(GATE_MAX, v));
  }

  function clampVelocity(v) {
    return Math.max(1, Math.min(127, Math.round(v)));
  }

  function createUI() {
    const dom = {
      midiStatusDot: $('midiStatusDot'),
      midiStatusText: $('midiStatusText'),

      btnPlay: $('btnPlay'),
      btnStop: $('btnStop'),
      btnPanic: $('btnPanic'),
      tempo: $('tempo'),
      swing: $('swing'),
      swingValue: $('swingValue'),
      btnShiftLeft: $('btnShiftLeft'),
      btnShiftRight: $('btnShiftRight'),
      midiOutput: $('midiOutput'),
      midiChannel: $('midiChannel'),

      rootNote: $('rootNote'),
      scale: $('scale'),
      octave: $('octave'),
      octaveMin: $('octaveMin'),
      octaveMax: $('octaveMax'),
      steps: $('steps'),
      rate: $('rate'),

      density: $('density'),
      complexity: $('complexity'),
      rests: $('rests'),
      accentAmount: $('accentAmount'),
      densityValue: $('densityValue'),
      complexityValue: $('complexityValue'),
      restsValue: $('restsValue'),
      accentAmountValue: $('accentAmountValue'),

      seed: $('seed'),
      btnNewSeed: $('btnNewSeed'),
      btnGenerate: $('btnGenerate'),
      btnLockRhythm: $('btnLockRhythm'),
      btnLockPitch: $('btnLockPitch'),

      stepGrid: $('stepGrid'),
      stepGridEmpty: $('stepGridEmpty'),
    };

    let stepEls = []; // referencias a los elementos de paso actualmente renderizados
    let highlightedIndex = -1; // paso que está sonando (para re-aplicar el resaltado tras un re-render)
    let highlightTimeouts = [];
    let stepClickHandler = null; // callback(stepIndex) provisto por app.js

    // --- Poblado de selects estáticos (independientes del Pattern) ---

    function populateStaticOptions() {
      fillSelect(dom.rootNote, Scales.NOTE_NAMES.map((name, i) => ({ value: i, label: name })));
      fillSelect(dom.scale, Scales.SCALE_NAMES.map((name) => ({ value: name, label: name })));
      fillSelect(dom.octave, range(0, 6).map((o) => ({ value: o, label: 'octava ' + o })), 2);
      fillSelect(dom.octaveMin, range(-2, 0).map((o) => ({ value: o, label: (o > 0 ? '+' : '') + o })), -1);
      fillSelect(dom.octaveMax, range(0, 2).map((o) => ({ value: o, label: (o > 0 ? '+' : '') + o })), 1);
      fillSelect(dom.steps, [8, 16, 32].map((s) => ({ value: s, label: s + ' pasos' })), 16);
      fillSelect(dom.rate, ['1/4', '1/8', '1/16', '1/32'].map((r) => ({ value: r, label: r })), '1/16');
      fillSelect(dom.midiChannel, range(1, 16).map((c) => ({ value: c, label: 'canal ' + c })), 1);

      // Escala por defecto: Natural Minor si existe, si no la primera de la lista.
      if (Scales.SCALE_NAMES.includes('Natural Minor')) dom.scale.value = 'Natural Minor';
    }

    function fillSelect(selectEl, items, defaultValue) {
      selectEl.innerHTML = '';
      items.forEach((item) => {
        const opt = document.createElement('option');
        opt.value = item.value;
        opt.textContent = item.label;
        selectEl.appendChild(opt);
      });
      if (defaultValue !== undefined) selectEl.value = defaultValue;
    }

    function range(min, max) {
      const arr = [];
      for (let i = min; i <= max; i++) arr.push(i);
      return arr;
    }

    // --- MIDI: dispositivos y estado ---

    function populateMidiOutputs(outputs) {
      const current = dom.midiOutput.value;
      dom.midiOutput.innerHTML = '';
      if (outputs.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No hay dispositivos MIDI conectados';
        dom.midiOutput.appendChild(opt);
        return;
      }
      outputs.forEach((output) => {
        const opt = document.createElement('option');
        opt.value = output.id;
        opt.textContent = output.name;
        dom.midiOutput.appendChild(opt);
      });
      if (outputs.some((o) => o.id === current)) dom.midiOutput.value = current;
    }

    function setMidiStatus(text, state) {
      // state: 'ok' | 'warn' | 'error'
      dom.midiStatusText.textContent = text;
      dom.midiStatusDot.className = 'midi-status__dot midi-status__dot--' + (state || 'warn');
    }

    // --- Lectura de parámetros del formulario ---

    function readGeneratorParams() {
      return {
        root: Number(dom.rootNote.value),
        scale: dom.scale.value,
        octave: Number(dom.octave.value),
        octaveMin: Number(dom.octaveMin.value),
        octaveMax: Number(dom.octaveMax.value),
        steps: Number(dom.steps.value),
        rate: dom.rate.value,
        density: Number(dom.density.value) / 100,
        complexity: Number(dom.complexity.value) / 100,
        rests: Number(dom.rests.value) / 100,
        accentAmount: Number(dom.accentAmount.value) / 100,
        velocityBase: 100,
        velocityAccentBoost: 22,
        seed: dom.seed.value,
        lockRhythm: dom.btnLockRhythm.getAttribute('aria-pressed') === 'true',
        lockPitch: dom.btnLockPitch.getAttribute('aria-pressed') === 'true',
      };
    }

    function readTempo() {
      return Number(dom.tempo.value);
    }

    function readSwing() {
      return Number(dom.swing.value);
    }

    function setSeed(seedValue) {
      dom.seed.value = seedValue;
    }

    // --- Sliders: mostrar el valor numérico actual junto al control ---

    function bindLiveValue(inputEl, outputEl, suffix) {
      const update = () => { outputEl.textContent = inputEl.value + (suffix || ''); };
      inputEl.addEventListener('input', update);
      update();
    }

    function bindKnobDisplays() {
      bindLiveValue(dom.density, dom.densityValue, '%');
      bindLiveValue(dom.complexity, dom.complexityValue, '%');
      bindLiveValue(dom.rests, dom.restsValue, '%');
      bindLiveValue(dom.accentAmount, dom.accentAmountValue, '%');
      bindLiveValue(dom.swing, dom.swingValue, '%');
    }

    // --- Render del step sequencer (solo visual en V0.1, sin edición) ---

    function renderPattern(pattern) {
      dom.stepGrid.innerHTML = '';
      dom.stepGrid.style.setProperty('--steps', pattern.steps);
      stepEls = [];

      for (let i = 0; i < pattern.steps; i++) {
        const isOnbeat = i % 2 === 0;
        const active = pattern.active[i];

        const stepEl = document.createElement('div');
        stepEl.className = 'step' + (isOnbeat ? ' step--onbeat' : ' step--offbeat') + (active ? '' : ' step--rest');

        const number = document.createElement('div');
        number.className = 'step__number';
        number.textContent = String(i + 1).padStart(2, '0');

        // --- Zona de nota: click activa/desactiva, drag vertical cambia el tono ---
        const note = document.createElement('div');
        note.className = 'step__note';
        note.title = 'Click: activar/desactivar · Arrastrar: cambiar nota';
        note.textContent = active ? Scales.midiToNoteName(pattern.note[i]) : '--';

        let dragBaseNote = null;
        attachDragHandlers(note, {
          onClick: () => { if (stepClickHandler) stepClickHandler(i); },
          onDragStart: () => { dragBaseNote = pattern.note[i]; },
          onDrag: (deltaY) => {
            if (!pattern.active[i] || dragBaseNote == null) return;
            const semitoneDelta = Math.round(-deltaY / PITCH_DRAG_PX_PER_SEMITONE);
            const target = dragBaseNote + semitoneDelta;
            const quantized = Scales.quantizeToScale(target, pattern.root, pattern.scale);
            pattern.note[i] = quantized;
            note.textContent = Scales.midiToNoteName(quantized);
          },
        });

        // --- Barra de velocity: drag vertical la modifica ---
        const velWrap = document.createElement('div');
        velWrap.className = 'step__vel';
        velWrap.title = 'Arrastrar: velocity';
        const velFill = document.createElement('div');
        velFill.className = 'step__vel-fill';
        velFill.style.height = active ? Math.round((pattern.velocity[i] / 127) * 100) + '%' : '0%';
        velWrap.appendChild(velFill);

        let dragBaseVelocity = null;
        attachDragHandlers(velWrap, {
          onDragStart: () => { dragBaseVelocity = pattern.velocity[i]; },
          onDrag: (deltaY) => {
            if (!pattern.active[i] || dragBaseVelocity == null) return;
            const newVel = clampVelocity(dragBaseVelocity + (-deltaY / VELOCITY_DRAG_PX_FULL_RANGE) * 127);
            pattern.velocity[i] = newVel;
            velFill.style.height = Math.round((newVel / 127) * 100) + '%';
          },
        });

        // --- Barra de gate/duración: drag vertical la modifica ---
        const gateWrap = document.createElement('div');
        gateWrap.className = 'step__gate';
        gateWrap.title = 'Arrastrar: duración de la nota (gate)';
        const gateFill = document.createElement('div');
        gateFill.className = 'step__gate-fill';
        gateFill.style.height = active ? Math.round((pattern.gate[i] / GATE_MAX) * 100) + '%' : '0%';
        gateWrap.appendChild(gateFill);

        let dragBaseGate = null;
        attachDragHandlers(gateWrap, {
          onDragStart: () => { dragBaseGate = pattern.gate[i]; },
          onDrag: (deltaY) => {
            if (!pattern.active[i] || dragBaseGate == null) return;
            const newGate = clampGate(dragBaseGate + (-deltaY / GATE_DRAG_PX_FULL_RANGE) * (GATE_MAX - GATE_MIN));
            pattern.gate[i] = newGate;
            gateFill.style.height = Math.round((newGate / GATE_MAX) * 100) + '%';
          },
        });

        const barsWrap = document.createElement('div');
        barsWrap.className = 'step__bars';
        barsWrap.appendChild(velWrap);
        barsWrap.appendChild(gateWrap);

        const accent = document.createElement('div');
        accent.className = 'step__accent' + (pattern.accent[i] ? ' step__accent--on' : '');

        stepEl.appendChild(number);
        stepEl.appendChild(note);
        stepEl.appendChild(barsWrap);
        stepEl.appendChild(accent);

        dom.stepGrid.appendChild(stepEl);
        stepEls.push(stepEl);
      }

      // Tras un re-render (p.ej. regeneración en vivo mientras suena) los
      // elementos son nuevos: volvemos a marcar el paso que está sonando.
      if (highlightedIndex >= 0 && stepEls[highlightedIndex]) {
        stepEls[highlightedIndex].classList.add('step--playing');
      }

      dom.stepGridEmpty.style.display = 'none';
    }

    /**
     * Programa el resaltado visual de un paso en el momento exacto en que
     * el scheduler lo agendó (timeMs, dominio performance.now()). Se usa
     * un setTimeout simple: como el look-ahead agenda con ~100ms de
     * anticipación, alcanza para que la iluminación se vea sincronizada
     * a simple vista sin necesitar un loop de requestAnimationFrame.
     */
    function scheduleStepHighlight(stepIndex, timeMs) {
      const delay = Math.max(0, timeMs - performance.now());
      const id = setTimeout(() => {
        highlightTimeouts = highlightTimeouts.filter((t) => t !== id);
        highlightStep(stepIndex);
      }, delay);
      highlightTimeouts.push(id);
    }

    function highlightStep(stepIndex) {
      highlightedIndex = stepIndex;
      stepEls.forEach((el) => el.classList.remove('step--playing'));
      const el = stepEls[stepIndex];
      if (el) el.classList.add('step--playing');
    }

    function clearHighlightTimeouts() {
      highlightTimeouts.forEach((id) => clearTimeout(id));
      highlightTimeouts = [];
      highlightedIndex = -1;
      stepEls.forEach((el) => el.classList.remove('step--playing'));
    }

    function setPlayingState(isPlaying) {
      dom.btnPlay.classList.toggle('btn--active', isPlaying);
      dom.btnPlay.textContent = isPlaying ? 'Playing…' : 'Play';
      if (!isPlaying) clearHighlightTimeouts();
    }

    function bindToggleButton(buttonEl) {
      buttonEl.addEventListener('click', () => {
        const pressed = buttonEl.getAttribute('aria-pressed') === 'true';
        buttonEl.setAttribute('aria-pressed', String(!pressed));
      });
    }

    // --- API pública ---

    return {
      dom,
      populateStaticOptions,
      populateMidiOutputs,
      setMidiStatus,
      readGeneratorParams,
      readTempo,
      readSwing,
      setSeed,
      bindKnobDisplays,
      bindToggleButton,
      renderPattern,
      scheduleStepHighlight,
      setPlayingState,
      setStepClickHandler(fn) { stepClickHandler = fn; },
    };
  }

  global.BG = global.BG || {};
  global.BG.UI = { createUI };
})(typeof window !== 'undefined' ? window : globalThis);
