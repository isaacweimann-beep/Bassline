const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});

const { window } = dom;

// jsdom no calcula layout real: getBoundingClientRect() da todo en 0 por
// defecto. Lo necesitamos para el drag de "pintar" sobre la curva de pitch
// (que convierte clientX/clientY a coordenadas relativas al elemento), así
// que lo fijamos a un tamaño conocido. No afecta nada más: es lo único que
// usa getBoundingClientRect en toda la app.
window.Element.prototype.getBoundingClientRect = function () {
  return { width: 800, height: 72, top: 0, left: 0, right: 800, bottom: 72, x: 0, y: 0 };
};

// --- Mock de Web MIDI API (jsdom no la implementa) ---
const sentMessages = [];
const fakeOutput = {
  id: 'fake-out-1',
  name: 'Fake Synth (test)',
  send(data, timestamp) {
    sentMessages.push({ data: Array.from(data), timestamp });
  },
};

window.navigator.requestMIDIAccess = async () => ({
  outputs: new Map([[fakeOutput.id, fakeOutput]]),
  inputs: new Map(),
  onstatechange: null,
});

// Cargar los scripts de la app en orden, tal como hace index.html
const scripts = [
  'js/scales.js', 'js/rng.js', 'js/pattern.js', 'js/generator.js',
  'js/midi.js', 'js/clock.js', 'js/sequencer.js', 'js/ui.js', 'js/app.js',
];

for (const rel of scripts) {
  const code = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  window.eval(code);
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** Click = mousedown + mouseup sin moverse (por debajo del threshold de drag). */
function click(el) {
  el.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 0, clientY: 100, bubbles: true }));
  window.document.dispatchEvent(new window.MouseEvent('mouseup', { clientX: 0, clientY: 100, bubbles: true }));
}

/**
 * Drag genérico. Para note-dot/gate-bar (solo leen clientY) alcanza con
 * fromY/toY. Para la curva de pitch (que necesita saber sobre qué paso
 * está el cursor) hay que pasar también fromX/toX.
 */
function drag(el, { fromX = 0, toX = fromX, fromY, toY }) {
  el.dispatchEvent(new window.MouseEvent('mousedown', { clientX: fromX, clientY: fromY, bubbles: true }));
  window.document.dispatchEvent(new window.MouseEvent('mousemove', { clientX: toX, clientY: toY, bubbles: true }));
  window.document.dispatchEvent(new window.MouseEvent('mouseup', { clientX: toX, clientY: toY, bubbles: true }));
}

function setSlider(doc, id, value) {
  const el = doc.getElementById(id);
  el.value = String(value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function setSelect(doc, id, value) {
  const el = doc.getElementById(id);
  el.value = String(value);
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

/**
 * Snapshot del patrón leído directamente del DOM del nuevo Note Display
 * (3 franjas). A diferencia del diseño viejo (que mostraba el nombre de
 * la nota como texto), ahora la altura se lee del atributo data-midi que
 * cada punto de la curva de pitch lleva (no se muestra como texto: el
 * tooltip flotante cumple ese rol solo mientras se arrastra).
 */
function makeSnapshotter(doc) {
  return function snapshotSteps() {
    const noteDots = Array.from(doc.querySelectorAll('#noteDisplay .note-dot'));
    const pitchDots = Array.from(doc.querySelectorAll('#noteDisplay .pitch-curve__dot'));
    const gateBars = Array.from(doc.querySelectorAll('#noteDisplay .gate-bar'));
    return noteDots.map((dot, i) => ({
      active: dot.dataset.active === 'true',
      velocity: Number(dot.dataset.velocity),
      accent: dot.classList.contains('note-dot--accent'),
      midi: Number(pitchDots[i].dataset.midi),
      note: window.BG.Scales.midiToNoteName(Number(pitchDots[i].dataset.midi)),
      gate: Number(gateBars[i].dataset.gate),
    }));
  };
}

async function run() {
  // jsdom ya dispara 'DOMContentLoaded' solo al parsear el HTML (por eso NO
  // lo disparamos de nuevo acá: hacerlo duplicaría todos los listeners que
  // app.js registra en su handler de init).
  await wait(50); // dejar que initMidi() (async) resuelva y puebla los selects

  const doc = window.document;
  const snapshotSteps = makeSnapshotter(doc);
  const seedInput = doc.getElementById('seed');

  const noteDots = () => Array.from(doc.getElementById('noteDisplay').querySelectorAll('.note-dot'));

  assert(noteDots().length === 16, 'debería renderizar 16 pasos por defecto, encontró ' + noteDots().length);
  console.log('OK: patrón inicial se renderiza con', noteDots().length, 'pasos');

  const midiOutputSelect = doc.getElementById('midiOutput');
  assert(midiOutputSelect.options.length === 1, 'debería listar 1 dispositivo MIDI mockeado');
  assert(midiOutputSelect.value === 'fake-out-1', 'debería auto-seleccionar el output mockeado');
  console.log('OK: dispositivo MIDI mockeado detectado y seleccionado:', midiOutputSelect.value);

  // --- Reproducibilidad por seed ---
  seedInput.value = '777';
  doc.getElementById('btnGenerate').click();
  const run1 = snapshotSteps().map((s) => s.note);
  doc.getElementById('btnGenerate').click(); // mismo seed otra vez
  const run2 = snapshotSteps().map((s) => s.note);
  assert(JSON.stringify(run1) === JSON.stringify(run2), 'mismo seed debería dar el mismo patrón');
  console.log('OK: reproducibilidad por seed confirmada ->', run1.join(' '));

  // --- Play/Stop, Note On/Off por MIDI ---
  doc.getElementById('tempo').value = '600'; // tempo alto para que el test sea rápido
  doc.getElementById('btnPlay').click();
  await wait(300);
  const notesOnDuringPlay = sentMessages.filter((m) => (m.data[0] & 0xf0) === 0x90).length;
  assert(notesOnDuringPlay > 0, 'debería haber enviado al menos un Note On durante el playback');
  console.log('OK: se enviaron', notesOnDuringPlay, 'mensajes Note On vía MIDI mockeado durante ~300ms');

  doc.getElementById('btnStop').click();
  await wait(20);
  const noteOnCount = sentMessages.filter((m) => (m.data[0] & 0xf0) === 0x90).length;
  const noteOffCount = sentMessages.filter((m) => (m.data[0] & 0xf0) === 0x80).length;
  assert(noteOffCount >= noteOnCount, 'STOP debería garantizar al menos tantos Note Off como Note On enviados. on=' + noteOnCount + ' off=' + noteOffCount);
  console.log('OK: Note On =', noteOnCount, ' / Note Off =', noteOffCount, '(no quedan notas colgadas tras STOP)');

  // --- Cambiar cantidad de pasos ---
  doc.getElementById('steps').value = '8';
  doc.getElementById('btnGenerate').click();
  assert(noteDots().length === 8, 'debería re-renderizar con 8 pasos tras cambiar el selector, encontró ' + noteDots().length);
  console.log('OK: cambio de longitud de patrón a', noteDots().length, 'pasos funciona');

  // --- Edición manual: click en un note-dot para activar/desactivar ---
  doc.getElementById('steps').value = '16';
  setSelect(doc, 'scale', 'Natural Minor');
  seedInput.value = '42';
  doc.getElementById('btnGenerate').click();

  let restIndex = snapshotSteps().findIndex((s) => !s.active);
  assert(restIndex !== -1, 'debería existir al menos un paso inactivo para probar el toggle');

  const messagesBeforeToggle = sentMessages.length;
  click(noteDots()[restIndex]);
  let snap = snapshotSteps();
  assert(snap[restIndex].active, 'el paso debería quedar activo tras el click');
  assert(sentMessages.length === messagesBeforeToggle, 'editar un paso a mano no debería, por sí solo, enviar mensajes MIDI');
  console.log('OK: click en un note-dot inactivo lo activa (toma la nota que ya tenía la curva de pitch), sin efectos MIDI colaterales');

  click(noteDots()[restIndex]);
  assert(!snapshotSteps()[restIndex].active, 'un segundo click sobre el mismo punto debería volver a desactivarlo');
  console.log('OK: un segundo click vuelve a desactivar el paso');

  // --- Edición manual: "pintar" sobre la curva de pitch cambia el tono ---
  let activeIndex = snapshotSteps().findIndex((s) => s.active);
  assert(activeIndex !== -1, 'debería existir un paso activo para probar el drag de tono');

  // rect mockeado = 800px de ancho / 16 pasos = 50px por paso
  const stepPxWidth = 800 / 16;
  const clientXForStep = (i) => Math.floor(i * stepPxWidth + stepPxWidth / 2);
  const pitchCurveEl = () => doc.querySelector('#noteDisplay .pitch-curve');

  const rootPitchClass = Number(doc.getElementById('rootNote').value);
  const allowedPitchClasses = new Set(
    window.BG.Scales.SCALES['Natural Minor'].map((iv) => ((rootPitchClass + iv) % 12 + 12) % 12)
  );
  function inScale(midi) { return allowedPitchClasses.has(((midi % 12) + 12) % 12); }

  drag(pitchCurveEl(), { fromX: clientXForStep(activeIndex), fromY: 5, toY: 5 }); // muy arriba: nota aguda
  const afterHigh = snapshotSteps()[activeIndex];
  drag(pitchCurveEl(), { fromX: clientXForStep(activeIndex), fromY: 65, toY: 65 }); // muy abajo: nota grave
  const afterLow = snapshotSteps()[activeIndex];

  assert(afterHigh.midi !== afterLow.midi, 'arrastrar a distinta altura en la curva debería cambiar el tono');
  assert(afterHigh.midi > afterLow.midi, 'arrastrar arriba en la curva debería dar una nota más aguda que arrastrar abajo');
  assert(inScale(afterHigh.midi) && inScale(afterLow.midi), 'las notas resultantes del drag deberían caer dentro de la escala elegida (Natural Minor)');
  assert(sentMessages.length === messagesBeforeToggle, 'arrastrar el tono a mano tampoco debería enviar mensajes MIDI por sí solo');
  console.log('OK: "pintar" sobre la curva de pitch cambia el tono (arriba=' + window.BG.Scales.midiToNoteName(afterHigh.midi) + ', abajo=' + window.BG.Scales.midiToNoteName(afterLow.midi) + '), siempre dentro de la escala');

  // --- Edición manual: arrastrar el gate-bar cambia la duración ---
  activeIndex = snapshotSteps().findIndex((s) => s.active);
  const gateBarFor = (i) => doc.querySelectorAll('#noteDisplay .gate-bar')[i];
  const gateBefore = snapshotSteps()[activeIndex].gate;
  drag(gateBarFor(activeIndex), { fromY: 200, toY: 140 }); // arriba = más gate
  const gateAfter = snapshotSteps()[activeIndex].gate;
  assert(gateAfter !== gateBefore, 'arrastrar el gate-bar debería cambiar la duración (antes: ' + gateBefore + ', después: ' + gateAfter + ')');
  console.log('OK: arrastrar el gate-bar cambia la duración de la nota (' + gateBefore.toFixed(2) + ' -> ' + gateAfter.toFixed(2) + ')');

  // --- Edición manual: arrastrar el note-dot (sin moverse en X) cambia la velocity ---
  const velBefore = snapshotSteps()[activeIndex].velocity;
  drag(noteDots()[activeIndex], { fromY: 200, toY: 260 }); // abajo = menos velocity
  const velAfter = snapshotSteps()[activeIndex].velocity;
  assert(velAfter !== velBefore, 'arrastrar el note-dot debería cambiar la velocity (antes: ' + velBefore + ', después: ' + velAfter + ')');
  console.log('OK: arrastrar el note-dot cambia la velocity (' + velBefore + ' -> ' + velAfter + ')');

  // --- Locks: regenerar no debería pisar lo que está "trabado" ---
  seedInput.value = '1001';
  doc.getElementById('btnGenerate').click();
  const beforeLock = snapshotSteps();

  doc.getElementById('btnLockRhythm').click(); // activar lock rhythm
  seedInput.value = '2002';
  doc.getElementById('btnGenerate').click();
  const afterLockRhythm = snapshotSteps();

  const rhythmPreserved = beforeLock.every((s, idx) => s.active === afterLockRhythm[idx].active);
  assert(rhythmPreserved, 'con lock rhythm activado, qué pasos están activos debería mantenerse igual al regenerar con otro seed');
  const pitchChangedSomewhere = beforeLock.some((s, idx) => s.active && s.midi !== afterLockRhythm[idx].midi);
  assert(pitchChangedSomewhere, 'sin lock pitch, el tono debería poder cambiar al regenerar con otro seed');
  console.log('OK: lock rhythm preserva qué pasos suenan; sin lock pitch, el tono sí cambió');

  doc.getElementById('btnLockRhythm').click(); // desactivar lock rhythm
  doc.getElementById('btnLockPitch').click();  // activar lock pitch
  seedInput.value = '3003';
  doc.getElementById('btnGenerate').click();
  const afterLockPitch = snapshotSteps();

  // La curva de pitch ahora existe para TODOS los pasos (activos o no), así
  // que se puede comparar directamente, sin filtrar por "active".
  const pitchPreserved = afterLockRhythm.every((s, idx) => s.midi === afterLockPitch[idx].midi);
  assert(pitchPreserved, 'con lock pitch activado, la curva de tono completa debería mantenerse igual al regenerar con otro seed');
  console.log('OK: lock pitch preserva la curva de tono completa al regenerar con otro seed');

  doc.getElementById('btnLockPitch').click(); // dejar los locks apagados

  // --- Shift: rotar el patrón un paso con los botones ---
  seedInput.value = '555';
  doc.getElementById('btnGenerate').click();
  const notesBeforeShift = snapshotSteps();
  const n = notesBeforeShift.length;

  doc.getElementById('btnShiftRight').click();
  const notesAfterShiftRight = snapshotSteps();
  const shiftRightOk = notesBeforeShift.every((s, i) => {
    const moved = notesAfterShiftRight[(i + 1) % n];
    return moved.active === s.active && moved.midi === s.midi;
  });
  assert(shiftRightOk, 'shift +1 debería mover cada paso una posición hacia adelante (con wrap-around)');
  console.log('OK: shift +1 rota el patrón un paso hacia adelante, con wrap-around');

  doc.getElementById('btnShiftLeft').click();
  const notesAfterShiftLeft = snapshotSteps();
  assert(JSON.stringify(notesAfterShiftLeft) === JSON.stringify(notesBeforeShift), 'shift -1 después de shift +1 debería restaurar el patrón original');
  console.log('OK: shift -1 deshace shift +1');

  // --- Swing: el slider muestra su valor, y el scheduler retrasa los pasos impares ---
  const swingInput = doc.getElementById('swing');
  swingInput.value = '60';
  swingInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(doc.getElementById('swingValue').textContent === '60%', 'el slider de swing debería mostrar su valor actual');
  console.log('OK: el slider de swing muestra su valor (60%)');

  async function captureNoteOnTimes(swingPercent) {
    const times = [];
    const stubMidi = { noteOn(note, vel, t) { times.push(t); }, noteOff() {}, panic() {} };
    const seq = window.BG.Sequencer.createSequencer(stubMidi);
    const allActive = window.BG.Generator.generate({
      steps: 16, rate: '1/16', root: 0, scale: 'Natural Minor',
      octave: 2, octaveMin: 0, octaveMax: 0,
      density: 1, complexity: 1, rests: 0, accentAmount: 0,
      velocityBase: 100, velocityAccentBoost: 0, seed: 1,
    });
    seq.setPattern(allActive);
    seq.setTempo(120); // 1/16 a 120 bpm => cada paso dura 125 ms
    seq.setSwing(swingPercent);
    seq.start();
    await wait(700);
    seq.stop();
    return times;
  }

  const stepMs = 125;
  const straight = await captureNoteOnTimes(0);
  assert(straight.length >= 5, 'debería haberse agendado al menos 5 notas, hubo ' + straight.length);
  for (let i = 1; i < 5; i++) {
    const gap = straight[i] - straight[i - 1];
    assert(Math.abs(gap - stepMs) < 0.01, 'con swing 0 todos los pasos deberían distar 125ms, distó ' + gap);
  }
  console.log('OK: con swing 0% los pasos caen exactamente en la grilla recta (125 ms)');

  const swung = await captureNoteOnTimes(100);
  const evenToOdd = swung[1] - swung[0];
  const oddToEven = swung[2] - swung[1];
  assert(Math.abs(evenToOdd - stepMs * 1.5) < 0.01, 'con swing 100% el offbeat debería caer 62.5ms más tarde (intervalo 187.5ms), fue ' + evenToOdd);
  assert(Math.abs(oddToEven - stepMs * 0.5) < 0.01, 'y el paso siguiente debería llegar 62.5ms después (intervalo 62.5ms), fue ' + oddToEven);
  assert(Math.abs((swung[2] - swung[0]) - stepMs * 2) < 0.01, 'cada par de pasos debería seguir durando lo mismo (250ms): el swing no acumula deriva');
  console.log('OK: con swing 100% el offbeat se retrasa (' + evenToOdd.toFixed(1) + ' ms / ' + oddToEven.toFixed(1) + ' ms) y el par completo sigue durando 250 ms');

  // --- Regeneración en vivo ---
  const activeCount = () => snapshotSteps().filter((s) => s.active).length;

  seedInput.value = '4242';
  setSlider(doc, 'complexity', 100);
  setSlider(doc, 'rests', 0);
  setSlider(doc, 'density', 0);
  await wait(60);
  assert(activeCount() === 0, 'con density 0 no debería sonar ningún paso, sonaron ' + activeCount());
  setSlider(doc, 'density', 100);
  await wait(60);
  assert(activeCount() === 16, 'con density 100 (complexity 100, rests 0) deberían sonar los 16 pasos, sonaron ' + activeCount());
  console.log('OK: mover el slider de density actualiza el patrón en vivo, sin apretar Generate (0 -> 0 pasos, 100 -> 16 pasos)');

  setSlider(doc, 'density', 40);
  await wait(60);
  const at40 = snapshotSteps();
  setSlider(doc, 'density', 70);
  await wait(60);
  const at70 = snapshotSteps();
  assert(at40.filter((s) => s.active).length >= 1, 'el test necesita al menos un paso activo con density 40');
  assert(at70.filter((s) => s.active).length > at40.filter((s) => s.active).length, 'subir density debería sumar pasos activos');
  assert(at40.every((s, i) => !s.active || at70[i].active), 'al subir density, los pasos que ya sonaban deberían seguir sonando (evolución continua, sin saltos)');
  assert(at40.every((s, i) => !(s.active && at70[i].active) || s.midi === at70[i].midi), 'al mover density la curva de tono no debería cambiar');
  console.log('OK: subir density solo agrega pasos: los que ya sonaban siguen ahí y con el mismo tono (' + at40.filter((s) => s.active).length + ' -> ' + at70.filter((s) => s.active).length + ')');

  const countCC = () => sentMessages.filter((m) => (m.data[0] & 0xf0) === 0xb0).length;
  doc.getElementById('btnPlay').click();
  await wait(150);
  const ccBeforeLive = countCC();
  setSlider(doc, 'density', 55);
  await wait(40);
  setSlider(doc, 'density', 65);
  await wait(40);
  assert(countCC() === ccBeforeLive, 'mover un slider con el patrón sonando no debería disparar panic (All Notes Off)');
  const playhead = doc.getElementById('playhead');
  assert(playhead && playhead.style.display === 'block', 'el playhead debería seguir visible tras regenerar en vivo mientras suena');
  console.log('OK: con el patrón sonando, mover un slider no dispara panic y el playhead se mantiene visible');
  doc.getElementById('btnStop').click();
  await wait(20);

  // --- replacePattern (misma cantidad de pasos) no resetea ni hace panic; con otra cantidad sí ---
  const panicCalls = [];
  const stub2 = { noteOn() {}, noteOff() {}, panic() { panicCalls.push(1); } };
  const seq2 = window.BG.Sequencer.createSequencer(stub2);
  const genSteps = (steps, seed) => window.BG.Generator.generate({
    steps, rate: '1/16', root: 0, scale: 'Natural Minor', octave: 2, octaveMin: 0, octaveMax: 0,
    density: 1, complexity: 1, rests: 0, accentAmount: 0, velocityBase: 100, velocityAccentBoost: 0, seed,
  });
  seq2.setPattern(genSteps(16, 1));
  seq2.start();
  const panicsAtStart = panicCalls.length;
  seq2.replacePattern(genSteps(16, 2));
  assert(panicCalls.length === panicsAtStart, 'replacePattern con la misma cantidad de pasos no debería hacer panic');
  seq2.replacePattern(genSteps(8, 3));
  assert(panicCalls.length === panicsAtStart + 1, 'replacePattern con otra cantidad de pasos sí debería reiniciar (panic)');
  seq2.stop();
  console.log('OK: replacePattern reemplaza en caliente sin panic (y reinicia solo si cambia la cantidad de pasos)');

  // --- clock.js: el sequencer real, en este entorno (jsdom no tiene Worker) ---
  const seq3 = window.BG.Sequencer.createSequencer({ noteOn() {}, noteOff() {}, panic() {} });
  seq3.setPattern(genSteps(16, 9));
  seq3.start();
  assert(seq3.clockMode === 'main', 'sin soporte de Worker en el entorno, el sequencer debería caer al hilo principal, dio: ' + seq3.clockMode);
  seq3.stop();
  console.log('OK: sin Worker disponible, el sequencer cae automáticamente al timer de hilo principal (clockMode=' + seq3.clockMode + ')');

  // --- clock.js: Worker simulado ---
  function makeFakeWorker() {
    return { posted: [], postMessage(msg) { this.posted.push(msg); }, terminate() {}, onmessage: null, onerror: null };
  }

  const fakeWorker = makeFakeWorker();
  const ticks = [];
  const clockA = window.BG.Clock.createClock({ intervalMs: 10, onTick: () => ticks.push(1), workerFactory: () => fakeWorker });
  assert(clockA.mode === 'worker', 'con un workerFactory que devuelve un worker, el modo debería ser "worker"');

  clockA.start();
  assert(fakeWorker.posted[0].cmd === 'start' && fakeWorker.posted[0].intervalMs === 10, 'start() debería mandarle al worker {cmd:"start", intervalMs}');
  fakeWorker.onmessage({});
  fakeWorker.onmessage({});
  assert(ticks.length === 2, 'cada mensaje del worker debería disparar onTick, hubo ' + ticks.length);

  clockA.stop();
  assert(fakeWorker.posted[1].cmd === 'stop', 'stop() debería mandarle al worker {cmd:"stop"}');
  fakeWorker.onmessage({});
  assert(ticks.length === 2, 'un tick que llega después de stop() no debería disparar onTick');
  console.log('OK: Worker simulado — start/stop mandan el protocolo correcto y un tick tardío tras stop() se ignora');

  const fakeWorker2 = makeFakeWorker();
  let ticks2 = 0;
  const clockB = window.BG.Clock.createClock({ intervalMs: 15, onTick: () => { ticks2++; }, workerFactory: () => fakeWorker2 });
  clockB.start();
  assert(clockB.mode === 'worker', 'debería arrancar en modo worker');
  fakeWorker2.onerror(new Error('worker roto (simulado)'));
  assert(clockB.mode === 'main', 'ante un error del worker debería caer a "main" automáticamente');
  await wait(50);
  clockB.stop();
  assert(ticks2 > 0, 'tras el fallback debería seguir tickeando desde el hilo principal, ticks=' + ticks2);
  console.log('OK: si el worker falla en pleno playback, el reloj cae solo al hilo principal y sigue funcionando');

  // --- Pesos de escala ---
  setSlider(doc, 'weightRoot', 100);
  setSlider(doc, 'weightFifth', 0);
  setSlider(doc, 'weightThird', 0);
  setSlider(doc, 'weightOther', 0);
  setSlider(doc, 'density', 90);
  setSlider(doc, 'complexity', 90);
  setSlider(doc, 'rests', 0);
  seedInput.value = '8080';
  setSelect(doc, 'rootNote', 0); // C
  await wait(60);

  const rootWeightedSnapshot = snapshotSteps().filter((s) => s.active);
  assert(rootWeightedSnapshot.length >= 6, 'el test necesita varios pasos activos, hubo ' + rootWeightedSnapshot.length);
  const allRoot = rootWeightedSnapshot.every((s) => s.note.startsWith('C'));
  assert(allRoot, 'con el peso de "root" al máximo y el resto en 0, todas las notas activas deberían ser la tónica (C), salió: ' + rootWeightedSnapshot.map((s) => s.note).join(' '));
  console.log('OK: los sliders de pesos de escala afectan la generación en vivo (root=100/resto=0 -> ' + rootWeightedSnapshot.length + '/' + rootWeightedSnapshot.length + ' notas son la tónica)');

  setSlider(doc, 'weightRoot', 40);
  setSlider(doc, 'weightFifth', 20);
  setSlider(doc, 'weightThird', 15);
  setSlider(doc, 'weightOther', 25);

  // --- Variator: regresión (none/0 no cambia nada) ---
  const baseGenParams = {
    steps: 16, rate: '1/16', root: 0, scale: 'Natural Minor', octave: 2, octaveMin: -1, octaveMax: 1,
    density: 0.75, complexity: 0.5, rests: 0.1, accentAmount: 0.25,
    velocityBase: 100, velocityAccentBoost: 20, seed: 'variator-regression',
  };
  const withoutVariator = window.BG.Generator.generate(baseGenParams);
  const withNoneExplicit = window.BG.Generator.generate(Object.assign({}, baseGenParams, { variationShape: 'none', variationAmount: 0 }));
  assert(JSON.stringify(withoutVariator) === JSON.stringify(withNoneExplicit), 'con variationShape "none" o sin especificarlo, el patrón debería ser idéntico');
  console.log('OK: sin Variator (o con shape "none"), la generación no cambió');

  // --- Variator: "pulse" + amount 100% es matemáticamente exacto ---
  const pulsePattern = window.BG.Generator.generate({
    steps: 16, rate: '1/16', root: 0, scale: 'Chromatic', octave: 2, octaveMin: 0, octaveMax: 0,
    density: 0.6, complexity: 1, rests: 0, accentAmount: 0,
    velocityBase: 100, velocityAccentBoost: 0, seed: 'pulse-test',
    variationShape: 'pulse', variationAmount: 1,
  });
  assert(pulsePattern.active.slice(0, 8).every((a) => a === false), 'con shape "pulse" y amount 100%, la primera mitad debería quedar en silencio total');
  assert(pulsePattern.active.slice(8, 16).every((a) => a === true), 'con shape "pulse" y amount 100%, la segunda mitad debería sonar completa');
  console.log('OK: Variator "pulse" al 100% deja la primera mitad del patrón en silencio y la segunda completamente llena (resultado exacto)');

  // --- Variator desde la UI ---
  setSelect(doc, 'scale', 'Chromatic');
  setSlider(doc, 'density', 60);
  setSlider(doc, 'complexity', 100);
  setSlider(doc, 'rests', 0);
  seedInput.value = 'pulse-ui-test';
  setSelect(doc, 'variationShape', 'pulse');
  setSlider(doc, 'variationAmount', 100);
  await wait(60);

  const uiPulseSnapshot = snapshotSteps();
  assert(uiPulseSnapshot.slice(0, 8).every((s) => !s.active) && uiPulseSnapshot.slice(8, 16).every((s) => s.active),
    'el Variator debería funcionar en vivo desde la UI, sin apretar Generate');
  console.log('OK: el Variator "pulse" funciona en vivo desde los controles de la UI');

  setSelect(doc, 'variationShape', 'none');
  setSlider(doc, 'variationAmount', 0);
  setSelect(doc, 'scale', 'Natural Minor');

  // --- Slots de patrón ---
  function slotButtons() { return Array.from(doc.getElementById('slotButtons').querySelectorAll('.slot-btn')); }

  seedInput.value = '6161';
  doc.getElementById('btnGenerate').click();
  const beforeEmptyLoad = snapshotSteps();
  slotButtons()[3].click(); // slot 4, vacío, "save" no está armado
  assert(JSON.stringify(snapshotSteps()) === JSON.stringify(beforeEmptyLoad), 'tocar un slot vacío no debería cambiar el patrón actual');
  console.log('OK: tocar un slot vacío no hace nada');

  doc.getElementById('btnSaveSlot').click();
  assert(doc.getElementById('btnSaveSlot').getAttribute('aria-pressed') === 'true', '"save" debería quedar armado tras tocarlo');
  slotButtons()[3].click();
  assert(doc.getElementById('btnSaveSlot').getAttribute('aria-pressed') === 'false', '"save" debería desarmarse solo después de guardar');
  assert(slotButtons()[3].classList.contains('slot-btn--filled'), 'el slot 4 debería verse marcado como ocupado tras guardar');
  assert(slotButtons()[3].classList.contains('slot-btn--active'), 'el slot 4 recién guardado debería verse como el activo');
  const savedSnapshot = snapshotSteps();
  console.log('OK: "save" arma, guarda en el slot tocado y se desarma solo');

  const someActive = snapshotSteps().findIndex((s) => s.active);
  click(noteDots()[someActive]); // lo apaga
  assert(JSON.stringify(snapshotSteps()) !== JSON.stringify(savedSnapshot), 'la edición manual debería haber cambiado el patrón actual');
  assert(!slotButtons()[3].classList.contains('slot-btn--active'), 'editar el patrón después de guardar un slot debería dejar de marcarlo como activo');

  slotButtons()[3].click();
  assert(JSON.stringify(snapshotSteps()) === JSON.stringify(savedSnapshot), 'cargar el slot debería restaurar exactamente lo guardado (clon, no referencia)');
  assert(slotButtons()[3].classList.contains('slot-btn--active'), 'tras cargarlo, el slot 4 debería volver a verse como activo');
  console.log('OK: cargar un slot restaura exactamente lo guardado; la edición manual posterior no lo había alterado');

  console.log('\nTODOS LOS TESTS PASARON ✔');
}

function assert(cond, msg) {
  if (!cond) throw new Error('FALLÓ: ' + msg);
}

run().catch((err) => {
  console.error('\nTEST FALLÓ:', err.message);
  console.error(err.stack);
  process.exit(1);
});
