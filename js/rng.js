/**
 * rng.js
 * -----------------------------------------------------------------------
 * Generador de números pseudoaleatorios determinista (mulberry32).
 * Mismo seed => misma secuencia de números, siempre. Esto es lo que
 * permite "Seed 12345 -> siempre el mismo patrón".
 * -----------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /**
   * Convierte cualquier valor (número o texto) en un entero de 32 bits
   * para usar como semilla. Permite que el usuario escriba "12345" o
   * "acid-bass-01" y ambos den un resultado reproducible.
   */
  function hashSeed(value) {
    const str = String(value);
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /**
   * Crea un generador mulberry32. Devuelve una función rng() que produce
   * floats en [0, 1), igual que Math.random() pero determinista.
   */
  function createRng(seedValue) {
    let a = hashSeed(seedValue);
    return function rng() {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Entero aleatorio en [min, max] (inclusive), usando un rng() dado. */
  function randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  /**
   * Elige un índice según una lista de pesos (no necesariamente
   * normalizados a 1). Ej: weightedChoice(rng, [0.4, 0.2, 0.15, 0.25])
   */
  function weightedChoice(rng, weights) {
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r = rng() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  global.BG = global.BG || {};
  global.BG.RNG = {
    hashSeed,
    createRng,
    randInt,
    weightedChoice,
  };
})(typeof window !== 'undefined' ? window : globalThis);
