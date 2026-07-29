# Bitácora v2 — notas para trabajar en este repositorio

PWA local-first, un solo usuario. La especificación funcional está en
[`docs/especificacion.md`](docs/especificacion.md) y es la referencia: sus
secciones se citan en los comentarios del código (`§5.2`, `§4`…).

## Comandos

```bash
npm run dev      # desarrollo
npm test         # vitest, sin red y contra IndexedDB real (fake-indexeddb)
npm run build    # tsc -b && vite build — el build comprueba tipos
npm run preview  # sirve dist/, necesario para probar el service worker
```

## Idioma

Todo el código está en español: nombres de fichero, funciones, variables, tipos
y comentarios. Es coherente con el dominio (`jornada`, `ubicacion`, `motivo`) y
con la especificación. No mezclar.

## Invariantes que no se tocan sin motivo

Vienen de decisiones ya cerradas en la especificación:

- **IndexedDB es la fuente de verdad.** Google Sheets es una copia. Ninguna
  lectura de la interfaz puede depender de la red.
- **La interfaz nunca espera a la red.** Se escribe en IndexedDB, se encola en
  `outbox` y se sigue. El vaciado corre en `sync/sincronizador.ts`.
- **Solo el scope `drive.file`.** Nunca `spreadsheets`, nunca Calendar API. La
  hoja la crea la app, porque `drive.file` solo ve ficheros propios.
- **Las jornadas se encolan al cerrarlas, no al abrirlas.**
- **Los instantes se guardan en ISO con desfase** (`2026-07-29T10:03:00+02:00`).
  Nunca `toISOString()` para almacenar: normaliza a UTC y pierde la hora local,
  que es el dato que hace legible un parte de madrugada en un cambio de hora.
  Usar los ayudantes de `domain/tiempo.ts`.
- **Nada falla en silencio.** Un error de sincronización se marca y se ve en
  pantalla.
- **Nada destructivo sin confirmación** (componente `Confirmacion`).
- **`motivo` y `sistema` son listas cerradas.** Añadir un valor es tocar
  `domain/tipos.ts`, no escribir texto libre.

## Estructura

| Carpeta | Qué hay |
| --- | --- |
| `src/domain` | Tipos del modelo y utilidades de fecha. Sin dependencias. |
| `src/db` | Apertura de IndexedDB, repositorios, cola outbox y bus de cambios. |
| `src/sync` | OAuth, cliente de Sheets/Drive, serialización a filas y vaciado. |
| `src/ics` | Generación de ficheros `.ics`. Funciones puras + entrega. |
| `src/informes` | Parte de trabajo semanal en `.docx` (`docx`, carga perezosa). |
| `src/ui` | Router de hash, hooks, componentes compartidos y estilos. |
| `src/pantallas` | Una pantalla por fichero. |

## Reactividad

No hay librería de estado. Cada escritura llama a `publica('jornadas')` (o la
colección que toque) y las pantallas usan `useConsulta(fn, ['jornadas'])`, que
vuelve a leer de IndexedDB. Si añades una escritura nueva, publica el cambio o
la pantalla se quedará desactualizada.

## Pruebas

Vitest sobre la lógica que puede romperse en silencio: fechas con zona horaria,
transiciones de estado de jornada, herencia de notas, reintentos de la cola,
serialización a filas de la hoja y formato del `.ics`. Los repositorios se
prueban contra una IndexedDB real, no contra dobles.

No hay pruebas de componentes: la interfaz se ha verificado a mano en Chromium.
