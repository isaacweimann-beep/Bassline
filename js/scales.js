/**
 * scales.js
 * -----------------------------------------------------------------------
 * Datos musicales centralizados: nombres de nota y definiciones de escala.
 * Este módulo es puro (sin DOM, sin estado global mutable) para que sea
 * fácil de testear y de extender con nuevas escalas en el futuro.
 *
 * Convención MIDI: nota 60 = C4. midi = (octava + 1) * 12 + claseDeAltura
 * -----------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Cada escala se define como una lista de intervalos en semitonos desde
  // la tónica (grado 0), ascendente, dentro de una octava.
  const SCALES = {
    'Chromatic':        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'Major':            [0, 2, 4, 5, 7, 9, 11],
    'Natural Minor':    [0, 2, 3, 5, 7, 8, 10],
    'Dorian':           [0, 2, 3, 5, 7, 9, 10],
    'Mixolydian':       [0, 2, 4, 5, 7, 9, 10],
    'Pentatonic Major': [0, 2, 4, 7, 9],
    'Pentatonic Minor': [0, 3, 5, 7, 10],
    'Blues':            [0, 3, 5, 6, 7, 10],
    'Harmonic Minor':   [0, 2, 3, 5, 7, 8, 11],
  };

  const SCALE_NAMES = Object.keys(SCALES);

  /**
   * Devuelve el número MIDI de la tónica (grado 0) en una octava dada.
   * @param {number} pitchClass 0-11 (0 = C)
   * @param {number} octave número de octava en notación MIDI (C4 = octava 4)
   */
  function rootMidi(pitchClass, octave) {
    return (octave + 1) * 12 + pitchClass;
  }

  /**
   * Convierte un "grado de escala" (puede ser mayor que la cantidad de
   * notas de la escala, o negativo) a un número MIDI absoluto.
   * degreeIndex 0 = tónica, 1 = segundo grado, etc. Los valores fuera de
   * rango envuelven a la octava siguiente/anterior automáticamente.
   */
  function degreeToMidi(pitchClass, octave, scaleName, degreeIndex) {
    const intervals = SCALES[scaleName] || SCALES['Chromatic'];
    const len = intervals.length;
    const octaveOffset = Math.floor(degreeIndex / len);
    const localIndex = ((degreeIndex % len) + len) % len;
    return rootMidi(pitchClass, octave) + octaveOffset * 12 + intervals[localIndex];
  }

  /**
   * Encuentra el índice de grado (dentro de una sola octava) cuyo
   * intervalo está más cerca de `targetSemitones`. Útil para ubicar
   * "la nota parecida a la quinta" o "a la tercera" en cualquier escala,
   * incluso si esa escala no tiene una quinta o tercera exacta.
   */
  function closestDegreeIndex(scaleName, targetSemitones) {
    const intervals = SCALES[scaleName] || SCALES['Chromatic'];
    let bestIndex = 0;
    let bestDiff = Infinity;
    intervals.forEach((interval, index) => {
      const diff = Math.abs(interval - targetSemitones);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function midiToNoteName(midi) {
    const pitchClass = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    return NOTE_NAMES[pitchClass] + octave;
  }

  global.BG = global.BG || {};
  global.BG.Scales = {
    NOTE_NAMES,
    SCALES,
    SCALE_NAMES,
    rootMidi,
    degreeToMidi,
    closestDegreeIndex,
    midiToNoteName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
