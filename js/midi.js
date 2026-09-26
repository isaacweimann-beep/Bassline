/**
 * midi.js
 * -----------------------------------------------------------------------
 * Capa de acceso a Web MIDI API. No sabe nada de patrones ni de tiempo
 * musical: solo sabe pedir acceso, listar dispositivos y mandar bytes
 * MIDI a una salida, opcionalmente con un timestamp futuro (lo que
 * permite al scheduler pre-agendar Note On/Off con precisión).
 * -----------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const STATUS = {
    NOTE_OFF: 0x80,
    NOTE_ON: 0x90,
    CC: 0xB0,
  };

  const CC = {
    ALL_SOUND_OFF: 120,
    ALL_NOTES_OFF: 123,
  };

  function createMidiController() {
    let midiAccess = null;
    let currentOutput = null;
    let currentChannel = 0; // 0-15 internamente (se muestra 1-16 en la UI)

    // Registro de notas actualmente sonando, para poder apagarlas todas
    // ante un STOP, cambio de patrón o cambio de dispositivo.
    const activeNotes = new Set(); // claves: "channel:note"

    async function requestAccess() {
      if (!navigator.requestMIDIAccess) {
        throw new Error('Este navegador no soporta Web MIDI API (probá Chrome o Edge).');
      }
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      return midiAccess;
    }

    function listOutputs() {
      if (!midiAccess) return [];
      return Array.from(midiAccess.outputs.values());
    }

    function selectOutputById(id) {
      panic(); // seguridad: apagar todo antes de cambiar de dispositivo
      const outputs = listOutputs();
      currentOutput = outputs.find((o) => o.id === id) || null;
      return currentOutput;
    }

    function selectChannel(channel1to16) {
      panic(); // seguridad: apagar todo antes de cambiar de canal
      currentChannel = Math.max(0, Math.min(15, channel1to16 - 1));
    }

    function getCurrentOutput() {
      return currentOutput;
    }

    /**
     * Envía Note On. `time` es un DOMHighResTimeStamp (mismo dominio que
     * performance.now()); si se omite, se envía inmediatamente.
     */
    function noteOn(note, velocity, time) {
      if (!currentOutput) return;
      const key = currentChannel + ':' + note;
      activeNotes.add(key);
      currentOutput.send([STATUS.NOTE_ON | currentChannel, note & 0x7f, velocity & 0x7f], time);
    }

    /** Envía Note Off. Mismo criterio de `time` que noteOn. */
    function noteOff(note, time) {
      if (!currentOutput) return;
      const key = currentChannel + ':' + note;
      activeNotes.delete(key);
      currentOutput.send([STATUS.NOTE_OFF | currentChannel, note & 0x7f, 0], time);
    }

    /**
     * Apaga inmediatamente todas las notas que sepamos que están sonando,
     * más un CC 123 (All Notes Off) y CC 120 (All Sound Off) de refuerzo
     * en todos los canales, por si alguna nota quedó "colgada" fuera de
     * nuestro registro (p.ej. tras recargar la página).
     */
    function panic() {
      if (!currentOutput) {
        activeNotes.clear();
        return;
      }
      activeNotes.forEach((key) => {
        const [ch, note] = key.split(':').map(Number);
        currentOutput.send([STATUS.NOTE_OFF | ch, note, 0]);
      });
      activeNotes.clear();

      for (let ch = 0; ch < 16; ch++) {
        currentOutput.send([STATUS.CC | ch, CC.ALL_SOUND_OFF, 0]);
        currentOutput.send([STATUS.CC | ch, CC.ALL_NOTES_OFF, 0]);
      }
    }

    return {
      requestAccess,
      listOutputs,
      selectOutputById,
      selectChannel,
      getCurrentOutput,
      noteOn,
      noteOff,
      panic,
      get channel() { return currentChannel; },
    };
  }

  global.BG = global.BG || {};
  global.BG.Midi = { createMidiController };
})(typeof window !== 'undefined' ? window : globalThis);
