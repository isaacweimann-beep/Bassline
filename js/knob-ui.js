/**
 * knob-ui.js
 * -----------------------------------------------------------------------
 * Capa PURAMENTE VISUAL. No conoce generación, MIDI, ni el resto de la
 * lógica de la app. Lo único que hace es tomar un <input type="range">
 * o un <select> ya existente (con su id, su lógica y sus listeners
 * intactos) y:
 *
 *   1. Ocultarlo (visualmente) — sigue existiendo en el DOM, con el
 *      mismo id, el mismo .value, y disparando los mismos eventos.
 *   2. Montar un control nuevo (un knob circular, un ciclador de
 *      iconos, o un stepper vertical) en el lugar que se le indique.
 *   3. Cuando el usuario interactúa con el control nuevo, actualiza
 *      el elemento original (.value / .selectedIndex) y dispara un
 *      evento real ('input' o 'change', con bubbles:true) sobre ÉL —
 *      exactamente como si el usuario hubiera movido el control viejo.
 *      Así, todo el código que ya escucha esos eventos (en app.js)
 *      sigue funcionando sin que se le haya tocado una sola línea.
 *   4. El elemento original también puede tener MÁS DE UN control
 *      nuevo montado en distintos lugares (p.ej. un knob de "rest" en
 *      la columna Onbeat y otro en la columna Offbeat): cada uno
 *      escucha los eventos del original para mantenerse sincronizado,
 *      así que ambos siempre muestran el mismo valor real.
 * -----------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const KNOB_RADIUS = 15;
  const KNOB_CIRCUMFERENCE = 2 * Math.PI * KNOB_RADIUS;

  function num(v, fallback) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /** Oculta visualmente un elemento sin sacarlo del DOM ni tocar su .value. */
  function hideOriginal(el) {
    el.classList.add('knob-source-hidden');
  }

  // -----------------------------------------------------------------
  // Knob circular, para <input type="range">
  // -----------------------------------------------------------------

  /**
   * @param {HTMLInputElement} inputEl - el <input type="range"> real
   * @param {Object} opts
   *   mountTo: elemento donde insertar el knob (si se omite, se inserta
   *            justo después del input original)
   *   size: 'lg' | 'md' | 'sm' | 'xs' (default 'md')
   *   label: texto chico debajo del knob (default: vacío)
   *   suffix: se agrega al número mostrado (ej. '%')
   *   sensitivity: px de arrastre vertical para cubrir el rango completo
   */
  function createKnob(inputEl, opts) {
    opts = opts || {};
    const size = opts.size || 'md';
    const suffix = opts.suffix || '';
    const sensitivity = opts.sensitivity || 130;

    hideOriginal(inputEl);

    const wrap = document.createElement('div');
    wrap.className = 'knob knob--' + size;
    if (opts.title) wrap.title = opts.title;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('class', 'knob__dial');

    const track = document.createElementNS(ns, 'circle');
    track.setAttribute('class', 'knob__track');
    track.setAttribute('cx', '18');
    track.setAttribute('cy', '18');
    track.setAttribute('r', String(KNOB_RADIUS));

    const fill = document.createElementNS(ns, 'circle');
    fill.setAttribute('class', 'knob__fill');
    fill.setAttribute('cx', '18');
    fill.setAttribute('cy', '18');
    fill.setAttribute('r', String(KNOB_RADIUS));

    svg.appendChild(track);
    svg.appendChild(fill);
    wrap.appendChild(svg);

    const valueEl = document.createElement('div');
    valueEl.className = 'knob__value';
    wrap.appendChild(valueEl);

    if (opts.label) {
      const labelEl = document.createElement('div');
      labelEl.className = 'knob__label';
      labelEl.textContent = opts.label;
      wrap.appendChild(labelEl);
    }

    function fraction() {
      const min = num(inputEl.min, 0);
      const max = num(inputEl.max, 100);
      const v = num(inputEl.value, min);
      return Math.max(0, Math.min(1, (v - min) / (max - min)));
    }

    function render() {
      const frac = fraction();
      fill.style.strokeDasharray = (KNOB_CIRCUMFERENCE * frac) + ' ' + KNOB_CIRCUMFERENCE;
      valueEl.textContent = Math.round(num(inputEl.value, 0)) + suffix;
    }

    // Se re-dibuja cada vez que el valor real cambia, venga de donde venga
    // (este mismo knob, otro knob espejado, o cualquier otro código).
    inputEl.addEventListener('input', render);
    render();

    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const min = num(inputEl.min, 0);
      const max = num(inputEl.max, 100);
      const step = num(inputEl.step, 1);
      const startValue = num(inputEl.value, min);
      const startY = e.clientY;

      function onMove(ev) {
        const deltaY = ev.clientY - startY;
        let raw = startValue + (-deltaY / sensitivity) * (max - min);
        raw = Math.max(min, Math.min(max, raw));
        raw = Math.round(raw / step) * step;
        if (String(raw) !== inputEl.value) {
          inputEl.value = String(raw);
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    const mountTo = opts.mountTo;
    if (mountTo) mountTo.appendChild(wrap);
    else inputEl.insertAdjacentElement('afterend', wrap);

    return { el: wrap, render };
  }

  // -----------------------------------------------------------------
  // Selector de forma por iconos, para <select> (cicla al hacer click)
  // -----------------------------------------------------------------

  const SHAPE_ICONS = {
    'none': '<svg viewBox="0 0 24 24"><line x1="2" y1="12" x2="22" y2="12"/></svg>',
    'ramp-up': '<svg viewBox="0 0 24 24"><polyline points="2,20 22,4"/></svg>',
    'ramp-down': '<svg viewBox="0 0 24 24"><polyline points="2,4 22,20"/></svg>',
    'wave': '<svg viewBox="0 0 24 24"><path d="M2 12 Q7 2 12 12 T22 12" fill="none"/></svg>',
    'pulse': '<svg viewBox="0 0 24 24"><polyline points="2,18 10,18 10,6 22,6"/></svg>',
  };

  /**
   * @param {HTMLSelectElement} selectEl
   * @param {Object} opts
   *   mountTo: elemento donde insertar el botón
   *   icons: mapa {valorDeOption: svgString} (default: SHAPE_ICONS)
   */
  function createShapeCycler(selectEl, opts) {
    opts = opts || {};
    const icons = opts.icons || SHAPE_ICONS;

    hideOriginal(selectEl);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shape-cycler';

    function render() {
      const val = selectEl.value;
      btn.innerHTML = icons[val] || icons.none || '';
      btn.setAttribute('aria-label', 'shape: ' + val);
      btn.title = 'Shape: ' + val + ' (click para cambiar)';
    }

    selectEl.addEventListener('change', render);
    render();

    btn.addEventListener('click', () => {
      const count = selectEl.options.length;
      if (count === 0) return;
      const next = (selectEl.selectedIndex + 1) % count;
      selectEl.selectedIndex = next;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const mountTo = opts.mountTo;
    if (mountTo) mountTo.appendChild(btn);
    else selectEl.insertAdjacentElement('afterend', btn);

    return { el: btn, render };
  }

  // -----------------------------------------------------------------
  // Stepper vertical, para <select> con pocas opciones (ej. octava)
  // -----------------------------------------------------------------

  /**
   * @param {HTMLSelectElement} selectEl
   * @param {Object} opts
   *   mountTo: elemento donde insertar el stepper
   *   displayValue: (option) => texto a mostrar en cada posición
   *                 (default: option.value, más compacto que option.textContent)
   */
  function createVerticalStepper(selectEl, opts) {
    opts = opts || {};
    const displayValue = opts.displayValue || ((opt) => opt.value);

    hideOriginal(selectEl);

    const wrap = document.createElement('div');
    wrap.className = 'v-stepper';

    const ticks = Array.from(selectEl.options).map((opt, i) => {
      const tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'v-stepper__tick';
      tick.textContent = displayValue(opt);
      tick.addEventListener('click', () => {
        selectEl.selectedIndex = i;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      });
      wrap.appendChild(tick);
      return tick;
    });

    function render() {
      ticks.forEach((tick, i) => {
        tick.classList.toggle('v-stepper__tick--active', i === selectEl.selectedIndex);
      });
    }

    selectEl.addEventListener('change', render);
    render();

    const mountTo = opts.mountTo;
    if (mountTo) mountTo.appendChild(wrap);
    else selectEl.insertAdjacentElement('afterend', wrap);

    return { el: wrap, render };
  }

  /**
   * Punto de entrada único: monta todos los controles visuales nuevos de
   * la Etapa 1 (Generator: Onbeat/Offbeat, pitch weights; Musical: octava),
   * usando las referencias que ya expone ui.dom. No conoce nada de la
   * lógica de generación: solo sabe qué <input>/<select> corresponde a
   * cada knob y dónde montarlo.
   */
  function enhanceApp(ui) {
    const $ = (id) => document.getElementById(id);
    const dom = ui.dom;

    // --- Onbeat / Offbeat: knob principal (density/complexity, ya independientes) ---
    createKnob(dom.density, { size: 'lg', suffix: '%', mountTo: $('mountDensityKnob') });
    createKnob(dom.complexity, { size: 'lg', suffix: '%', mountTo: $('mountComplexityKnob') });

    // --- Rest / Accent: un parámetro real por grupo, ya no espejados ---
    createKnob(dom.restsOnbeat, { size: 'sm', suffix: '%', label: 'rest', mountTo: $('mountRestKnobA') });
    createKnob(dom.restsOffbeat, { size: 'sm', suffix: '%', label: 'rest', mountTo: $('mountRestKnobB') });
    createKnob(dom.accentOnbeat, { size: 'sm', suffix: '%', label: 'accent', mountTo: $('mountAccentKnobA') });
    createKnob(dom.accentOffbeat, { size: 'sm', suffix: '%', label: 'accent', mountTo: $('mountAccentKnobB') });

    // --- Shape / Amount: un Variator real por grupo, ya no espejados ---
    createShapeCycler(dom.variationShapeOnbeat, { mountTo: $('mountShapeA') });
    createShapeCycler(dom.variationShapeOffbeat, { mountTo: $('mountShapeB') });
    createKnob(dom.variationAmountOnbeat, { size: 'xs', label: 'amt', mountTo: $('mountAmountKnobA') });
    createKnob(dom.variationAmountOffbeat, { size: 'xs', label: 'amt', mountTo: $('mountAmountKnobB') });

    // --- Pitch weights: 4 knobs chicos ---
    createKnob(dom.weightRoot, { size: 'sm', label: 'root', mountTo: $('mountWeightRoot') });
    createKnob(dom.weightFifth, { size: 'sm', label: 'fifth', mountTo: $('mountWeightFifth') });
    createKnob(dom.weightThird, { size: 'sm', label: 'third', mountTo: $('mountWeightThird') });
    createKnob(dom.weightOther, { size: 'sm', label: 'other', mountTo: $('mountWeightOther') });

    // --- Octava: mismo <select> (0-6), stepper vertical en vez de dropdown ---
    createVerticalStepper(dom.octave, { mountTo: $('mountOctaveStepper') });
  }

  global.BG = global.BG || {};
  global.BG.KnobUI = { createKnob, createShapeCycler, createVerticalStepper, enhanceApp, SHAPE_ICONS };
})(typeof window !== 'undefined' ? window : globalThis);
