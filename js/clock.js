/**
 * clock.js
 * -----------------------------------------------------------------------
 * Reloj periódico para el scheduler. Cada `intervalMs` llama a `onTick`.
 *
 * Por qué un Worker: los timers del hilo principal (setInterval) son
 * throttleados por el navegador cuando la pestaña no está visible (hasta
 * ~1 tick por segundo), lo que rompería el look-ahead scheduling. El timer
 * de un Web Worker no sufre ese throttling, así que el "latido" del
 * scheduler sigue vivo aunque la pestaña esté en segundo plano.
 *
 * El Worker solo cuenta el tiempo: manda un mensaje 'tick' cada intervalo.
 * Toda la lógica musical sigue en el hilo principal, y la precisión real
 * sigue viniendo de agendar eventos con timestamps (performance.now()).
 *
 * El Worker se crea desde un Blob (código embebido abajo) para no depender
 * de rutas de archivos ni de mayúsculas/minúsculas al desplegar.
 *
 * Si no se puede crear el Worker (navegador sin soporte, política de
 * seguridad, etc.) o falla en ejecución, se cae automáticamente a un
 * setInterval en el hilo principal: funciona igual, pero sin la
 * protección contra el throttling.
 * -----------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  // Código que corre DENTRO del Worker. Protocolo:
  //   {cmd: 'start', intervalMs} -> empieza a emitir 'tick'
  //   {cmd: 'stop'}              -> deja de emitir
  const WORKER_SOURCE = [
    'var timerId = null;',
    'self.onmessage = function (e) {',
    '  var msg = e.data || {};',
    "  if (msg.cmd === 'start') {",
    '    if (timerId !== null) clearInterval(timerId);',
    "    timerId = setInterval(function () { self.postMessage('tick'); }, msg.intervalMs);",
    "  } else if (msg.cmd === 'stop') {",
    '    if (timerId !== null) clearInterval(timerId);',
    '    timerId = null;',
    '  }',
    '};',
  ].join('\n');

  /** Crea el Worker real desde un Blob. Devuelve null si no es posible. */
  function defaultWorkerFactory() {
    if (
      typeof Worker === 'undefined' ||
      typeof Blob === 'undefined' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      return null;
    }
    const blob = new Blob([WORKER_SOURCE], { type: 'text/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }

  /**
   * @param {Object} options
   *   intervalMs: cada cuánto dispara onTick
   *   onTick: función a llamar en cada tick
   *   workerFactory: (opcional) función que devuelve un Worker (o null para
   *                  forzar el fallback). Existe para poder testear.
   */
  function createClock(options) {
    const intervalMs = options.intervalMs;
    const onTick = options.onTick;
    const factory = options.workerFactory !== undefined ? options.workerFactory : defaultWorkerFactory;

    let worker = null;
    let mode = 'main'; // 'worker' | 'main'
    let running = false;
    let timerId = null;

    function startMainThreadTimer() {
      if (timerId === null) timerId = setInterval(onTick, intervalMs);
    }

    function stopMainThreadTimer() {
      if (timerId !== null) clearInterval(timerId);
      timerId = null;
    }

    // Si el Worker falla en ejecución, seguimos con el timer normal.
    function fallbackToMainThread() {
      if (worker) {
        try { worker.terminate(); } catch (e) { /* ya estaba caído */ }
        worker = null;
      }
      mode = 'main';
      if (running) startMainThreadTimer();
    }

    try {
      worker = factory ? factory() : null;
    } catch (e) {
      worker = null;
    }

    if (worker) {
      mode = 'worker';
      // Un tick que ya venía "en vuelo" cuando se hizo stop() se descarta.
      worker.onmessage = () => { if (running) onTick(); };
      worker.onerror = fallbackToMainThread;
    }

    function start() {
      if (running) return;
      running = true;
      if (worker) worker.postMessage({ cmd: 'start', intervalMs });
      else startMainThreadTimer();
    }

    function stop() {
      if (!running) return;
      running = false;
      if (worker) worker.postMessage({ cmd: 'stop' });
      stopMainThreadTimer();
    }

    return {
      start,
      stop,
      get mode() { return mode; },
      get isRunning() { return running; },
    };
  }

  global.BG = global.BG || {};
  global.BG.Clock = { createClock, WORKER_SOURCE };
})(typeof window !== 'undefined' ? window : globalThis);
