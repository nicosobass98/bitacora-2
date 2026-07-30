/**
 * Modelo de datos (§3 de la especificación).
 *
 * Reglas que no se negocian:
 * - Los `id` son UUID generados en el móvil. Son la clave de idempotencia de la
 *   cola outbox: reintentar una escritura nunca puede duplicar un registro.
 * - Toda marca de tiempo se guarda como ISO 8601 *con desfase horario completo*
 *   (`2026-07-29T10:03:00+02:00`). Así los cambios de hora de marzo y octubre se
 *   resuelven solos y un parte de las 02:30 no es ambiguo.
 * - `motivo` y `sistema` son listas cerradas para que los filtros sigan
 *   funcionando dentro de seis meses.
 */

/** Fecha local en formato `YYYY-MM-DD`. */
export type FechaISO = string;
/** Instante ISO 8601 con desfase horario, p. ej. `2026-07-29T10:03:00+02:00`. */
export type InstanteISO = string;
export type UUID = string;

export const MOTIVOS = ['mantenimiento', 'averia', 'instalacion', 'revision'] as const;
export type Motivo = (typeof MOTIVOS)[number];

export const SISTEMAS = ['intrusion', 'cctv', 'accesos'] as const;
export type Sistema = (typeof SISTEMAS)[number];

export const ESTADOS_JORNADA = ['abierta', 'cerrada', 'incompleta'] as const;
export type EstadoJornada = (typeof ESTADOS_JORNADA)[number];

/**
 * Clasificación de la jornada para el parte semanal (`informes/parteSemanal.ts`).
 * No es lo mismo que `motivo` (qué se hizo): esto es cómo se compensa.
 *
 * - `normal` — el parte calcula solo lo que cae fuera del horario habitual
 *   (`domain/horario.ts`) y lo cuenta como hora extra; lo que cae dentro no
 *   sale en esa columna. No hay que marcar nada a mano para esto.
 * - `guardia` — salida de guardia: una llamada durante el turno de guardia.
 *   Siempre es hora extra, cuente lo que cuente el horario ese día, y como
 *   mínimo `minutos_minimos_guardia` (Ajustes) aunque se haya resuelto antes
 *   — eso lo decide el convenio, no Bitácora.
 */
export const TIPOS_HORAS = ['normal', 'guardia'] as const;
export type TipoHoras = (typeof TIPOS_HORAS)[number];

export const ETIQUETA_TIPO_HORAS: Record<TipoHoras, string> = {
  normal: 'Horario habitual',
  guardia: 'Salida de guardia',
};

export const TIPOS_NOTA = ['nota', 'recordatorio'] as const;
export type TipoNota = (typeof TIPOS_NOTA)[number];

export const ESTADOS_NOTA = ['pendiente', 'hecha'] as const;
export type EstadoNota = (typeof ESTADOS_NOTA)[number];

/** §3.1 — Una visita a un sitio. `duracion` no se almacena: se calcula. */
export interface Jornada {
  id: UUID;
  fecha: FechaISO;
  hora_inicio: InstanteISO;
  /** `null` mientras la jornada está abierta. */
  hora_fin: InstanteISO | null;
  /** Referencia a `ubicaciones`. Nunca texto libre. `null` = sin asignar. */
  ubicacion_id: UUID | null;
  motivo: Motivo | null;
  sistema: Sistema | null;
  notas: string;
  estado: EstadoJornada;
  /** Cómo cuenta para el parte semanal. Se completa en frío, no al abrir. */
  tipo_horas: TipoHoras;
  actualizado_en: InstanteISO;
}

/** §3.2 — La lista la construye solo el usuario, entrada a entrada. */
export interface Ubicacion {
  id: UUID;
  /** El nombre que se usa en la vida real («nave 3 polígono»), no la dirección postal. */
  nombre: string;
  direccion: string;
  cliente: string;
  /** Dónde aparcar, con quién hablar, dónde está el cuadro. */
  notas_acceso: string;
  actualizado_en: InstanteISO;
  /** Para ordenar el autocompletado por uso reciente (§5.2). Solo local. */
  usado_en: InstanteISO | null;
}

/** §3.3 — Apunte rápido, con aviso opcional en una fecha futura. */
export interface Nota {
  id: UUID;
  creado_en: InstanteISO;
  texto: string;
  tipo: TipoNota;
  /** Vacío en notas sueltas. */
  fecha_aviso: InstanteISO | null;
  estado: EstadoNota;
  /** Texto libre: «material», «pendiente de pedir»… */
  etiqueta: string;
  jornada_id: UUID | null;
  /**
   * Independiente de `jornada_id`: permite escribir el viernes una nota sobre el
   * sitio del miércoles y que se archive donde corresponde.
   */
  ubicacion_id: UUID | null;
  /** §6 — si es `false` y hay `fecha_aviso`, la nota se muestra destacada. */
  enviado_a_calendario: boolean;
  actualizado_en: InstanteISO;
}

/**
 * Marca una semana entera (lunes de esa semana) como de guardia, para que el
 * parte semanal lo diga explícitamente — en un sentido o en el otro, nunca en
 * blanco: «si no lo estoy, que no lo estoy».
 *
 * Solo local: no se sincroniza con Sheets ni pasa por la cola outbox. Sí entra
 * en la copia de seguridad (`db/respaldo.ts`), porque perderla sería perder un
 * dato real.
 */
export interface SemanaGuardia {
  /** Lunes de la semana (`domain/tiempo.ts` → `inicioSemana`). Clave primaria. */
  inicio: FechaISO;
  actualizado_en: InstanteISO;
}

// ---------------------------------------------------------------------------
// Cola de sincronización (§4)
// ---------------------------------------------------------------------------

export const COLECCIONES = ['jornadas', 'ubicaciones', 'notas'] as const;
export type Coleccion = (typeof COLECCIONES)[number];

export type EstadoEnvio = 'pendiente' | 'fallido';

/**
 * Un elemento de la cola outbox. `entidad_id` es el UUID del registro, y solo
 * puede haber un elemento pendiente por (coleccion, entidad_id): encolar dos
 * veces la misma jornada sustituye los datos, no añade trabajo.
 */
export interface ElementoOutbox {
  id: UUID;
  coleccion: Coleccion;
  operacion: 'upsert';
  entidad_id: UUID;
  datos: Jornada | Ubicacion | Nota;
  intentos: number;
  ultimo_error: string | null;
  /** Instante a partir del cual se puede reintentar (espera creciente). */
  siguiente_intento: InstanteISO;
  estado: EstadoEnvio;
  encolado_en: InstanteISO;
}

// ---------------------------------------------------------------------------
// Ajustes (clave/valor local, nunca se sincroniza)
// ---------------------------------------------------------------------------

export interface Ajustes {
  /** Client ID de OAuth. Se configura a mano una vez (ver README). */
  google_client_id: string;
  /** Id del documento de Sheets que ha creado la app. Ver §2: debe crearlo la app. */
  spreadsheet_id: string;
  /** Horas tras las que se avisa de una jornada olvidada abierta (§7). */
  horas_aviso_jornada_abierta: number;
  /** Datos para el parte semanal (`informes/parteSemanal.ts`). Nunca se sincronizan. */
  nombre_tecnico: string;
  categoria_profesional: string;
  nif: string;
  /** Imagen de la firma en data URL, o `null` si no se ha configurado. */
  firma_imagen: string | null;
  /** Dimensiones reales de la imagen, para no deformarla al insertarla en el parte. */
  firma_ancho: number | null;
  firma_alto: number | null;
  /** Mínimo que cuenta una salida de guardia, en minutos. El convenio lo fija, no Bitácora. */
  minutos_minimos_guardia: number;
  /**
   * Horario habitual, para que el parte calcule solo las horas normales/extra
   * (`domain/horario.ts`). Primer y último mes (1-12) de la jornada intensiva
   * de verano; el resto del año se aplica el turno partido de lunes a jueves
   * y la jornada continua de los viernes.
   */
  horario_verano_mes_inicio: number;
  horario_verano_mes_fin: number;
  horario_verano_inicio: string;
  horario_verano_fin: string;
  horario_lj_manana_inicio: string;
  horario_lj_manana_fin: string;
  horario_lj_tarde_inicio: string;
  horario_lj_tarde_fin: string;
  horario_viernes_inicio: string;
  horario_viernes_fin: string;
}

export const AJUSTES_POR_DEFECTO: Ajustes = {
  google_client_id: '',
  spreadsheet_id: '',
  horas_aviso_jornada_abierta: 12,
  nombre_tecnico: '',
  categoria_profesional: '',
  nif: '',
  firma_imagen: null,
  firma_ancho: null,
  firma_alto: null,
  minutos_minimos_guardia: 180,
  horario_verano_mes_inicio: 7,
  horario_verano_mes_fin: 8,
  horario_verano_inicio: '08:00',
  horario_verano_fin: '14:30',
  horario_lj_manana_inicio: '08:00',
  horario_lj_manana_fin: '14:00',
  horario_lj_tarde_inicio: '15:00',
  horario_lj_tarde_fin: '17:30',
  horario_viernes_inicio: '08:00',
  horario_viernes_fin: '14:30',
};

// ---------------------------------------------------------------------------
// Etiquetas para pantalla
// ---------------------------------------------------------------------------

export const ETIQUETA_MOTIVO: Record<Motivo, string> = {
  mantenimiento: 'Mantenimiento',
  averia: 'Avería',
  instalacion: 'Instalación',
  revision: 'Revisión',
};

export const ETIQUETA_SISTEMA: Record<Sistema, string> = {
  intrusion: 'Intrusión',
  cctv: 'CCTV',
  accesos: 'Accesos',
};

export const ETIQUETA_ESTADO_JORNADA: Record<EstadoJornada, string> = {
  abierta: 'Abierta',
  cerrada: 'Cerrada',
  incompleta: 'Incompleta',
};
