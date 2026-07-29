import type { Coleccion, Jornada, Nota, Ubicacion } from '../domain/tipos';

/**
 * Traducción entre el modelo local y las filas de Google Sheets (§3: tres
 * colecciones replicadas como tres hojas del mismo documento).
 *
 * La columna A es siempre el `id`. De ahí sale el upsert: antes de escribir se
 * lee la columna A, y el id decide si la fila se actualiza o se añade. Eso es lo
 * que hace la cola segura ante reintentos.
 */

export const HOJAS: readonly Coleccion[] = ['jornadas', 'ubicaciones', 'notas'];

export const CABECERAS: Record<Coleccion, string[]> = {
  jornadas: [
    'id',
    'fecha',
    'hora_inicio',
    'hora_fin',
    'duracion_min',
    'ubicacion_id',
    'ubicacion',
    'motivo',
    'sistema',
    'notas',
    'estado',
    'actualizado_en',
  ],
  ubicaciones: ['id', 'nombre', 'direccion', 'cliente', 'notas_acceso', 'actualizado_en'],
  notas: [
    'id',
    'creado_en',
    'texto',
    'tipo',
    'fecha_aviso',
    'estado',
    'etiqueta',
    'jornada_id',
    'ubicacion_id',
    'ubicacion',
    'enviado_a_calendario',
    'actualizado_en',
  ],
};

/** Índice 0 → `A`, 25 → `Z`, 26 → `AA`. */
export function letraColumna(indice: number): string {
  let n = indice;
  let letra = '';
  do {
    letra = String.fromCharCode(65 + (n % 26)) + letra;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letra;
}

export function rangoFila(hoja: Coleccion, fila: number): string {
  const ultima = letraColumna(CABECERAS[hoja].length - 1);
  return `${hoja}!A${fila}:${ultima}${fila}`;
}

/**
 * Fórmula de duración (§3.1: «calculada en la hoja, no almacenada»).
 *
 * Los instantes se guardan como texto ISO con desfase, que Sheets no interpreta
 * como fecha, así que la fórmula lo descompone a mano. Se resta el desfase de
 * cada extremo para que una jornada que cruza el cambio de hora de octubre no
 * salga con una hora de más.
 *
 * Separador de argumentos `,`: el documento se crea con locale `en_US`
 * justamente para que el separador sea determinista (ver `creaDocumento`).
 */
function formulaDuracion(fila: number): string {
  const utc = (celda: string) =>
    `(DATEVALUE(LEFT(${celda},10))+TIMEVALUE(MID(${celda},12,8))` +
    `-IF(RIGHT(${celda},1)="Z",0,` +
    `IF(MID(${celda},20,1)="-",-1,1)*(VALUE(MID(${celda},21,2))+VALUE(MID(${celda},24,2))/60)/24))`;
  return (
    `=IF(OR(C${fila}="",D${fila}=""),"",` +
    `ROUND((${utc(`D${fila}`)}-${utc(`C${fila}`)})*1440))`
  );
}

/** Nombre legible de la ubicación, resuelto en la hoja para no duplicar el dato. */
function formulaUbicacion(columnaId: string, fila: number): string {
  return `=IFERROR(VLOOKUP(${columnaId}${fila},ubicaciones!A:B,2,FALSE),"")`;
}

type Fila = (string | number | boolean)[];

export function filaJornada(jornada: Jornada, fila: number): Fila {
  return [
    jornada.id,
    jornada.fecha,
    jornada.hora_inicio,
    jornada.hora_fin ?? '',
    formulaDuracion(fila),
    jornada.ubicacion_id ?? '',
    formulaUbicacion('F', fila),
    jornada.motivo ?? '',
    jornada.sistema ?? '',
    jornada.notas,
    jornada.estado,
    jornada.actualizado_en,
  ];
}

export function filaUbicacion(ubicacion: Ubicacion): Fila {
  return [
    ubicacion.id,
    ubicacion.nombre,
    ubicacion.direccion,
    ubicacion.cliente,
    ubicacion.notas_acceso,
    ubicacion.actualizado_en,
  ];
}

export function filaNota(nota: Nota, fila: number): Fila {
  return [
    nota.id,
    nota.creado_en,
    nota.texto,
    nota.tipo,
    nota.fecha_aviso ?? '',
    nota.estado,
    nota.etiqueta,
    nota.jornada_id ?? '',
    nota.ubicacion_id ?? '',
    formulaUbicacion('I', fila),
    nota.enviado_a_calendario,
    nota.actualizado_en,
  ];
}

export function construyeFila(
  coleccion: Coleccion,
  datos: Jornada | Ubicacion | Nota,
  fila: number,
): Fila {
  switch (coleccion) {
    case 'jornadas':
      return filaJornada(datos as Jornada, fila);
    case 'ubicaciones':
      return filaUbicacion(datos as Ubicacion);
    case 'notas':
      return filaNota(datos as Nota, fila);
  }
}
