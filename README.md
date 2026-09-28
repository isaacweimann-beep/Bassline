# Bassline Generator — MIDI (V0.2 en progreso)

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
- Step sequencer con edición manual (ver más abajo).
- Locks de Rhythm y Pitch: regenerar con "Generate" puede conservar el ritmo o la curva de tono actuales.
- Scheduler MIDI con look-ahead scheduling (clock de referencia de alta resolución + agendado anticipado de Note On/Off), para timing estable.
- Selector de dispositivo/canal MIDI, con apagado de seguridad de todas las notas activas al parar, cambiar de patrón, cambiar de dispositivo/canal o cerrar la pestaña.

## Edición manual de pasos

- **Click** sobre el nombre de la nota: prende/apaga el paso.
- **Arrastrar verticalmente** sobre el nombre de la nota: cambia el tono (siempre dentro de la escala elegida).
- **Arrastrar** la barra de **velocity** (celeste/ámbar): cambia la velocity.
- **Arrastrar** la barra de **gate** (violeta): cambia la duración de la nota (0.1x a 1.5x la duración del paso).
- Se puede editar con el patrón sonando: el cambio se escucha en la siguiente pasada.
- **lock rhythm / lock pitch** (botones violetas): con uno activo, "Generate" conserva esa capa del patrón actual y solo regenera la otra. Si cambiás la cantidad de pasos, los locks se ignoran (los largos no coinciden).

## Swing y Shift

- **swing** (barra de transporte, 0-100%): retrasa los pasos impares (offbeat) una fracción del paso. 0% = recto, ~67% = tresillo clásico, 100% = máximo (semicorchea con puntillo). Se puede mover con el patrón sonando.
- **shift -1 / +1** (sobre la grilla): rota el patrón completo un paso hacia atrás/adelante, con wrap-around. También funciona con el patrón sonando.

## Qué falta (ver roadmap completo en la conversación de diseño)

Scheduler en Web Worker, Variators, slots de patrón, presets, exportación .mid/JSON, MIDI Clock.

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
