# Bassline Generator — MIDI (V0.1)

Generador procedural de líneas de bajo que se reproduce enviando MIDI real
(Note On/Off) a un sintetizador físico vía Web MIDI API. Sin audio en el
navegador: el sonido sale siempre de tu hardware.

## Cómo usarlo

1. Conectá tu interfaz/sintetizador MIDI a la computadora **antes** de abrir la página (algunos navegadores no detectan hardware conectado después).
2. Abrí `index.html` en **Chrome** o **Edge** (Web MIDI API no funciona en Firefox ni Safari por ahora).
3. Aceptá el permiso de acceso MIDI si el navegador lo pide.
4. Elegí tu dispositivo en **MIDI OUT** y el canal en **CANAL**.
5. Ajustá Tónica/Escala/Pasos/Rate y los knobs del Generator (Density, Complexity, Rests, Accent).
6. Presioná **Generate** para crear un patrón, y **Play** para escucharlo en tu sinte.
7. **Stop** corta la reproducción y apaga cualquier nota que pudiera haber quedado sonando. El botón **panic** hace lo mismo manualmente en cualquier momento.
8. Mismo **Seed** + mismos parámetros = siempre el mismo patrón (podés anotarlo o compartirlo).

## Qué incluye esta versión (V0.1)

- Motor de generación procedural (ritmo por densidad onbeat/offbeat + pitch por pesos de grado de escala), con seed reproducible.
- 9 escalas (Chromatic, Major, Natural Minor, Dorian, Mixolydian, Pentatonic Major/Minor, Blues, Harmonic Minor).
- Step sequencer visual (solo lectura por ahora — la edición manual con mouse llega en V0.2).
- Scheduler MIDI con look-ahead scheduling (clock de referencia de alta resolución + agendado anticipado de Note On/Off), para timing estable.
- Selector de dispositivo/canal MIDI, con apagado de seguridad de todas las notas activas al parar, cambiar de patrón, cambiar de dispositivo/canal o cerrar la pestaña.

## Qué falta (ver roadmap completo en la conversación de diseño)

Edición manual de pasos, Swing, Shift, Variators, locks de Rhythm/Pitch, slots de patrón, presets, exportación .mid/JSON, MIDI Clock.

## Estructura

```
index.html
style.css
js/
  scales.js      → notas y escalas (datos puros)
  rng.js         → PRNG determinista (seed)
  pattern.js     → modelo de datos del patrón
  generator.js   → motor de generación (puro, sin DOM/MIDI)
  midi.js        → acceso a Web MIDI (dispositivos, envío, panic)
  sequencer.js   → scheduler de reproducción (look-ahead)
  ui.js          → renderizado del DOM y eventos
  app.js         → arranque y conexión entre módulos
test/
  integration-test.js → test automatizado (Node + jsdom, simula Web MIDI)
```

## Correr el test automatizado (opcional, requiere Node)

```
npm install jsdom
node test/integration-test.js
```
