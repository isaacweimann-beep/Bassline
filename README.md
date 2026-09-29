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

- **Click** sobre el pad de la nota (el recuadro grande con el nombre): prende/apaga el paso. Ámbar = paso fuerte, verde azulado = paso débil, borde punteado = apagado.
- **Arrastrar verticalmente** sobre ese mismo pad: cambia el tono (siempre dentro de la escala elegida).
- **Arrastrar** la barra de **velocity** (celeste/ámbar): cambia la velocity.
- **Arrastrar** la barra de **gate** (violeta): cambia la duración de la nota (0.1x a 1.5x la duración del paso).
- Se puede editar con el patrón sonando: el cambio se escucha en la siguiente pasada.
- **lock rhythm / lock pitch** (botones violetas): con uno activo, "Generate" conserva esa capa del patrón actual y solo regenera la otra. Si cambiás la cantidad de pasos, los locks se ignoran (los largos no coinciden).

## Slots de patrón

8 casilleros en memoria (se pierden al recargar la página; guardarlos en LocalStorage queda para más adelante) para guardar variantes del patrón:

- **save** + tocar un número (1-8): guarda el patrón actual en ese slot (incluye toda edición manual) y se desarma solo.
- Tocar un número sin "save" armado: carga esa variante. Si el slot está vacío, no hace nada.
- Verde azulado = el slot tiene algo guardado. Ámbar = es el que está cargado ahora mismo (si editás o generás algo nuevo después, deja de marcarse como activo, porque ya no coincide con lo guardado).
- Cargar un slot reinicia la reproducción desde el paso 1, igual que Generate.

## Variator

Hace que la densidad varíe sola a lo largo del patrón, con una forma (**shape**) y una cantidad (**amount**, bipolar -100% a +100%):

- **none**: recto, sin variación (default).
- **ramp up**: empieza vacío y se va llenando hacia el final.
- **ramp down**: empieza lleno y se va vaciando.
- **wave**: sube, baja y vuelve a subir (un ciclo completo).
- **pulse**: la primera mitad del patrón suena mucho menos que la segunda (o al revés, con amount negativo).

Con amount en 0 no cambia nada, sea cual sea el shape elegido. Reacciona en vivo. A diferencia de Reason, hay un solo Variator para todo el patrón (no uno separado para onbeat y otro para offbeat) — si en la práctica hace falta esa separación, se puede sumar después sin romper nada de esto.

## Pesos de escala

Cuatro sliders (root / fifth / third / other) controlan qué tan seguido aparece cada tipo de grado en la línea generada. Son pesos relativos, no un porcentaje: no hace falta que sumen 100, el motor normaliza solo. Por defecto están en 40/20/15/25 (bastante tónica y quinta, algo de tercera, el resto repartido entre los demás grados de la escala). Reaccionan en vivo igual que density/complexity.

## Regeneración en vivo

Al mover un slider del Generator (density, complexity, rests, accent), cambiar el seed, o cambiar un selector musical (tónica, escala, octava, rango, pasos, rate), el patrón se regenera al instante, sin apretar Generate. Con el patrón sonando el cambio se aplica en caliente: no se reinicia la posición ni se cortan las notas.

- Subir/bajar un slider hace evolucionar el patrón de forma continua (por ejemplo, subir density solo suma pasos; no reordena el resto).
- Ritmo y pitch usan generadores aleatorios independientes derivados del seed.
- Ojo: regenerar reemplaza las ediciones manuales. Para protegerlas, activá **lock rhythm** y/o **lock pitch** antes de mover los controles.
- "Generate" y "dice" siguen existiendo: reinician la reproducción desde el paso 1.

## Swing y Shift

- **swing** (barra de transporte, 0-100%): retrasa los pasos impares (offbeat) una fracción del paso. 0% = recto, ~67% = tresillo clásico, 100% = máximo (semicorchea con puntillo). Se puede mover con el patrón sonando.
- **shift -1 / +1** (sobre la grilla): rota el patrón completo un paso hacia atrás/adelante, con wrap-around. También funciona con el patrón sonando.

## Qué falta (ver roadmap completo en la conversación de diseño)

Scheduler en Web Worker, Variators, slots de patrón, presets, exportación .mid/JSON, MIDI Clock.

## Reloj del scheduler (Web Worker)

El "latido" que dispara el look-ahead scheduling corre en un Web Worker cuando el navegador lo permite, así el timing no se degrada si dejás la pestaña en segundo plano (los timers del hilo principal se throttlean ahí, un Worker no). Si el navegador no soporta Worker/Blob, o el Worker falla en pleno playback, cae solo a un timer normal — sigue funcionando, pero sin esa protección.

Arriba a la derecha, al lado del estado de MIDI, aparece **"reloj: worker"** o **"reloj: hilo principal"** apenas apretás Play — sirve para confirmar cuál quedó activo en tu navegador.

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
  clock.js       → reloj periódico (Web Worker con fallback a timer normal)
  sequencer.js   → scheduler de reproducción (look-ahead)
  ui.js          → renderizado del DOM y eventos
  app.js         → arranque y conexión entre módulos
test/
  integration-test.js → test automatizado (Node + jsdom, simula Web MIDI y el Worker)
```

## Correr el test automatizado (opcional, requiere Node)

```
npm install jsdom
node test/integration-test.js
```
