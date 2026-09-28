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

function click(el) {
  el.dispatchEvent(new window.MouseEvent('mousedown', { clientY: 100, bubbles: true }));
  window.document.dispatchEvent(new window.MouseEvent('mouseup', { clientY: 100, bubbles: true }));
}

function drag(el, { fromY, toY }) {
  el.dispatchEvent(new window.MouseEvent('mousedown', { clientY: fromY, bubbles: true }));
  window.document.dispatchEvent(new window.MouseEvent('mousemove', { clientY: toY, bubbles: true }));
  window.document.dispatchEvent(new window.MouseEvent('mouseup', { clientY: toY, bubbles: true }));
}

async function run() {
  // jsdom ya dispara 'DOMContentLoaded' solo al parsear el HTML (por eso NO
  // lo disparamos de nuevo acá: hacerlo duplicaría todos los listeners que
  // app.js registra en su handler de init).
  await wait(50); // dejar que initMidi() (async) resuelva y puebla los selects

  const doc = window.document;
  const stepGrid = doc.getElementById('stepGrid');
  const steps = stepGrid.querySelectorAll('.step');
  assert(steps.length === 16, 'debería renderizar 16 pasos por defecto, encontró ' + steps.length);
  console.log('OK: patrón inicial se renderiza con', steps.length, 'pasos');

  const midiOutputSelect = doc.getElementById('midiOutput');
  assert(midiOutputSelect.options.length === 1, 'debería listar 1 dispositivo MIDI mockeado');
  assert(midiOutputSelect.value === 'fake-out-1', 'debería auto-seleccionar el output mockeado');
  console.log('OK: dispositivo MIDI mockeado detectado y seleccionado:', midiOutputSelect.value);

  // Simular click en Generate con un seed fijo y comparar reproducibilidad
  const seedInput = doc.getElementById('seed');
  seedInput.value = '777';
  doc.getElementById('btnGenerate').click();
  const noteTextsRun1 = Array.from(stepGrid.querySelectorAll('.step__note')).map((el) => el.textContent);

  doc.getElementById('btnGenerate').click(); // mismo seed otra vez
  const noteTextsRun2 = Array.from(stepGrid.querySelectorAll('.step__note')).map((el) => el.textContent);

  assert(JSON.stringify(noteTextsRun1) === JSON.stringify(noteTextsRun2), 'mismo seed debería dar el mismo patrón');
  console.log('OK: reproducibilidad por seed confirmada ->', noteTextsRun1.join(' '));

  // Simular Play, esperar a que se agenden algunos steps, y Stop
  doc.getElementById('tempo').value = '600'; // tempo alto para que el test sea rápido
  doc.getElementById('btnPlay').click();
  await wait(300); // suficiente para que el scheduler agende varios pasos a 600bpm/1-16
  const notesOnDuringPlay = sentMessages.filter((m) => (m.data[0] & 0xf0) === 0x90).length;
  assert(notesOnDuringPlay > 0, 'debería haber enviado al menos un Note On durante el playback');
  console.log('OK: se enviaron', notesOnDuringPlay, 'mensajes Note On vía MIDI mockeado durante ~300ms');

  doc.getElementById('btnStop').click();
  await wait(20);
  const noteOnCount = sentMessages.filter((m) => (m.data[0] & 0xf0) === 0x90).length;
  const noteOffCount = sentMessages.filter((m) => (m.data[0] & 0xf0) === 0x80).length;
  assert(noteOffCount >= noteOnCount, 'STOP debería garantizar al menos tantos Note Off como Note On enviados (no debe haber notas colgadas). on=' + noteOnCount + ' off=' + noteOffCount);
  console.log('OK: Note On =', noteOnCount, ' / Note Off =', noteOffCount, '(no quedan notas colgadas tras STOP)');

  // Cambiar cantidad de pasos y volver a generar
  doc.getElementById('steps').value = '8';
  doc.getElementById('btnGenerate').click();
  const stepsAfter = stepGrid.querySelectorAll('.step').length;
  assert(stepsAfter === 8, 'debería re-renderizar con 8 pasos tras cambiar el selector');
  console.log('OK: cambio de longitud de patrón a', stepsAfter, 'pasos funciona');

  // --- Edición manual: click en la zona de nota para activar/desactivar ---
  doc.getElementById('steps').value = '16';
  seedInput.value = '42';
  doc.getElementById('btnGenerate').click();

  const stepEls = Array.from(stepGrid.querySelectorAll('.step'));
  const restIndex = stepEls.findIndex((el) => el.classList.contains('step--rest'));
  assert(restIndex !== -1, 'debería existir al menos un paso inactivo para probar el toggle');

  const messagesBeforeToggle = sentMessages.length;
  click(stepEls[restIndex].querySelector('.step__note'));

  const stepsAfterToggle = Array.from(doc.getElementById('stepGrid').querySelectorAll('.step'));
  assert(!stepsAfterToggle[restIndex].classList.contains('step--rest'), 'el paso debería quedar activo tras el click');
  const noteElAfterOn = stepsAfterToggle[restIndex].querySelector('.step__note');
  assert(noteElAfterOn.textContent !== '--', 'un paso recién activado a mano debería mostrar la nota de la curva de pitch, mostró: ' + noteElAfterOn.textContent);
  assert(sentMessages.length === messagesBeforeToggle, 'editar un paso a mano no debería, por sí solo, enviar mensajes MIDI');
  console.log('OK: click en la zona de nota de un paso inactivo lo activa y toma la nota de la curva de pitch (' + noteElAfterOn.textContent + '), sin efectos MIDI colaterales');

  click(stepsAfterToggle[restIndex].querySelector('.step__note'));
  const stepsAfterToggleOff = Array.from(doc.getElementById('stepGrid').querySelectorAll('.step'));
  assert(stepsAfterToggleOff[restIndex].classList.contains('step--rest'), 'un segundo click sobre la misma nota debería volver a desactivarla');
  console.log('OK: un segundo click vuelve a desactivar el paso');

  // --- Edición manual: arrastrar verticalmente la nota para cambiar el tono ---
  const activeIndex = stepsAfterToggleOff.findIndex((el) => !el.classList.contains('step--rest'));
  assert(activeIndex !== -1, 'debería existir al menos un paso activo para probar el drag de tono');
  const noteElToDrag = doc.getElementById('stepGrid').querySelectorAll('.step')[activeIndex].querySelector('.step__note');
  const noteBefore = noteElToDrag.textContent;

  drag(noteElToDrag, { fromY: 200, toY: 170 }); // arrastrar hacia arriba 30px => sube de tono

  const noteElAfterDrag = doc.getElementById('stepGrid').querySelectorAll('.step')[activeIndex].querySelector('.step__note');
  assert(noteElAfterDrag.textContent !== noteBefore, 'arrastrar verticalmente la nota debería cambiar el tono (antes: ' + noteBefore + ', después: ' + noteElAfterDrag.textContent + ')');
  assert(sentMessages.length === messagesBeforeToggle, 'arrastrar el tono a mano tampoco debería enviar mensajes MIDI por sí solo');
  console.log('OK: arrastrar la nota cambia el tono (' + noteBefore + ' -> ' + noteElAfterDrag.textContent + '), respetando la escala');

  // --- Edición manual: arrastrar verticalmente el gate para cambiar la duración ---
  const gateEl = doc.getElementById('stepGrid').querySelectorAll('.step')[activeIndex].querySelector('.step__gate-fill');
  const gateHeightBefore = gateEl.style.height;

  drag(doc.getElementById('stepGrid').querySelectorAll('.step')[activeIndex].querySelector('.step__gate'), { fromY: 200, toY: 140 }); // arrastrar hacia arriba 60px => más gate

  const gateHeightAfter = doc.getElementById('stepGrid').querySelectorAll('.step')[activeIndex].querySelector('.step__gate-fill').style.height;
  assert(gateHeightAfter !== gateHeightBefore, 'arrastrar el gate debería cambiar su duración visualmente (antes: ' + gateHeightBefore + ', después: ' + gateHeightAfter + ')');
  console.log('OK: arrastrar la barra de gate cambia la duración de la nota (' + gateHeightBefore + ' -> ' + gateHeightAfter + ')');

  // --- Edición manual: arrastrar verticalmente la velocity ---
  const velEl = doc.getElementById('stepGrid').querySelectorAll('.step')[activeIndex].querySelector('.step__vel-fill');
  const velHeightBefore = velEl.style.height;

  drag(doc.getElementById('stepGrid').querySelectorAll('.step')[activeIndex].querySelector('.step__vel'), { fromY: 200, toY: 260 }); // hacia abajo => menos velocity

  const velHeightAfter = doc.getElementById('stepGrid').querySelectorAll('.step')[activeIndex].querySelector('.step__vel-fill').style.height;
  assert(velHeightAfter !== velHeightBefore, 'arrastrar la barra de velocity debería cambiarla visualmente (antes: ' + velHeightBefore + ', después: ' + velHeightAfter + ')');
  console.log('OK: arrastrar la barra de velocity cambia su valor (' + velHeightBefore + ' -> ' + velHeightAfter + ')');

  // --- Locks: regenerar no debería pisar lo que está "trabado" ---
  function snapshotSteps() {
    return Array.from(doc.getElementById('stepGrid').querySelectorAll('.step')).map((el) => ({
      active: !el.classList.contains('step--rest'),
      note: el.querySelector('.step__note').textContent,
    }));
  }

  seedInput.value = '1001';
  doc.getElementById('btnGenerate').click();
  const beforeLock = snapshotSteps();

  doc.getElementById('btnLockRhythm').click(); // activar lock rhythm
  seedInput.value = '2002';
  doc.getElementById('btnGenerate').click();
  const afterLockRhythm = snapshotSteps();

  const rhythmPreserved = beforeLock.every((s, idx) => s.active === afterLockRhythm[idx].active);
  assert(rhythmPreserved, 'con lock rhythm activado, qué pasos están activos debería mantenerse igual al regenerar con otro seed');
  const pitchChangedSomewhere = beforeLock.some((s, idx) => s.active && s.note !== afterLockRhythm[idx].note);
  assert(pitchChangedSomewhere, 'sin lock pitch, el tono debería poder cambiar al regenerar con otro seed');
  console.log('OK: lock rhythm preserva qué pasos suenan; sin lock pitch, el tono sí cambió');

  doc.getElementById('btnLockRhythm').click(); // desactivar lock rhythm
  doc.getElementById('btnLockPitch').click();  // activar lock pitch
  seedInput.value = '3003';
  doc.getElementById('btnGenerate').click();
  const afterLockPitch = snapshotSteps();

  // Solo se puede comparar el tono donde el paso está activo en ambos
  // patrones (en los pasos inactivos la UI muestra '--', no la nota).
  const overlap = afterLockRhythm
    .map((s, idx) => ({ before: s, after: afterLockPitch[idx] }))
    .filter((pair) => pair.before.active && pair.after.active);
  assert(overlap.length >= 3, 'el test necesita al menos 3 pasos activos en ambos patrones para comparar tonos, hay ' + overlap.length);
  const pitchPreserved = overlap.every((pair) => pair.before.note === pair.after.note);
  assert(pitchPreserved, 'con lock pitch activado, la curva de tono debería mantenerse igual al regenerar con otro seed');
  console.log('OK: lock pitch preserva la curva de tono al regenerar con otro seed (' + overlap.length + ' pasos comparados)');

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
    return moved.active === s.active && moved.note === s.note;
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

  // Timing exacto: sequencer real + MIDI falso que registra timestamps.
  async function captureNoteOnTimes(swingPercent) {
    const times = [];
    const stubMidi = {
      noteOn(note, vel, t) { times.push(t); },
      noteOff() {},
      panic() {},
    };
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
  const evenToOdd = swung[1] - swung[0];   // paso par -> impar: se estira
  const oddToEven = swung[2] - swung[1];   // paso impar -> par: se acorta
  assert(Math.abs(evenToOdd - stepMs * 1.5) < 0.01, 'con swing 100% el offbeat debería caer 62.5ms más tarde (intervalo 187.5ms), fue ' + evenToOdd);
  assert(Math.abs(oddToEven - stepMs * 0.5) < 0.01, 'y el paso siguiente debería llegar 62.5ms después (intervalo 62.5ms), fue ' + oddToEven);
  assert(Math.abs((swung[2] - swung[0]) - stepMs * 2) < 0.01, 'cada par de pasos debería seguir durando lo mismo (250ms): el swing no acumula deriva');
  console.log('OK: con swing 100% el offbeat se retrasa (' + evenToOdd.toFixed(1) + ' ms / ' + oddToEven.toFixed(1) + ' ms) y el par completo sigue durando 250 ms');

  // --- Regeneración en vivo: mover un control actualiza el patrón sin apretar Generate ---
  function setSlider(id, value) {
    const el = doc.getElementById(id);
    el.value = String(value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  const activeCount = () => snapshotSteps().filter((s) => s.active).length;

  seedInput.value = '4242';
  setSlider('complexity', 100);
  setSlider('rests', 0);
  setSlider('density', 0);
  await wait(60);
  assert(activeCount() === 0, 'con density 0 no debería sonar ningún paso, sonaron ' + activeCount());
  setSlider('density', 100);
  await wait(60);
  assert(activeCount() === 16, 'con density 100 (complexity 100, rests 0) deberían sonar los 16 pasos, sonaron ' + activeCount());
  console.log('OK: mover el slider de density actualiza el patrón en vivo, sin apretar Generate (0 -> 0 pasos, 100 -> 16 pasos)');

  // Continuidad: subir density solo AGREGA pasos, no reordena el resto ni cambia el tono.
  setSlider('density', 40);
  await wait(60);
  const at40 = snapshotSteps();
  setSlider('density', 70);
  await wait(60);
  const at70 = snapshotSteps();
  assert(at40.filter((s) => s.active).length >= 1, 'el test necesita al menos un paso activo con density 40');
  assert(at70.filter((s) => s.active).length > at40.filter((s) => s.active).length, 'subir density debería sumar pasos activos');
  assert(at40.every((s, i) => !s.active || at70[i].active), 'al subir density, los pasos que ya sonaban deberían seguir sonando (evolución continua, sin saltos)');
  assert(at40.every((s, i) => !(s.active && at70[i].active) || s.note === at70[i].note), 'al mover density la curva de tono no debería cambiar');
  console.log('OK: subir density solo agrega pasos: los que ya sonaban siguen ahí y con el mismo tono (' + at40.filter((s) => s.active).length + ' -> ' + at70.filter((s) => s.active).length + ')');

  // Mover un control con el patrón SONANDO no debe cortar notas ni mandar panic.
  const countCC = () => sentMessages.filter((m) => (m.data[0] & 0xf0) === 0xb0).length;
  doc.getElementById('btnPlay').click();
  await wait(150);
  const ccBeforeLive = countCC();
  setSlider('density', 55);
  await wait(40);
  setSlider('density', 65);
  await wait(40);
  assert(countCC() === ccBeforeLive, 'mover un slider con el patrón sonando no debería disparar panic (All Notes Off)');
  assert(doc.querySelectorAll('.step--playing').length === 1, 'el resaltado del paso que suena debería seguir visible tras regenerar en vivo, hay ' + doc.querySelectorAll('.step--playing').length);
  console.log('OK: con el patrón sonando, mover un slider no dispara panic y el resaltado del paso actual se mantiene');
  doc.getElementById('btnStop').click();
  await wait(20);

  // replacePattern (misma cantidad de pasos) no resetea ni hace panic; con otra cantidad sí.
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

  // --- clock.js: Worker simulado (start/stop, protocolo de mensajes, ticks tardíos ignorados) ---
  function makeFakeWorker() {
    return { posted: [], postMessage(msg) { this.posted.push(msg); }, terminate() {}, onmessage: null, onerror: null };
  }

  const fakeWorker = makeFakeWorker();
  const ticks = [];
  const clockA = window.BG.Clock.createClock({
    intervalMs: 10,
    onTick: () => ticks.push(1),
    workerFactory: () => fakeWorker,
  });
  assert(clockA.mode === 'worker', 'con un workerFactory que devuelve un worker, el modo debería ser "worker"');

  clockA.start();
  assert(fakeWorker.posted[0].cmd === 'start' && fakeWorker.posted[0].intervalMs === 10, 'start() debería mandarle al worker {cmd:"start", intervalMs}');
  fakeWorker.onmessage({}); // el worker "tickea" dos veces
  fakeWorker.onmessage({});
  assert(ticks.length === 2, 'cada mensaje del worker debería disparar onTick, hubo ' + ticks.length);

  clockA.stop();
  assert(fakeWorker.posted[1].cmd === 'stop', 'stop() debería mandarle al worker {cmd:"stop"}');
  fakeWorker.onmessage({}); // tick tardío, llega después de haber parado
  assert(ticks.length === 2, 'un tick que llega después de stop() no debería disparar onTick (había quedado "en vuelo")');
  console.log('OK: Worker simulado — start/stop mandan el protocolo correcto y un tick tardío tras stop() se ignora');

  // --- clock.js: si el worker se cae, fallback automático al hilo principal ---
  const fakeWorker2 = makeFakeWorker();
  let ticks2 = 0;
  const clockB = window.BG.Clock.createClock({
    intervalMs: 15,
    onTick: () => { ticks2++; },
    workerFactory: () => fakeWorker2,
  });
  clockB.start();
  assert(clockB.mode === 'worker', 'debería arrancar en modo worker');
  fakeWorker2.onerror(new Error('worker roto (simulado)'));
  assert(clockB.mode === 'main', 'ante un error del worker debería caer a "main" automáticamente');
  await wait(50);
  clockB.stop();
  assert(ticks2 > 0, 'tras el fallback debería seguir tickeando desde el hilo principal, ticks=' + ticks2);
  console.log('OK: si el worker falla en pleno playback, el reloj cae solo al hilo principal y sigue funcionando');

  console.log('\nTODOS LOS TESTS PASARON ✔');
}

function assert(cond, msg) {
  if (!cond) throw new Error('FALLÓ: ' + msg);
}

run().catch((err) => {
  console.error('\nTEST FALLÓ:', err.message);
  process.exit(1);
});
