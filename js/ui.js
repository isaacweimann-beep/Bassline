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

  // Sensibilidad de los gestos de arrastre vertical.
  const GATE_DRAG_PX_FULL_RANGE = 120;   // cuántos px de arrastre cubren todo el rango de gate
  const VELOCITY_DRAG_PX_FULL_RANGE = 120; // cuántos px de arrastre cubren todo el rango de velocity
  const GATE_MIN = 0.1;
  const GATE_MAX = 1.5;

  // Sistema de coordenadas interno del SVG de la curva de pitch (unidades
  // arbitrarias, no píxeles reales: el SVG se estira con preserveAspectRatio
  //="none" para llenar el contenedor, así que esto es independiente del
  // tamaño real en pantalla).
  const CURVE_VIEW_W = 1000;
  const CURVE_VIEW_H = 100;
  const PITCH_RANGE_PADDING = 2; // semitonos de margen arriba/abajo del rango visible

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  /** Rango de notas (MIDI) a mostrar en la curva, con margen, a partir del patrón actual. */
  function midiRangeForPattern(pattern) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < pattern.steps; i++) {
      const n = pattern.note[i];
      if (n == null) continue;
      if (n < min) min = n;
      if (n > max) max = n;
    }
    if (!isFinite(min)) { min = 48; max = 60; }
    if (min === max) { min -= 3; max += 3; }
    return { min: min - PITCH_RANGE_PADDING, max: max + PITCH_RANGE_PADDING };
  }

  function midiToY(midi, range) {
    const t = (midi - range.min) / (range.max - range.min);
    return CURVE_VIEW_H - t * CURVE_VIEW_H; // más agudo = más arriba
  }

  function yToMidiRaw(y, range) {
    const t = 1 - y / CURVE_VIEW_H;
    return range.min + t * (range.max - range.min);
  }

  function stepXCenter(i, steps) {
    return ((i + 0.5) / steps) * CURVE_VIEW_W;
  }

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

  /**
   * Gesto de "pintar" continuo: a diferencia de attachDragHandlers, acá no
   * se distingue click de drag — CADA mousedown/mousemove dispara onPaint
   * de inmediato, con la posición relativa al elemento (x,y) y el evento
   * crudo (para leer clientX/clientY, útil para posicionar un tooltip).
   * Se usa en la curva de pitch: al arrastrar de lado a lado, cada paso
   * por el que pasa el mouse toma la altura correspondiente a esa posición
   * vertical — así se puede "dibujar" una melodía sin soltar el mouse.
   */
  function attachPaintDrag(el, handlers) {
    function pointFromEvent(ev) {
      const rect = el.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top, rect };
    }

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (handlers.onDragStart) handlers.onDragStart();

      function apply(ev) {
        const p = pointFromEvent(ev);
        handlers.onPaint(p.x, p.y, p.rect, ev);
      }
      apply(e);

      function onMove(ev) { apply(ev); }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (handlers.onDragEnd) handlers.onDragEnd();
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
      clockModeText: $('clockModeText'),

      btnPlay: $('btnPlay'),
      btnStop: $('btnStop'),
      btnPanic: $('btnPanic'),
      tempo: $('tempo'),
      swing: $('swing'),
      swingValue: $('swingValue'),
      btnShiftLeft: $('btnShiftLeft'),
      btnShiftRight: $('btnShiftRight'),
      btnSaveSlot: $('btnSaveSlot'),
      slotButtons: $('slotButtons'),
      midiOutput: $('midiOutput'),
      midiChannel: $('midiChannel'),

      rootNote: $('rootNote'),
      scale: $('scale'),
      octave: $('octave'),
      octaveValue: $('octaveValue'),
      octaveMin: $('octaveMin'),
      octaveMax: $('octaveMax'),
      steps: $('steps'),
      rate: $('rate'),

      density: $('density'),
      complexity: $('complexity'),
      rests: $('rests'),
      accentAmount: $('accentAmount'),
      weightRoot: $('weightRoot'),
      weightFifth: $('weightFifth'),
      weightThird: $('weightThird'),
      weightOther: $('weightOther'),
      variationShape: $('variationShape'),
      variationAmount: $('variationAmount'),
      variationAmountValue: $('variationAmountValue'),
      densityValue: $('densityValue'),
      complexityValue: $('complexityValue'),
      restsValue: $('restsValue'),
      accentAmountValue: $('accentAmountValue'),
      weightRootValue: $('weightRootValue'),
      weightFifthValue: $('weightFifthValue'),
      weightThirdValue: $('weightThirdValue'),
      weightOtherValue: $('weightOtherValue'),

      seed: $('seed'),
      btnNewSeed: $('btnNewSeed'),
      btnGenerate: $('btnGenerate'),
      btnLockRhythm: $('btnLockRhythm'),
      btnLockPitch: $('btnLockPitch'),

      noteDisplay: $('noteDisplay'),
      noteDisplayEmpty: $('noteDisplayEmpty'),
      pitchTooltip: $('pitchTooltip'),
    };

    // El playhead es UN solo elemento persistente que se vuelve a insertar
    // en el contenedor después de cada render (que limpia todo con
    // innerHTML=''), en vez de recrearse — así la referencia nunca queda
    // desactualizada.
    const playheadEl = document.createElement('div');
    playheadEl.className = 'playhead';
    playheadEl.id = 'playhead';
    playheadEl.style.display = 'none';
    dom.noteDisplay.appendChild(playheadEl);

    let highlightedIndex = -1; // paso que está sonando (-1 = ninguno)
    let currentStepsCount = 16;
    let highlightTimeouts = [];
    let stepClickHandler = null; // callback(stepIndex) provisto por app.js
    let slotClickHandler = null; // callback(slotIndex) provisto por app.js

    // --- Poblado de selects estáticos (independientes del Pattern) ---

    function populateStaticOptions() {
      fillSelect(dom.rootNote, Scales.NOTE_NAMES.map((name, i) => ({ value: i, label: name })));
      fillSelect(dom.scale, Scales.SCALE_NAMES.map((name) => ({ value: name, label: name })));
      dom.octave.value = 2;
      fillSelect(dom.octaveMin, range(-2, 0).map((o) => ({ value: o, label: (o > 0 ? '+' : '') + o })), -1);
      fillSelect(dom.octaveMax, range(0, 2).map((o) => ({ value: o, label: (o > 0 ? '+' : '') + o })), 1);
      fillSelect(dom.steps, [8, 16, 32].map((s) => ({ value: s, label: s + ' pasos' })), 16);
      fillSelect(dom.rate, ['1/4', '1/8', '1/16', '1/32'].map((r) => ({ value: r, label: r })), '1/16');
      fillSelect(dom.midiChannel, range(1, 16).map((c) => ({ value: c, label: 'canal ' + c })), 1);
      fillSelect(dom.variationShape, [
        { value: 'none', label: 'none (recto)' },
        { value: 'ramp-up', label: 'ramp up' },
        { value: 'ramp-down', label: 'ramp down' },
        { value: 'wave', label: 'wave' },
        { value: 'pulse', label: 'pulse' },
      ], 'none');

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

    /**
     * Muestra qué reloj quedó activo en el scheduler (se sabe recién al
     * arrancar la reproducción). Sirve para confirmar en el navegador que
     * la protección contra el throttling de segundo plano está funcionando.
     */
    function setClockMode(mode) {
      if (!mode) { dom.clockModeText.textContent = ''; return; }
      dom.clockModeText.textContent = mode === 'worker'
        ? 'reloj: worker'
        : 'reloj: hilo principal (sin protección de 2º plano)';
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
        degreeWeights: {
          root: Number(dom.weightRoot.value),
          fifth: Number(dom.weightFifth.value),
          third: Number(dom.weightThird.value),
          other: Number(dom.weightOther.value),
        },
        variationShape: dom.variationShape.value,
        variationAmount: Number(dom.variationAmount.value) / 100,
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
      // Los pesos son valores relativos, no un porcentaje del total (el
      // motor normaliza solo), así que se muestran como número simple.
      bindLiveValue(dom.weightRoot, dom.weightRootValue, '');
      bindLiveValue(dom.weightFifth, dom.weightFifthValue, '');
      bindLiveValue(dom.weightThird, dom.weightThirdValue, '');
      bindLiveValue(dom.weightOther, dom.weightOtherValue, '');
      bindLiveValue(dom.variationAmount, dom.variationAmountValue, '%');
      bindLiveValue(dom.octave, dom.octaveValue, '');

      [dom.swing, dom.density, dom.complexity, dom.rests, dom.accentAmount,
        dom.weightRoot, dom.weightFifth, dom.weightThird, dom.weightOther,
        dom.variationAmount].forEach(enhanceAsDial);
    }

    // Mantiene cada <input type="range"> como fuente del valor y de sus
    // eventos; el dial solo cambia la forma de interacción y presentación.
    function enhanceAsDial(inputEl) {
      const dial = document.createElement('span');
      dial.className = 'dial';
      const indicator = document.createElement('span');
      indicator.className = 'dial__indicator';
      dial.appendChild(indicator);
      inputEl.parentNode.insertBefore(dial, inputEl);
      dial.appendChild(inputEl);
      inputEl.classList.add('dial__input');
      inputEl.setAttribute('aria-valuetext', inputEl.value);
      if (inputEl.parentElement.parentElement.classList.contains('field')) {
        inputEl.parentElement.parentElement.classList.add('field--dial');
      }

      const update = () => {
        const min = Number(inputEl.min || 0);
        const max = Number(inputEl.max || 100);
        const progress = max === min ? 0 : clamp((Number(inputEl.value) - min) / (max - min), 0, 1);
        dial.style.setProperty('--dial-progress', (progress * 75) + '%');
        dial.style.setProperty('--dial-angle', (-135 + progress * 270) + 'deg');
        inputEl.setAttribute('aria-valuetext', inputEl.value);
      };

      function setFromPointer(event) {
        const rect = dial.getBoundingClientRect();
        const x = event.clientX - (rect.left + rect.width / 2);
        const y = event.clientY - (rect.top + rect.height / 2);
        let angle = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        if (angle >= 45 && angle <= 135) return;
        if (angle <= 45) angle += 360;
        const progress = clamp((angle - 135) / 270, 0, 1);
        const min = Number(inputEl.min || 0);
        const max = Number(inputEl.max || 100);
        const step = Number(inputEl.step || 1);
        const raw = min + progress * (max - min);
        const value = min + Math.round((raw - min) / step) * step;
        inputEl.value = String(clamp(value, min, max));
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }

      dial.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        dial.setPointerCapture(event.pointerId);
        setFromPointer(event);
      });
      dial.addEventListener('pointermove', (event) => {
        if (dial.hasPointerCapture(event.pointerId)) setFromPointer(event);
      });
      inputEl.addEventListener('input', update);
      update();
    }

    // --- Tooltip flotante con el nombre de nota, visible mientras se arrastra la curva ---

    function showPitchTooltip() { dom.pitchTooltip.hidden = false; }
    function hidePitchTooltip() { dom.pitchTooltip.hidden = true; }
    function updatePitchTooltip(clientX, clientY, midi, stepIndex) {
      dom.pitchTooltip.textContent = Scales.midiToNoteName(midi) + ' (paso ' + (stepIndex + 1) + ')';
      dom.pitchTooltip.style.left = (clientX + 14) + 'px';
      dom.pitchTooltip.style.top = (clientY - 28) + 'px';
    }

    // --- Curva de pitch: SVG con una polilínea + un punto por paso ---

    function buildPitchCurve(pattern) {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'pitch-curve');
      svg.setAttribute('viewBox', '0 0 ' + CURVE_VIEW_W + ' ' + CURVE_VIEW_H);
      svg.setAttribute('preserveAspectRatio', 'none');

      const range = midiRangeForPattern(pattern);
      const points = [];
      const circles = [];

      const polyline = document.createElementNS(ns, 'polyline');
      polyline.setAttribute('class', 'pitch-curve__line');

      for (let i = 0; i < pattern.steps; i++) {
        const x = stepXCenter(i, pattern.steps);
        const y = midiToY(pattern.note[i], range);
        points.push(x + ',' + y);

        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', 3.2);
        circle.dataset.step = i;
        circle.dataset.midi = pattern.note[i];
        circle.setAttribute('class', 'pitch-curve__dot'
          + (i % 2 === 0 ? ' pitch-curve__dot--onbeat' : ' pitch-curve__dot--offbeat')
          + (pattern.active[i] ? '' : ' pitch-curve__dot--rest'));
        circles.push(circle);
      }

      polyline.setAttribute('points', points.join(' '));
      svg.appendChild(polyline);
      circles.forEach((c) => svg.appendChild(c));

      attachPaintDrag(svg, {
        onDragStart: showPitchTooltip,
        onDragEnd: hidePitchTooltip,
        onPaint: (x, y, rect, ev) => {
          const vbX = clamp((x / rect.width) * CURVE_VIEW_W, 0, CURVE_VIEW_W - 0.001);
          const vbY = clamp((y / rect.height) * CURVE_VIEW_H, 0, CURVE_VIEW_H);
          const stepIndex = clamp(Math.floor(vbX / (CURVE_VIEW_W / pattern.steps)), 0, pattern.steps - 1);
          const rawMidi = yToMidiRaw(vbY, range);
          const quantized = Scales.quantizeToScale(Math.round(rawMidi), pattern.root, pattern.scale);

          pattern.note[stepIndex] = quantized;

          const newY = midiToY(quantized, range);
          circles[stepIndex].setAttribute('cy', newY);
          circles[stepIndex].dataset.midi = quantized;
          points[stepIndex] = stepXCenter(stepIndex, pattern.steps) + ',' + newY;
          polyline.setAttribute('points', points.join(' '));

          updatePitchTooltip(ev.clientX, ev.clientY, quantized, stepIndex);
        },
      });

      return svg;
    }

    // --- Note row: un punto chico por paso. Click = on/off, drag = velocity ---

    function buildNoteRow(pattern) {
      const row = document.createElement('div');
      row.className = 'note-row';

      for (let i = 0; i < pattern.steps; i++) {
        const isOnbeat = i % 2 === 0;
        const active = pattern.active[i];

        const dot = document.createElement('div');
        dot.className = 'note-dot' + (isOnbeat ? ' note-dot--onbeat' : ' note-dot--offbeat')
          + (active ? '' : ' note-dot--rest')
          + (pattern.accent[i] ? ' note-dot--accent' : '');
        dot.dataset.step = i;
        dot.dataset.active = String(active);
        dot.dataset.velocity = pattern.velocity[i];
        dot.title = 'Click: activar/desactivar · Arrastrar: velocity';

        const fill = document.createElement('div');
        fill.className = 'note-dot__fill';
        const size = active ? 3 + Math.round((pattern.velocity[i] / 127) * 9) : 0;
        fill.style.width = size + 'px';
        fill.style.height = size + 'px';
        dot.appendChild(fill);

        let dragBaseVelocity = null;
        attachDragHandlers(dot, {
          onClick: () => { if (stepClickHandler) stepClickHandler(i); },
          onDragStart: () => { dragBaseVelocity = pattern.velocity[i]; },
          onDrag: (deltaY) => {
            if (!pattern.active[i] || dragBaseVelocity == null) return;
            const newVel = clampVelocity(dragBaseVelocity + (-deltaY / VELOCITY_DRAG_PX_FULL_RANGE) * 127);
            pattern.velocity[i] = newVel;
            dot.dataset.velocity = newVel;
            const s = 3 + Math.round((newVel / 127) * 9);
            fill.style.width = s + 'px';
            fill.style.height = s + 'px';
          },
        });

        row.appendChild(dot);
      }

      return row;
    }

    // --- Gate row: una barra fina por paso, drag vertical cambia la duración ---

    function buildGateRow(pattern) {
      const row = document.createElement('div');
      row.className = 'gate-row';

      for (let i = 0; i < pattern.steps; i++) {
        const active = pattern.active[i];

        const bar = document.createElement('div');
        bar.className = 'gate-bar' + (active ? '' : ' gate-bar--rest');
        bar.dataset.step = i;
        bar.dataset.gate = pattern.gate[i];
        bar.title = 'Arrastrar: duración de la nota (gate)';

        const fill = document.createElement('div');
        fill.className = 'gate-bar__fill';
        fill.style.height = active ? Math.round((pattern.gate[i] / GATE_MAX) * 100) + '%' : '0%';
        bar.appendChild(fill);

        let dragBaseGate = null;
        attachDragHandlers(bar, {
          onDragStart: () => { dragBaseGate = pattern.gate[i]; },
          onDrag: (deltaY) => {
            if (!pattern.active[i] || dragBaseGate == null) return;
            const newGate = clampGate(dragBaseGate + (-deltaY / GATE_DRAG_PX_FULL_RANGE) * (GATE_MAX - GATE_MIN));
            pattern.gate[i] = newGate;
            bar.dataset.gate = newGate;
            fill.style.height = Math.round((newGate / GATE_MAX) * 100) + '%';
          },
        });

        row.appendChild(bar);
      }

      return row;
    }

    function renderPattern(pattern) {
      currentStepsCount = pattern.steps;
      dom.noteDisplay.innerHTML = '';

      dom.noteDisplay.appendChild(buildPitchCurve(pattern));
      dom.noteDisplay.appendChild(buildNoteRow(pattern));
      dom.noteDisplay.appendChild(buildGateRow(pattern));
      dom.noteDisplay.appendChild(playheadEl); // innerHTML='' lo desprendió: se vuelve a insertar

      updatePlayheadPosition();
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
      updatePlayheadPosition();
    }

    function updatePlayheadPosition() {
      if (highlightedIndex < 0 || currentStepsCount <= 0) {
        playheadEl.style.display = 'none';
        delete playheadEl.dataset.step;
        return;
      }
      const pct = (highlightedIndex / currentStepsCount) * 100;
      const widthPct = 100 / currentStepsCount;
      playheadEl.style.left = pct + '%';
      playheadEl.style.width = widthPct + '%';
      playheadEl.style.display = 'block';
      playheadEl.dataset.step = String(highlightedIndex);
    }

    function clearHighlightTimeouts() {
      highlightTimeouts.forEach((id) => clearTimeout(id));
      highlightTimeouts = [];
      highlightedIndex = -1;
      updatePlayheadPosition();
    }

    /**
     * Dibuja los 8 botones de slot. `states` es un array de
     * {filled, active}: filled = tiene un patrón guardado, active = es el
     * que está cargado ahora mismo (para saber de un vistazo si lo que
     * estás editando ya se guardó o se te va a perder si cambiás de slot).
     */
    function renderSlotButtons(states) {
      dom.slotButtons.innerHTML = '';
      states.forEach((state, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn--ghost btn--small slot-btn'
          + (state.filled ? ' slot-btn--filled' : '')
          + (state.active ? ' slot-btn--active' : '');
        btn.textContent = String(i + 1);
        btn.title = state.filled ? ('Cargar variante ' + (i + 1)) : 'Vacío — activá "save" y tocá acá para guardar';
        btn.addEventListener('click', () => { if (slotClickHandler) slotClickHandler(i); });
        dom.slotButtons.appendChild(btn);
      });
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
      setClockMode,
      readGeneratorParams,
      readTempo,
      readSwing,
      setSeed,
      bindKnobDisplays,
      bindToggleButton,
      renderPattern,
      scheduleStepHighlight,
      setPlayingState,
      renderSlotButtons,
      setStepClickHandler(fn) { stepClickHandler = fn; },
      setSlotClickHandler(fn) { slotClickHandler = fn; },
    };
  }

  global.BG = global.BG || {};
  global.BG.UI = { createUI };
})(typeof window !== 'undefined' ? window : globalThis);
