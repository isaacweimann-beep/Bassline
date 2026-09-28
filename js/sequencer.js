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
 * Nota: el "latido" que dispara cada `schedulerTick` corre en un Web
 * Worker cuando el navegador lo permite (ver clock.js), así el timing no
 * se degrada si la pestaña queda en segundo plano. La precisión real de
 * cada evento, de todas formas, sigue viniendo de los timestamps que se
 * le pasan a MIDIOutput.send(), no del propio timer.
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
    let swing = 0; // 0..1 (0 = recto, 1 = máximo)
    let isPlaying = false;
    let currentStep = 0;
    let nextStepTime = 0; // ms, mismo dominio que performance.now()
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

    /**
     * Reemplaza el patrón "en caliente": NO reinicia la posición ni dispara
     * panic. Se usa para la regeneración en vivo (mover un slider mientras
     * suena). Si la cantidad de pasos cambia, la posición actual ya no tiene
     * sentido y se cae al reinicio normal de setPattern().
     */
    function replacePattern(newPattern) {
      if (!pattern || pattern.steps !== newPattern.steps) {
        setPattern(newPattern);
        return;
      }
      pattern = newPattern;
    }

    function setTempo(newBpm) {
      bpm = Math.max(20, Math.min(300, newBpm));
    }

    /**
     * Swing en porcentaje (0-100). Retrasa los pasos impares (los
     * "offbeat" de la grilla) una fracción del paso:
     *   retraso = swing * 0.5 * duraciónDelPaso
     * Con 0% todo cae en la grilla recta; con 100% el offbeat cae al 75%
     * del par de pasos (semicorchea con puntillo); cerca del 67% se
     * obtiene el swing de tresillo clásico. El retraso se suma al tiempo
     * de cada evento al agendarlo, sin alterar la grilla base (así no se
     * acumula deriva).
     */
    function setSwing(percent) {
      swing = Math.max(0, Math.min(100, percent)) / 100;
    }

    function scheduleStep(stepIndex, gridTimeMs) {
      const stepDurationMs = secondsPerStep() * 1000;
      const swingOffsetMs = stepIndex % 2 === 1 ? swing * 0.5 * stepDurationMs : 0;
      const timeMs = gridTimeMs + swingOffsetMs;

      if (onStepScheduled) onStepScheduled(stepIndex, timeMs);

      if (!pattern.active[stepIndex]) return;

      const note = pattern.note[stepIndex];
      const velocity = pattern.velocity[stepIndex];
      const gate = pattern.gate[stepIndex];
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

    // El "latido" del scheduler: corre en un Worker si el navegador lo
    // permite (así no lo frena el throttling de pestañas en segundo plano),
    // y cae solo a un timer normal si no. Ver clock.js para el detalle.
    const clock = global.BG.Clock.createClock({
      intervalMs: LOOKAHEAD_MS,
      onTick: () => schedulerTick(),
    });

    function start() {
      if (isPlaying || !pattern) return;
      isPlaying = true;
      currentStep = 0;
      nextStepTime = performance.now() + 10;
      clock.start();
    }

    function stop() {
      isPlaying = false;
      clock.stop();
      midi.panic(); // seguridad: nunca dejar notas colgadas al parar
    }

    return {
      setPattern,
      replacePattern,
      setTempo,
      setSwing,
      start,
      stop,
      get isPlaying() { return isPlaying; },
      get clockMode() { return clock.mode; }, // 'worker' | 'main', útil para diagnosticar
      set onStepScheduled(cb) { onStepScheduled = cb; },
    };
  }

  global.BG = global.BG || {};
  global.BG.Sequencer = { createSequencer, RATE_TO_BEATS };
})(typeof window !== 'undefined' ? window : globalThis);
