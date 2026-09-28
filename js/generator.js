/**
 * generator.js
 * -----------------------------------------------------------------------
 * Motor de generación procedural. NO conoce el DOM ni MIDI: recibe
 * parámetros + seed, devuelve un objeto Pattern (ver pattern.js).
 * Esto lo hace testeable de forma aislada y reutilizable (por ejemplo,
 * el día de mañana, para exportar a archivo .mid).
 *
 * Filosofía: en vez de elegir patrones de una biblioteca curada (como
 * hace Reason con sus 64 patrones fuente), generamos ritmo y pitch con
 * reglas explícitas y pesos configurables.
 * -----------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const Scales = global.BG.Scales;
  const RNG = global.BG.RNG;
  const PatternModule = global.BG.Pattern;

  // Máximo salto permitido entre dos notas activas consecutivas, en
  // semitonos. Se reintenta un número limitado de veces antes de aceptar
  // el resultado tal cual (para no trabar el algoritmo).
  const MAX_JUMP_SEMITONES = 7;
  const MAX_PITCH_RETRIES = 5;

  /**
   * Genera un Pattern completo a partir de parámetros musicales y de
   * generación, usando el seed para que el resultado sea reproducible.
   *
   * @param {Object} params
   *   steps, rate, root, scale, octave, octaveMin, octaveMax,
   *   density (0-1), complexity (0-1), rests (0-1), accentAmount (0-1),
   *   velocityBase (0-127), velocityAccentBoost (0-127), seed,
   *   lockRhythm, lockPitch (booleans, opcionales),
   *   previousPattern (Pattern anterior, opcional, requerido si se usa lock)
   */
  function generate(params) {
    // Ritmo y pitch usan generadores aleatorios INDEPENDIENTES (derivados del
    // mismo seed). Así, cambiar algo del ritmo no altera la curva de pitch
    // (ni al revés), con o sin locks.
    const rhythmRng = RNG.createRng(params.seed + ':rhythm');
    const pitchRng = RNG.createRng(params.seed + ':pitch');
    const pattern = PatternModule.createEmptyPattern(params);

    const prev = params.previousPattern;
    // Un lock solo tiene sentido si el patrón anterior tiene la misma
    // cantidad de pasos (si no, los arrays no alinean 1 a 1).
    const canReuse = !!prev && prev.steps === pattern.steps;

    if (params.lockRhythm && canReuse) {
      copyRhythm(prev, pattern);
    } else {
      generateRhythm(pattern, params, rhythmRng);
    }

    if (params.lockPitch && canReuse) {
      copyPitch(prev, pattern);
    } else {
      generatePitch(pattern, params, pitchRng);
    }

    return pattern;
  }

  /** Copia active/velocity/gate/accent del patrón anterior (lock rhythm). */
  function copyRhythm(source, target) {
    for (let i = 0; i < target.steps; i++) {
      target.active[i] = source.active[i];
      target.velocity[i] = source.velocity[i];
      target.gate[i] = source.gate[i];
      target.accent[i] = source.accent[i];
    }
  }

  /** Copia la curva de pitch del patrón anterior (lock pitch). */
  function copyPitch(source, target) {
    for (let i = 0; i < target.steps; i++) {
      target.note[i] = source.note[i];
    }
  }

  /**
   * Decide qué pasos suenan (active), su velocity, gate y accent.
   *
   * Concepto tomado del manual de Bassline Generator: los pasos "fuertes"
   * (onbeat, cada 1/8) y los pasos "débiles/sincopados" (offbeat, los
   * 1/16 intermedios) se controlan con densidades independientes:
   *   - density        => probabilidad base en pasos fuertes (onbeat)
   *   - density*complexity => probabilidad en pasos débiles (offbeat)
   * `rests` resta probabilidad de forma pareja a todo el patrón, como
   * un control independiente para "dejar más aire".
   */
  function generateRhythm(pattern, params, rng) {
    const density = clamp01(params.density);
    const complexity = clamp01(params.complexity);
    const rests = clamp01(params.rests);
    const accentAmount = clamp01(params.accentAmount);
    const velocityBase = params.velocityBase != null ? params.velocityBase : 96;
    const velocityAccentBoost = params.velocityAccentBoost != null ? params.velocityAccentBoost : 24;

    for (let i = 0; i < pattern.steps; i++) {
      const isOnbeat = i % 2 === 0;
      const baseProb = isOnbeat ? density : density * complexity;
      const finalProb = clamp01(baseProb * (1 - rests));

      // Se consumen SIEMPRE las mismas 4 tiradas por paso (esté activo o no).
      // Así, mover un slider solo cambia umbrales y no "corre" el resto de las
      // tiradas: el patrón evoluciona de forma continua en vez de saltar.
      const rActive = rng();
      const rAccent = rng();
      const rVelocity = rng();
      const rGate = rng();

      const active = rActive < finalProb;
      pattern.active[i] = active;

      if (active) {
        const accented = rAccent < accentAmount;
        pattern.accent[i] = accented;
        pattern.velocity[i] = clampMidi127(
          velocityBase + (accented ? velocityAccentBoost : 0) + (Math.floor(rVelocity * 13) - 6)
        );
        // Gate más largo en notas acentuadas/onbeat, más corto en offbeat,
        // con algo de variación para que no suene mecánico.
        const baseGate = isOnbeat ? 0.85 : 0.6;
        pattern.gate[i] = clampGate(baseGate + (rGate * 0.2 - 0.1));
      } else {
        pattern.velocity[i] = 0;
        pattern.gate[i] = 0;
        pattern.accent[i] = false;
      }
    }
  }

  /**
   * Calcula una curva de pitch para TODOS los pasos (no solo los activos),
   * respetando la escala elegida. Que la curva exista para el patrón
   * completo -y no solo donde hay nota- es lo que permite que "lock pitch"
   * y "lock rhythm" sean completamente independientes entre sí: cuál nota
   * suena es una decisión de la capa de ritmo (pattern.active), no de esta
   * función.
   *
   * Usa un sistema de pesos por grado (tónica / quinta / tercera / resto)
   * y un límite de salto para evitar líneas demasiado erráticas.
   */
  function generatePitch(pattern, params, rng) {
    const scaleName = params.scale;
    const weights = params.degreeWeights || {
      root: 0.40,
      fifth: 0.20,
      third: 0.15,
      other: 0.25,
    };

    const rootDegree = 0;
    const fifthDegree = Scales.closestDegreeIndex(scaleName, 7);
    const thirdDegree = Scales.closestDegreeIndex(scaleName, 4);
    const scaleLength = Scales.SCALES[scaleName].length;

    // Grados "otros": todos menos tónica/tercera/quinta (sin duplicar).
    const specialDegrees = new Set([rootDegree, fifthDegree, thirdDegree]);
    const otherDegrees = [];
    for (let d = 0; d < scaleLength; d++) {
      if (!specialDegrees.has(d)) otherDegrees.push(d);
    }

    let previousMidi = null;

    for (let i = 0; i < pattern.steps; i++) {
      let midiNote = null;
      for (let attempt = 0; attempt < MAX_PITCH_RETRIES; attempt++) {
        const degree = pickWeightedDegree(rng, weights, rootDegree, fifthDegree, thirdDegree, otherDegrees);
        const octaveOffset = pickOctaveOffset(rng, params.octaveMin, params.octaveMax);
        const candidate = Scales.degreeToMidi(params.root, params.octave + octaveOffset, scaleName, degree);

        if (previousMidi === null || Math.abs(candidate - previousMidi) <= MAX_JUMP_SEMITONES) {
          midiNote = candidate;
          break;
        }
        midiNote = candidate; // si se acaban los intentos, se usa el último igual
      }

      pattern.note[i] = clampMidiRange(midiNote);
      previousMidi = midiNote;
    }
  }

  function pickWeightedDegree(rng, weights, rootDegree, fifthDegree, thirdDegree, otherDegrees) {
    const choice = RNG.weightedChoice(rng, [weights.root, weights.fifth, weights.third, weights.other]);
    if (choice === 0) return rootDegree;
    if (choice === 1) return fifthDegree;
    if (choice === 2) return thirdDegree;
    // "other": elegir uno al azar entre los grados restantes
    if (otherDegrees.length === 0) return rootDegree;
    return otherDegrees[RNG.randInt(rng, 0, otherDegrees.length - 1)];
  }

  /**
   * Elige un desplazamiento de octava dentro de [min, max], favoreciendo
   * quedarse cerca de 0 (la octava base) mediante pesos triangulares.
   */
  function pickOctaveOffset(rng, min, max) {
    const offsets = [];
    const weights = [];
    for (let o = min; o <= max; o++) {
      offsets.push(o);
      weights.push(1 / (1 + Math.abs(o)));
    }
    const index = RNG.weightedChoice(rng, weights);
    return offsets[index];
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function clampMidi127(v) {
    return Math.max(1, Math.min(127, Math.round(v)));
  }

  function clampMidiRange(v) {
    return Math.max(0, Math.min(127, Math.round(v)));
  }

  function clampGate(v) {
    return Math.max(0.1, Math.min(1.5, v));
  }

  global.BG = global.BG || {};
  global.BG.Generator = {
    generate,
    MAX_JUMP_SEMITONES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
