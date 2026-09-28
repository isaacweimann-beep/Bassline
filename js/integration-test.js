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
  'js/midi.js', 'js/sequencer.js', 'js/ui.js', 'js/app.js',
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

  console.log('\nTODOS LOS TESTS PASARON ✔');
}

function assert(cond, msg) {
  if (!cond) throw new Error('FALLÓ: ' + msg);
}

run().catch((err) => {
  console.error('\nTEST FALLÓ:', err.message);
  process.exit(1);
});
