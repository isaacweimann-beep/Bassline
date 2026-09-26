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

async function run() {
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
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

  console.log('\nTODOS LOS TESTS PASARON ✔');
}

function assert(cond, msg) {
  if (!cond) throw new Error('FALLÓ: ' + msg);
}

run().catch((err) => {
  console.error('\nTEST FALLÓ:', err.message);
  process.exit(1);
});
