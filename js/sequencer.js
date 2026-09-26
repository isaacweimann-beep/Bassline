/**
 * sequencer.js
 * -----------------------------------------------------------------------
 * Scheduler de reproducción. NO conoce el motor de generación: solo
 * recorre el Pattern actual y decide CUÁNDO disparar cada evento MIDI.
 *
 * Técnica: "look-ahead scheduling" (la misma que se usa para Web Audio).
 * Un timer de baja resolución (setInterval cada 25ms) se despierta
 * periódicamente y agenda, con antelación (~100ms), todos los eventos
 * que caen dentro de esa ventana, usando como referencia de tiempo
 * `performance.now()` (alta resolución) en vez de confiar en que el
 * propio setInterval sea preciso.
 *
 * Tanto Note On como Note Off se agendan por adelantado pasándole un
 * timestamp futuro a MIDIOutput.send() -> es el propio navegador/driver
 * quien dispara el mensaje en el instante exacto, no nuestro JS. Esto
 * evita el patrón "setTimeout para el Note Off" y sus imprecisiones.
 *
 * Nota: en V0.1 el timer corre en el hilo principal. Si el navegador
 * throttlea la pestaña en segundo plano, el timing puede degradarse.
 * En V0.2 este timer se moverá a un Web Worker para evitarlo.
 * -----------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const RATE_TO_BEATS = {
    '1/4': 1,
    '1/8': 0.5,
    '1/16': 0.25,
    '1/32': 0.125,
  };

  const LOOKAHEAD_MS = 25;        // cada cuánto se despierta el scheduler
  const SCHEDULE_AHEAD_MS = 100;  // cuánto agenda hacia adelante en cada tick

  function createSequencer(midi) {
    let pattern = null;
    let bpm = 120;
    let isPlaying = false;
    let currentStep = 0;
    let nextStepTime = 0; // ms, mismo dominio que performance.now()
    let timerId = null;
    let onStepScheduled = null; // callback(stepIndex, timeMs) para la UI

    function secondsPerStep() {
      const beats = RATE_TO_BEATS[pattern.rate] || 0.25;
      return (60 / bpm) * beats;
    }

    function setPattern(newPattern) {
      // Seguridad: si cambiamos de patrón en pleno playback, apagamos
      // cualquier nota que estuviera sonando antes de seguir.
      if (isPlaying) midi.panic();
      pattern = newPattern;
      currentStep = 0;
    }

    function setTempo(newBpm) {
      bpm = Math.max(20, Math.min(300, newBpm));
    }

    function scheduleStep(stepIndex, timeMs) {
      if (onStepScheduled) onStepScheduled(stepIndex, timeMs);

      if (!pattern.active[stepIndex]) return;

      const note = pattern.note[stepIndex];
      const velocity = pattern.velocity[stepIndex];
      const gate = pattern.gate[stepIndex];
      const stepDurationMs = secondsPerStep() * 1000;
      const noteDurationMs = Math.max(15, gate * stepDurationMs);

      midi.noteOn(note, velocity, timeMs);
      midi.noteOff(note, timeMs + noteDurationMs);
    }

    function schedulerTick() {
      const horizon = performance.now() + SCHEDULE_AHEAD_MS;
      while (nextStepTime < horizon) {
        scheduleStep(currentStep, nextStepTime);
        nextStepTime += secondsPerStep() * 1000;
        currentStep = (currentStep + 1) % pattern.steps;
      }
    }

    function start() {
      if (isPlaying || !pattern) return;
      isPlaying = true;
      currentStep = 0;
      nextStepTime = performance.now() + 10;
      timerId = setInterval(schedulerTick, LOOKAHEAD_MS);
    }

    function stop() {
      isPlaying = false;
      if (timerId) clearInterval(timerId);
      timerId = null;
      midi.panic(); // seguridad: nunca dejar notas colgadas al parar
    }

    return {
      setPattern,
      setTempo,
      start,
      stop,
      get isPlaying() { return isPlaying; },
      set onStepScheduled(cb) { onStepScheduled = cb; },
    };
  }

  global.BG = global.BG || {};
  global.BG.Sequencer = { createSequencer, RATE_TO_BEATS };
})(typeof window !== 'undefined' ? window : globalThis);
