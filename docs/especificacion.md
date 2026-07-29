# Bitácora v2 — Especificación funcional y técnica

> Estado: diseño cerrado, pendiente de implementación · Fecha: julio 2026
> Autor y único usuario: Nicolás Sobas
> Punto de partida: evolución de la PWA Bitácora existente, no reescritura desde cero

Transcripción del documento de especificación que da origen a este repositorio.
Se guarda aquí para que las decisiones cerradas queden junto al código que las
implementa. El estado real de la implementación está en el
[README](../README.md).

## 1. Objetivo

Esto es una herramienta personal de Nicolás Sobas, para su uso exclusivo. No es
un producto, no tiene otros usuarios y no está pensada para distribuirse.

Su función es ser memoria. Recoger lo que pasa cuando pasa, para poder
recuperarlo después sin depender de acordarse.

Tres funciones:

1. **Registro de jornadas** — abrir y cerrar, con ubicación y motivo.
2. **Notas y recordatorios** — apuntes rápidos, con aviso opcional en una fecha
   futura.
3. **Búsqueda histórica bidireccional** — dado un sitio, saber cuándo estuve;
   dada una fecha, saber dónde estuve.

**Restricción de diseño principal:** la captura tiene que ser de uno o dos
toques, en el momento, sin pensar. El detalle se completa después, en frío.

El sistema no puede depender de recordar abrirlo, ni de tener cobertura. Ese es
el criterio con el que se resuelve cualquier duda de diseño: si una decisión
obliga a acordarse de algo, es la decisión equivocada.

## 2. Arquitectura

- PWA (evolución de Bitácora). Sin Capacitor.
- IndexedDB en el móvil como fuente de verdad.
- Google Sheets como copia/almacén consultable, vía Google Drive API con scope
  `drive.file`.
- Sincronización local-first con cola outbox. La interfaz nunca espera a la red.
- Recordatorios mediante fichero `.ics`. Sin Google Calendar API.
- Sin geolocalización. Sin permiso de ubicación.

### Por qué (decisiones cerradas, no reabrir sin motivo)

| Decisión | Motivo |
| --- | --- |
| Sin Capacitor | Solo se necesitaba para notificaciones locales. Al delegar los avisos en `.ics`, deja de hacer falta. Y sin WebView embebido desaparece el bloqueo de OAuth de Google (`disallowed_useragent`, en vigor desde el 24/07/2023): una PWA se autentica en el navegador real. |
| Scope `drive.file`, nunca `spreadsheets` | `spreadsheets` está clasificado como Sensible y obliga a verificación adicional. `drive.file` es No sensible y solo requiere verificación básica. |
| Publicar la app «In Production» | En estado Testing con tipo externo, el refresh token caduca a los 7 días y obliga a reautenticar cada semana. Al usar solo scopes no sensibles, publicar es viable sin revisión pesada. |
| Sin Google Calendar API | Existe un scope estrecho (`calendar.app.created`) que permitiría a la app crear su propio calendario secundario, pero la documentación de Calendar no publica la columna de sensibilidad que sí tienen Sheets y Drive, así que no se ha podido confirmar su clasificación. Añadirlo arriesgaba la verificación básica. Un `.ics` no tiene ese riesgo. |
| Sin geolocalización | El GPS es poco fiable en interiores, sótanos y naves. La ubicación la decide siempre el usuario. Además evita el permiso, el consumo de batería y guardar un rastro de movimientos en la nube. |
| Notas sin credenciales | Decisión explícita: las notas son texto plano. Las contraseñas quedan fuera del alcance de esta versión. |

### Consecuencia importante de `drive.file`

El scope solo da acceso a ficheros creados por la propia app o seleccionados por
el usuario mediante Google Picker. La hoja de cálculo debe crearla la
aplicación; si se crea a mano en Drive, la app no la verá.

## 3. Modelo de datos

Tres colecciones en IndexedDB, replicadas como tres hojas en el mismo documento
de Google Sheets.

### 3.1 `jornadas`

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | UUID | Generado en el móvil. Clave para la idempotencia de la cola. |
| `fecha` | date | |
| `hora_inicio` | datetime | Con zona horaria. Capturada automáticamente, editable. |
| `hora_fin` | datetime | Con zona horaria. Capturada automáticamente, editable. |
| `duracion` | calculada | Calculada en la hoja, no almacenada. |
| `ubicacion_id` | UUID | Referencia a `ubicaciones`. Nunca texto libre. |
| `motivo` | enum | `mantenimiento` / `averia` / `instalacion` / `revision` |
| `sistema` | enum | `intrusion` / `cctv` / `accesos` |
| `notas` | texto | Libre. |
| `estado` | enum | `abierta` / `cerrada` / `incompleta` |
| `actualizado_en` | datetime | Última modificación local. |

### 3.2 `ubicaciones`

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | UUID | |
| `nombre` | texto | El nombre que usa el usuario en la vida real («nave 3 polígono»), no la dirección postal. |
| `direccion` | texto | Opcional. |
| `cliente` | texto | |
| `notas_acceso` | texto | Dónde aparcar, con quién hablar, dónde está el cuadro. |
| `actualizado_en` | datetime | |

La lista la construye solo el usuario. Crece únicamente cuando se crea una
entrada nueva a mano.

### 3.3 `notas`

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | UUID | |
| `creado_en` | datetime | |
| `texto` | texto | |
| `tipo` | enum | `nota` / `recordatorio` |
| `fecha_aviso` | datetime | Vacío en notas sueltas. |
| `estado` | enum | `pendiente` / `hecha` |
| `etiqueta` | texto | material, pendiente de pedir, etc. |
| `jornada_id` | UUID | Opcional. |
| `ubicacion_id` | UUID | Opcional. Independiente de `jornada_id`: permite escribir el viernes una nota sobre el sitio del miércoles y que se archive donde corresponde. |
| `enviado_a_calendario` | bool | Ver §6. |

## 4. Sincronización

### Patrón

Cola outbox local: `{id, operacion, datos, intentos, ultimo_error}`.

La app escribe siempre en IndexedDB y encola. Un proceso aparte vacía la cola
cuando hay red.

### Reglas

- La interfaz nunca espera a la red. Se guarda y se sigue.
- Sincronizar solo al cerrar la jornada, no al abrirla. Cada jornada se escribe
  una sola vez, la cola es trivial. Una jornada abierta vive solo en el móvil
  hasta que se cierra.
- Antes de escribir, comprobar si el `id` ya existe en la hoja: insertar o
  actualizar según el caso. Esto es lo que hace la cola segura ante reintentos.
- Reintentos con espera creciente, nunca en bucle.
- Manejo de errores:
  - 401 → renovar token y reintentar.
  - Cuota o error de servidor → reintentar más tarde.
  - Error permanente → marcar y avisar en pantalla. Nunca fallar en silencio.
- Vaciar la cola en lote, no una llamada por registro.

### Búsquedas siempre en local

Las dos búsquedas (§5.6) se resuelven exclusivamente contra IndexedDB. Si
dependieran de Drive, no funcionarían en un sótano sin cobertura, que es justo
cuando se necesitan. Drive es solo la copia.

Índices necesarios: por `ubicacion_id` y por `fecha`.

## 5. Pantallas y flujos

### 5.1 Inicio

Una sola acción dominante, que cambia según el estado:

- Sin jornada abierta → **ABRIR JORNADA**
- Con jornada abierta → **CERRAR JORNADA**, mostrando ubicación y hora de inicio
  debajo

Secundario, en pequeño: pendientes de hoy, contador de jornadas por completar y
estado de sincronización.

### 5.2 Abrir jornada

Dos toques:

1. **Ubicación** — autocompletado sobre `ubicaciones`, ordenado por uso reciente.
   Si no existe, se crea en el momento.
2. **Motivo** — botones grandes.

La hora se captura sola. Nada más es obligatorio.

Si falta la ubicación, la jornada se abre igual como «sin asignar». Nunca se
bloquea al usuario en la puerta de un sitio.

Al abrir, mostrar el histórico de esa ubicación: «Última visita: 4 junio,
avería, cambiada fuente de alimentación».

### 5.3 Cerrar jornada

Confirmar hora, campo de notas opcional, cerrar. Una jornada cerrada deprisa
queda en estado `incompleta`.

### 5.4 Completar jornadas

Separar el momento de capturar del de detallar es lo que hace que el sistema
aguante: en campo se captura lo mínimo, en casa se completa.

El contador de «jornadas por completar» no es decorativo: las jornadas sin
asignar no aparecen en ninguna de las dos búsquedas y son agujeros en el
histórico.

### 5.5 Notas

Botón flotante accesible desde cualquier pantalla. Un campo de texto y listo.

Opcionalmente fecha de aviso → ofrece generar el `.ics`.

Si hay jornada abierta, la nota hereda `ubicacion_id` y `jornada_id`
automáticamente.

### 5.6 Búsqueda bidireccional

**Sitio → fechas.** Ficha de ubicación con línea de tiempo única que mezcla
visitas y notas ordenadas por fecha:

```
12 marzo — avería — cambiada fuente de alimentación
12 marzo — nota: falta tubo de 25
4 junio — mantenimiento
```

**Fecha → sitio.** Vista de calendario o selector de día → jornadas de ese día
con sus horas.

Es la misma tabla leída por dos índices distintos.

### 5.7 Historial

Lista por fecha, filtros por ubicación y motivo, edición de cualquier jornada,
enlace directo a la hoja de Drive.

## 6. Recordatorios (.ics)

1. La app genera un fichero `.ics` con el evento y su aviso.
2. El usuario lo abre, el calendario de Android lo reconoce, confirma. Un toque.
3. La nota marca `enviado_a_calendario = true`.

**Regla innegociable:** la nota nunca se va de la app. Si la creación del evento
falla en silencio, el usuario confiaría en un recordatorio que no existe, y eso
es peor que no tener recordatorio. Las notas con
`enviado_a_calendario = false` se muestran destacadas en la bandeja.

El calendario avisa; la app sigue siendo la fuente de verdad.

Contexto: las notificaciones programadas no existen en el estándar de la API de
Notifications. No es que sean poco fiables en PWA: no existen. Por eso el aviso
se delega al sistema operativo.

## 7. Reglas transversales

- La interfaz nunca espera a la red.
- Estado de sincronización siempre visible: verde al día, ámbar pendiente, rojo
  con fallo. Nunca en silencio.
- Ninguna acción destructiva sin confirmación.
- Fechas y horas siempre con zona horaria completa (resuelve solo los cambios de
  hora de marzo y octubre).
- Listas cerradas (`motivo`, `sistema`) en vez de texto libre, para que los
  filtros funcionen dentro de seis meses.

### Jornadas olvidadas abiertas

Si una jornada lleva más de X horas abierta, la app avisa y propone cerrarla a
una hora que el usuario ajusta.

No la cierra sola inventándose la hora. Eso metería datos falsos en los partes,
que es exactamente lo que el sistema debe evitar.

## 8. Pendiente de verificar antes de implementar

Nada de esto está confirmado. No dar por bueno sin contrastar.

1. **Límites de peticiones de la Google Sheets API** — existen, pero los números
   exactos no se han verificado. Afecta al diseño del vaciado en lote de la cola.
2. **Atajos del manifiesto PWA** (`shortcuts`) para «Abrir jornada» y «Nueva
   nota» al mantener pulsado el icono. Probablemente lo que más fricción quita
   por menos código, pero falta confirmar soporte actual en Android.
3. **Comportamiento exacto del `.ics`** al abrirlo desde una PWA en Android: qué
   aplicación lo captura y si el aviso embebido se respeta.
4. **Clasificación de sensibilidad de los scopes de Calendar** — quedó sin
   resolver. Irrelevante mientras no se use la API, documentado por si se
   reabre.

## 9. Fuera de alcance en esta versión

- Baúl de contraseñas. Si en el futuro se necesita, la recomendación es un
  gestor auditado (Bitwarden, KeePassDX) antes que implementación propia.
- Geolocalización automática.
- Multiusuario, compartición o cualquier funcionalidad pensada para terceros. La
  app tiene un solo usuario y así se queda.
- Web Push y cualquier componente que exija un servidor propio.
