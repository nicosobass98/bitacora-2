# Bitácora v2

Herramienta personal de registro de jornadas, notas y búsqueda histórica. PWA
local-first: los datos viven en el móvil y Google Sheets es solo la copia.

Especificación funcional completa: [`docs/especificacion.md`](docs/especificacion.md).

## Las tres funciones

1. **Registro de jornadas** — abrir y cerrar, con ubicación y motivo.
2. **Notas y recordatorios** — apuntes rápidos, con aviso opcional vía `.ics`.
3. **Búsqueda bidireccional** — dado un sitio, cuándo estuve; dada una fecha,
   dónde estuve.

El criterio con el que se resuelve cualquier duda de diseño: **si una decisión
obliga a acordarse de algo, es la decisión equivocada.** La captura es de uno o
dos toques; el detalle se completa después, en frío.

## Arranque

```bash
npm install
npm run dev       # servidor de desarrollo
npm test          # 52 pruebas de la lógica de dominio, cola y .ics
npm run build     # comprobación de tipos + build de producción
npm run preview   # sirve dist/ para probar la PWA y el service worker
```

La app funciona entera sin configurar nada: abre, cierra, busca y genera avisos
sin conexión y sin cuenta de Google. Conectar Drive solo añade la copia.

## Conectar la copia en Google Sheets

Solo hace falta una vez, y es opcional.

1. En Google Cloud Console, crea un proyecto y activa **Google Sheets API** y
   **Google Drive API**.
2. Pantalla de consentimiento OAuth: tipo **Externo**, y añade **únicamente** el
   scope `https://www.googleapis.com/auth/drive.file`. Es «no sensible» y basta
   con la verificación básica.
   Publica la app **In Production**: en estado *Testing* el refresh token caduca
   a los 7 días y obliga a reautenticar cada semana.
3. Credenciales → **ID de cliente de OAuth** → tipo *Aplicación web*. En
   *Orígenes autorizados de JavaScript* pon la URL desde la que sirves la PWA
   (y `http://localhost:5173` para desarrollo).
4. En la app: **Ajustes → Client ID**, pegar, **Conectar con Google** y luego
   **Crear la hoja de cálculo**.

Alternativa al paso 4: definir `VITE_GOOGLE_CLIENT_ID` en un `.env` antes de
compilar (ver `.env.example`). Lo que se guarde en Ajustes manda sobre eso.

> **La hoja tiene que crearla la app.** Con `drive.file` la aplicación solo ve
> ficheros que ella misma ha creado. Una hoja hecha a mano en Drive le es
> invisible.

## Cómo está montado

```
src/
  domain/     tipos del modelo y utilidades de fecha con zona horaria
  db/         IndexedDB (fuente de verdad), repositorios y cola outbox
  sync/       OAuth de Google, cliente de Sheets/Drive y vaciado de la cola
  ics/        generación de ficheros .ics
  ui/         router de hash, hooks de consulta, componentes y estilos
  pantallas/  una pantalla por fichero
```

Reglas que atraviesan todo el código:

- **La interfaz nunca espera a la red.** Se escribe en IndexedDB, se encola y se
  sigue. El vaciado de la cola corre aparte.
- **Las búsquedas se resuelven siempre en local.** Si dependieran de Drive no
  funcionarían en un sótano sin cobertura, que es justo cuando hacen falta.
- **Nunca se falla en silencio.** El estado de sincronización está siempre
  visible: verde al día, ámbar pendiente, rojo con fallo.
- **Las fechas llevan zona horaria completa**, para que los cambios de hora de
  marzo y octubre se resuelvan solos.
- **Ninguna acción destructiva sin confirmación.**

### Sincronización

Cola outbox idempotente por `(colección, id)`. Cada vaciado lee la columna de
ids de las tres hojas y escribe todo en **una sola** llamada, porque los límites
de la API se gastan en peticiones, no en filas. Reintentos con espera creciente
(30 s → 2 min → 10 min → 30 min → 2 h); un error permanente marca el registro y
lo enseña en Ajustes.

Las jornadas se sincronizan **solo al cerrarlas**, no al abrirlas: una jornada
abierta vive únicamente en el móvil.

### Recordatorios

Las notificaciones programadas no existen en el estándar de la API de
Notifications, así que el aviso se delega al sistema operativo mediante un
`.ics`. La app genera el fichero, el usuario lo confirma en el calendario, y
solo entonces la nota se marca como enviada. **La nota nunca se va de la app**:
confiar en un recordatorio que no existe es peor que no tener recordatorio.

## Estado y siguientes pasos

Implementado y probado en navegador: el ciclo completo de jornada, notas con
herencia de jornada abierta, las dos búsquedas, historial con filtros, generación
de `.ics`, cola outbox y funcionamiento sin conexión.

Sin verificar contra los servicios reales (§8 de la especificación):

- **Escritura real en Sheets.** El cliente está escrito y probado por unidades,
  pero no se ha ejecutado contra la API con credenciales. Falta confirmar el
  comportamiento de la fórmula de duración y del `locale` del documento.
- **Límites de peticiones de la Sheets API.** El vaciado en lote está diseñado
  para gastar pocas peticiones, pero los números exactos siguen sin contrastar.
- **Atajos del manifiesto PWA** (`shortcuts`) en Android. Las rutas existen y
  responden (`#/jornada/abrir`, `#/notas/nueva`); falta comprobar que Android
  las muestra al mantener pulsado el icono.
- **Comportamiento del `.ics` en Android**: qué aplicación lo captura y si
  respeta el aviso embebido.

Fuera de alcance por decisión explícita: baúl de contraseñas, geolocalización,
multiusuario y cualquier cosa que exija un servidor propio.
