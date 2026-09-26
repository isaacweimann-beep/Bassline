/**
 * pattern.js
 * -----------------------------------------------------------------------
 * Define la estructura de datos "Pattern": el resultado del generador y
 * lo que consume el scheduler/UI. Es un objeto plano, fácil de clonar,
 * serializar (JSON) y guardar en LocalStorage más adelante.
 * -----------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /**
   * Crea un Pattern vacío (todos los pasos inactivos) con la config
   * musical/rítmica dada. El Generator es quien rellena note/velocity/
   * gate/accent a partir de esto.
   */
  function createEmptyPattern(config) {
    const steps = config.steps;
    return {
      // --- Configuración musical/rítmica ---
      steps,
      rate: config.rate,          // '1/4' | '1/8' | '1/16' | '1/32'
      root: config.root,          // 0-11 (clase de altura)
      scale: config.scale,        // nombre de escala (ver scales.js)
      octave: config.octave,      // octava base de la tónica
      octaveMin: config.octaveMin, // rango de octavas relativo (ej. -1)
      octaveMax: config.octaveMax, // rango de octavas relativo (ej. +1)

      // --- Seed / reproducibilidad ---
      seed: config.seed,

      // --- Datos por paso (arrays de longitud `steps`) ---
      note: new Array(steps).fill(null),      // número MIDI, o null si no aplica
      velocity: new Array(steps).fill(0),     // 0-127
      gate: new Array(steps).fill(0.5),       // duración relativa al paso (0-1+)
      accent: new Array(steps).fill(false),   // acento (boolean)
      active: new Array(steps).fill(false),   // ¿suena este paso?
    };
  }

  function clonePattern(pattern) {
    return JSON.parse(JSON.stringify(pattern));
  }

  function toJSON(pattern) {
    return JSON.stringify(pattern, null, 2);
  }

  function fromJSON(json) {
    return JSON.parse(json);
  }

  global.BG = global.BG || {};
  global.BG.Pattern = {
    createEmptyPattern,
    clonePattern,
    toJSON,
    fromJSON,
  };
})(typeof window !== 'undefined' ? window : globalThis);
