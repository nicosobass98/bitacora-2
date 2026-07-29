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

En `npm run dev` **el service worker no se registra**: para probar la instalación
y el funcionamiento sin red hace falta `npm run build && npm run preview`.

## Abrirla en el móvil

Un service worker exige contexto seguro. `localhost` cuenta, pero la IP de la red
local por `http://` no: entrando desde el móvil a `http://192.168.x.x:5173` la app
se ve, pero no se instala ni cachea — o sea, ni icono en el escritorio ni arranque
sin cobertura. Por eso se publica por HTTPS en GitHub Pages.

Pages es gratuito en repositorios **públicos**; desde uno privado exige plan de
pago. Ver más abajo por qué publicar el código no publica los datos.

**Una vez, en el repositorio:** *Settings → Pages → Build and deployment →
Source: **GitHub Actions***. No hay que elegir rama.

A partir de ahí, el workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml)
publica solo en cada `push` a `main`. Para publicar desde una rama sin fusionarla,
*Actions → Pages → Run workflow* y eligiendo la rama.

Queda servida en `https://nicosobass98.github.io/bitacora-2/`. Desde Chrome en
Android: menú → **Añadir a pantalla de inicio**. Se abre a pantalla completa, y al
mantener pulsado el icono aparecen los atajos «Abrir jornada» y «Nueva nota».

## Copia de seguridad en un fichero

*Ajustes → Copia de seguridad → Exportar* guarda un `.json` con las tres
colecciones. *Importar* lo devuelve.

Importar **mezcla, no sustituye**: nunca borra lo que ya hay, y ante el mismo
`id` se queda con el `actualizado_en` más reciente. Como los ids son UUID
generados en el móvil, importar dos veces el mismo fichero no duplica nada — la
misma idempotencia en la que se apoya la cola outbox (§4). Un fichero que no se
entienda se rechaza entero, diciendo por qué, en vez de aplicar «lo que se
pueda».

Los ajustes no van en la copia: el id de la hoja de cálculo no debe viajar a
otro dispositivo, o dos móviles escribirían en la misma hoja pisándose las filas.

Esto cubre dos casos que la copia en Sheets no cubre:

- **Funciona sin nada**: sin cuenta de Google, sin alta en Google Cloud y sin red.
- **En iOS es la única forma de mover los datos** entre la web abierta en Safari
  y la misma web añadida a la pantalla de inicio. No comparten IndexedDB, así
  que lo apuntado en una no aparece en la otra.

### Nota sobre iOS

La especificación está escrita para Android. En iPhone hay tres diferencias:

- Se instala desde **Safari** → Compartir → *Añadir a pantalla de inicio*.
- Los `shortcuts` del manifiesto no existen: iOS no los lee.
- iOS es más agresivo desalojando el almacenamiento de las webs. En un sistema
  cuya fuente de verdad es el dispositivo, exportar deja de ser opcional.

## Privacidad: el código es público, los datos no

Publicar el repositorio publica **el programa**, no lo que se apunta con él. Es
la diferencia entre publicar los planos de una libreta y publicar la libreta.

Los datos se guardan en dos sitios, y ninguno es GitHub:

1. **IndexedDB, en el móvil.** Es la fuente de verdad. Vive dentro del navegador
   del teléfono y no sale de ahí salvo que se envíe a Drive a propósito.
2. **Una hoja en el Google Drive del usuario**, solo si se conecta Drive. La crea
   la app dentro de esa cuenta y nace privada, como cualquier fichero de Drive.

Que la web esté publicada significa que un desconocido puede abrir la URL y ver
**la app vacía**: su propio IndexedDB en blanco, en su propio dispositivo. No hay
servidor común, ni base de datos compartida, ni cuentas. Es consecuencia directa
de las decisiones de §2 y §9 —un solo usuario, sin servidor propio—: no existe el
sitio donde estarían los datos para que alguien pudiera mirarlos.

Si ese desconocido pulsara «Conectar con Google», entraría con **su** cuenta y se
crearía **su** hoja. El Client ID que va en la app no es una contraseña: en
cualquier aplicación de navegador es público por diseño, y no da acceso a nada
ajeno. Lo que acota su uso es la lista de orígenes autorizados.

Esto es comprobable, no una promesa. La app solo habla con dos dominios, y con
ninguno más: `accounts.google.com` para el acceso y `sheets.googleapis.com` para
la copia. No hay analítica, ni telemetría, ni servidor propio. Se verifica con:

```bash
grep -rn "fetch(\|XMLHttpRequest\|sendBeacon" src/   # una sola llamada, en sync/drive.ts
```

Los tres bordes que sí hay que respetar:

- **No meter nunca un fichero de datos en el repositorio.** La app no lo hace ni
  puede hacerlo: no existe ninguna función que escriba jornadas en el código.
- **El `.env` está en `.gitignore`.** No se sube. Solo se versiona
  `.env.example`, que va vacío.
- **El enlace de la hoja de Drive** sí abre los datos a quien lo tenga si se
  cambian los permisos de la hoja. Por defecto es privada: no compartirla.

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
   *Orígenes autorizados de JavaScript* pon el origen desde el que sirves la PWA
   —para Pages es `https://nicosobass98.github.io`, **sin** la parte
   `/bitacora-2/`— y `http://localhost:5173` para desarrollo.
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

### Parte de trabajo semanal

*Historial → Parte semanal* genera un `.docx` con las jornadas de la semana
elegida (lunes a domingo), en apaisado para que quepan las 13 columnas del
parte que exige la empresa/cliente: fecha, obra, cliente, horario, horas
extra, dietas, VºBº y trabajos realizados.

Solo se rellenan las columnas que Bitácora conoce de verdad — fecha, obra
(nombre y cliente de la ubicación), horario y una descripción con el motivo y
las notas. Horas extra, dietas y VºBº se dejan en blanco: inventar un valor
ahí sería el mismo dato falso que la especificación evita en todas partes.

*Ajustes → Datos para el parte semanal* guarda una vez el nombre, la
categoría profesional, el NIF y una foto de la firma. Sin firma, el documento
deja una línea en blanco para firmar a mano — nunca se inventa una. Estos
datos no se sincronizan ni entran en la copia de seguridad: son personales y
no tienen por qué viajar a otro dispositivo.

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
