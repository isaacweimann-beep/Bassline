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
   *   density (0-1, On Beat), complexity (0-1, Off Beat — independiente,
   *   ya no es un multiplicador de density),
   *   restsOnbeat, restsOffbeat, accentOnbeat, accentOffbeat (0-1 cada uno),
   *   variationShapeOnbeat, variationShapeOffbeat,
   *   variationAmountOnbeat, variationAmountOffbeat (-1..1 cada uno),
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

  /**
   * Valor de modulación del Variator para un paso, en [-1, 1], según su
   * posición dentro del ciclo del patrón (phase = i/steps, en [0,1)).
   *   none      -> siempre 0 (sin variación)
   *   ramp-up   -> sube parejo de -1 (inicio) a +1 (final): el patrón se va llenando
   *   ramp-down -> baja parejo de +1 a -1: el patrón se va vaciando
   *   wave      -> un ciclo de seno completo: sube, baja, y vuelve a subir
   *   pulse     -> -1 en la primera mitad, +1 en la segunda (un "salto" a mitad de patrón)
   */
  function variatorShapeValue(shapeName, phase) {
    switch (shapeName) {
      case 'ramp-up': return -1 + 2 * phase;
      case 'ramp-down': return 1 - 2 * phase;
      case 'wave': return Math.sin(phase * Math.PI * 2);
      case 'pulse': return phase < 0.5 ? -1 : 1;
      case 'none':
      default: return 0;
    }
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
   * ON BEAT (pasos fuertes, cada 1/8) y OFF BEAT (los pasos sincopados
   * intermedios) son dos grupos totalmente independientes: cada uno tiene
   * su propia probabilidad base, su propio Rest, Accent, y su propio
   * Variator (shape + amount). Nada de un grupo influye en el otro.
   *
   *   - density (On Beat) / complexity (Off Beat): probabilidad base de
   *     cada grupo, 0-1 cada una. OJO: complexity ya NO es un multiplicador
   *     de density (antes: offbeat = density*complexity) — ahora Off Beat
   *     puede sonar más denso que On Beat si así se lo configura.
   *   - restsOnbeat / restsOffbeat: resta probabilidad dentro de cada grupo.
   *   - accentOnbeat / accentOffbeat: probabilidad de acento, por grupo.
   *   - variationShapeOnbeat/Offbeat + variationAmountOnbeat/Offbeat: cada
   *     grupo tiene su propio Variator, modulando solo sus propios pasos.
   */
  function generateRhythm(pattern, params, rng) {
    const densityOnbeat = clamp01(params.density);
    const densityOffbeat = clamp01(params.complexity);
    const restsOnbeat = clamp01(params.restsOnbeat);
    const restsOffbeat = clamp01(params.restsOffbeat);
    const accentOnbeat = clamp01(params.accentOnbeat);
    const accentOffbeat = clamp01(params.accentOffbeat);
    const shapeOnbeat = params.variationShapeOnbeat || 'none';
    const shapeOffbeat = params.variationShapeOffbeat || 'none';
    const amountOnbeat = params.variationAmountOnbeat != null ? params.variationAmountOnbeat : 0;
    const amountOffbeat = params.variationAmountOffbeat != null ? params.variationAmountOffbeat : 0;
    const velocityBase = params.velocityBase != null ? params.velocityBase : 96;
    const velocityAccentBoost = params.velocityAccentBoost != null ? params.velocityAccentBoost : 24;

    for (let i = 0; i < pattern.steps; i++) {
      const isOnbeat = i % 2 === 0;

      const baseProb = isOnbeat ? densityOnbeat : densityOffbeat;
      const rests = isOnbeat ? restsOnbeat : restsOffbeat;
      const accentAmount = isOnbeat ? accentOnbeat : accentOffbeat;
      const shape = isOnbeat ? shapeOnbeat : shapeOffbeat;
      const amount = isOnbeat ? amountOnbeat : amountOffbeat;

      const phase = i / pattern.steps;
      const shapeValue = variatorShapeValue(shape, phase);
      const variedProb = baseProb * (1 + amount * shapeValue);

      const finalProb = clamp01(variedProb * (1 - rests));

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
