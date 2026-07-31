import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ITableBordersOptions,
} from 'docx';
import { ETIQUETA_MOTIVO, type Ajustes, type Jornada, type Ubicacion } from '../domain/tipos';
import { duracionMinutos, formateaFechaLarga, horaDe } from '../domain/tiempo';
import { formateaHorasExtra, minutosExtraAutomaticos, type HorarioLaboral } from '../domain/horario';

/**
 * Genera el parte de trabajo semanal en `.docx`.
 *
 * Reemplaza la plantilla en papel que el usuario rellenaba a mano. Esa
 * plantilla no tenía firma —lo que llevaba dos veces era un logotipo
 * decorativo, no una firma personal— y su tabla de 13 columnas se salía de
 * una página A4 vertical: la columna «TRABAJOS REALIZADOS», la más útil,
 * quedaba cortada al imprimir. Aquí se mantienen las mismas columnas —las
 * exige la plantilla del cliente/empresa para nóminas y dietas— pero en
 * apaisado, para que quepan todas.
 *
 * De las cuatro columnas de horas extra (H/E, H/F, P/N, C) solo se rellena
 * H/E, y no hace falta marcarla a mano: se calcula comparando la hora real
 * de cada jornada con el horario habitual del usuario (`domain/horario.ts`,
 * que cambia con el mes y el día de la semana). Lo que cae fuera de ese
 * horario es hora extra. Una jornada marcada como «salida de guardia» es
 * aparte: siempre es hora extra, y como mínimo `minutos_minimos_guardia`
 * (Ajustes) aunque se haya resuelto antes — el mínimo lo fija el convenio, no
 * Bitácora.
 *
 * De las dos columnas de dietas (M/D, D/C), se marca la que corresponda si la
 * jornada tiene `dieta: 'media'` o `'completa'` — el importe no lo calcula
 * Bitácora, lo fija el convenio, solo si la hubo o no.
 *
 * Festivo, nocturnidad y VºBº se dejan en blanco: son datos que la app no
 * tiene forma de saber con certeza, y rellenarlos igualmente sería el mismo
 * dato falso que la especificación evita en el resto de la app (§7).
 *
 * La fila TOTALES solo suma H/E: es la columna que se paga aparte. Las demás
 * se dejan en blanco, igual que en cada fila de datos.
 */

const ANCHO_PAGINA_A4 = 11906; // DXA, en vertical — docx-js lo intercambia con apaisado.
const ALTO_PAGINA_A4 = 16838;
const MARGEN = 720; // 0.5"

/** Anchos de columna de la plantilla original, en DXA. Suman 15010. */
const ANCHOS_ORIGINALES = [
  1134, 2266, 1273, 1133, 1185, 514, 566, 567, 566, 566, 567, 850, 3823,
] as const;

/** Escala los anchos originales para ocupar todo el ancho útil de la página. */
function anchosDeColumna(): number[] {
  const anchoUtil = ALTO_PAGINA_A4 - MARGEN * 2; // ALTO_PAGINA_A4 es el ancho una vez apaisado.
  const suma = ANCHOS_ORIGINALES.reduce((a, b) => a + b, 0);
  const escala = anchoUtil / suma;
  const escalados = ANCHOS_ORIGINALES.map((ancho) => Math.round(ancho * escala));
  // El redondeo puede dejar el total unas DXA por debajo o por encima; se ajusta
  // en la última columna (la de texto libre) para que la tabla cuadre exacta.
  const diferencia = anchoUtil - escalados.reduce((a, b) => a + b, 0);
  escalados[escalados.length - 1] = (escalados[escalados.length - 1] ?? 0) + diferencia;
  return escalados;
}

const BORDE: ITableBordersOptions = (() => {
  const lado = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  return { top: lado, bottom: lado, left: lado, right: lado, insideHorizontal: lado, insideVertical: lado };
})();

const FUENTE = 'Calibri';

interface OpcionesCelda {
  ancho: number;
  negrita?: boolean;
  tamano?: number;
  centrado?: boolean;
  filas?: number;
  columnas?: number;
}

function celda(texto: string, opciones: OpcionesCelda): TableCell {
  return new TableCell({
    width: { size: opciones.ancho, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    rowSpan: opciones.filas,
    columnSpan: opciones.columnas,
    children: [
      new Paragraph({
        alignment: opciones.centrado === false ? AlignmentType.LEFT : AlignmentType.CENTER,
        children: [
          new TextRun({
            text: texto,
            bold: opciones.negrita ?? false,
            size: opciones.tamano ?? 16,
            font: FUENTE,
          }),
        ],
      }),
    ],
  });
}

export interface FilaParte {
  fecha: string;
  obra: string;
  clienteProyecto: string;
  entrada: string;
  salida: string;
  /** Columna H/E: vacía si la jornada es normal. */
  horasExtra: string;
  /** Minutos de `horasExtra`, para poder sumarlos en la fila de totales. */
  minutosExtra: number;
  /** Columna M/D. */
  mediaDieta: boolean;
  /** Columna D/C. */
  dietaCompleta: boolean;
  trabajos: string;
}

/**
 * Construye las filas de datos a partir de las jornadas de la semana.
 *
 * La fecha se escribe `día-mes` la primera vez y solo `día` mientras se siga
 * en el mismo mes — la misma convención que usaba la plantilla en papel, y
 * que evita repetir "-7" en cada fila de julio.
 *
 * La columna H/E no se marca a mano: una jornada `normal` cuenta solo lo que
 * cae fuera del horario habitual ese día (`domain/horario.ts`), calculado a
 * partir de la hora real de entrada y salida. Una `guardia` es siempre hora
 * extra —cuente lo que cuente el horario ese día— y como mínimo
 * `minutosMinimosGuardia` (Ajustes), aunque la llamada se resolviera antes.
 * En los dos casos, la hora de entrada y salida que se escribe en la fila es
 * siempre la real: solo la cifra de horas extra puede diferir de ella.
 */
export function construyeFilas(
  jornadas: Jornada[],
  ubicaciones: ReadonlyMap<string, Ubicacion>,
  horario: HorarioLaboral,
  minutosMinimosGuardia: number,
): FilaParte[] {
  let mesAnterior: number | null = null;
  return jornadas.map((jornada) => {
    const [, mesTexto, diaTexto] = jornada.fecha.split('-');
    const mes = Number(mesTexto);
    const dia = Number(diaTexto);
    const fecha = mes === mesAnterior ? `${dia}` : `${dia}-${mes}`;
    mesAnterior = mes;

    const ubicacion = jornada.ubicacion_id ? ubicaciones.get(jornada.ubicacion_id) : undefined;
    const esGuardia = jornada.tipo_horas === 'guardia';
    // `notas` es privado (§domain/tipos.ts): el parte solo lee `descripcion`.
    const textoTrabajos = [
      esGuardia ? 'Guardia' : null,
      jornada.motivo ? ETIQUETA_MOTIVO[jornada.motivo] : null,
      jornada.descripcion || null,
    ]
      .filter(Boolean)
      .join(' — ');

    const minutosExtra = esGuardia
      ? Math.max(duracionMinutos(jornada.hora_inicio, jornada.hora_fin) ?? 0, minutosMinimosGuardia)
      : minutosExtraAutomaticos(jornada.hora_inicio, jornada.hora_fin, horario);
    const horasExtra = minutosExtra > 0 ? formateaHorasExtra(minutosExtra) : '';

    return {
      fecha,
      obra: ubicacion?.nombre ?? 'Sin asignar',
      clienteProyecto: ubicacion?.cliente ?? '',
      entrada: horaDe(jornada.hora_inicio),
      salida: horaDe(jornada.hora_fin),
      horasExtra,
      minutosExtra,
      mediaDieta: jornada.dieta === 'media',
      dietaCompleta: jornada.dieta === 'completa',
      trabajos: textoTrabajos || '—',
    };
  });
}

/**
 * Primera fila de cabecera. «HORA», «HORAS EXTRAS» y «DIETAS» agrupan varias
 * columnas (`columnSpan`); las demás ocupan las dos filas de cabecera
 * (`rowSpan`) porque no tienen subcabecera propia — igual que la plantilla en
 * papel agrupaba sus subcolumnas.
 */
function filaCabecera1(anchos: number[]): TableRow {
  const suma = (desde: number, cuenta: number) => anchos.slice(desde, desde + cuenta).reduce((a, b) => a + b, 0);
  return new TableRow({
    tableHeader: true,
    children: [
      celda('FECHA', { ancho: anchos[0] ?? 0, negrita: true, filas: 2 }),
      celda('OBRA', { ancho: anchos[1] ?? 0, negrita: true, filas: 2 }),
      celda('CTE/PROY.', { ancho: anchos[2] ?? 0, negrita: true, filas: 2 }),
      celda('HORA entrada', { ancho: anchos[3] ?? 0, negrita: true }),
      celda('HORA salida', { ancho: anchos[4] ?? 0, negrita: true }),
      celda('HORAS EXTRAS', { ancho: suma(5, 4), negrita: true, columnas: 4 }),
      celda('DIETAS', { ancho: suma(9, 2), negrita: true, columnas: 2 }),
      celda('VºBº', { ancho: anchos[11] ?? 0, negrita: true, filas: 2 }),
      celda('TRABAJOS REALIZADOS', { ancho: anchos[12] ?? 0, negrita: true, filas: 2 }),
    ],
  });
}

function filaCabecera2(anchos: number[]): TableRow {
  // Bajo HORA entrada/salida y bajo HORAS EXTRAS/DIETAS.
  const subtitulos = ['ENTRADA', 'SALIDA', 'H/E', 'H/F', 'P/N', 'C', 'M/D', 'D/C'];
  return new TableRow({
    tableHeader: true,
    children: subtitulos.map((titulo, i) =>
      celda(titulo, { ancho: anchos[i + 3] ?? 0, negrita: true, tamano: 14 }),
    ),
  });
}

function filaDatos(fila: FilaParte, anchos: number[]): TableRow {
  const valores = [
    fila.fecha,
    fila.obra,
    fila.clienteProyecto,
    fila.entrada,
    fila.salida,
    fila.horasExtra, // H/E
    '', // H/F
    '', // P/N
    '', // C
    fila.mediaDieta ? 'X' : '', // M/D
    fila.dietaCompleta ? 'X' : '', // D/C
    '', // VºBº
    fila.trabajos,
  ];
  return new TableRow({
    children: valores.map((valor, i) =>
      celda(valor, { ancho: anchos[i] ?? 0, centrado: i !== 1 && i !== 12 && i !== 2 }),
    ),
  });
}

/**
 * Fila de totales. Solo suma la columna H/E: es la única que se paga aparte y
 * la que de verdad hay que cuadrar al final de la semana. Las demás (H/F, P/N,
 * C, M/D, D/C, VºBº) se dejan en blanco, igual que en cada fila de datos.
 */
function filaTotales(anchos: number[], filas: FilaParte[]): TableRow {
  const totalMinutos = filas.reduce((total, fila) => total + fila.minutosExtra, 0);
  const totalHorasExtra = totalMinutos > 0 ? formateaHorasExtra(totalMinutos) : '';
  return new TableRow({
    children: [
      new TableCell({
        width: { size: anchos.slice(0, 3).reduce((a, b) => a + b, 0), type: WidthType.DXA },
        columnSpan: 3,
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: 'TOTALES', bold: true, size: 16, font: FUENTE })],
          }),
        ],
      }),
      ...anchos.slice(3).map((ancho, i) => {
        const esColumnaHorasExtra = i + 3 === 5;
        return celda(esColumnaHorasExtra ? totalHorasExtra : '', { ancho, negrita: esColumnaHorasExtra });
      }),
    ],
  });
}

export interface DatosParteSemanal {
  inicio: string;
  fin: string;
  ajustes: Ajustes;
  filas: FilaParte[];
  /**
   * Si esta semana es de guardia. Se escribe siempre, en un sentido o en el
   * otro — «si no lo estoy, que no lo estoy» — para que nunca quede la duda de
   * si se olvidó marcar.
   */
  guardia: boolean;
}

function parrafo(texto: string, opciones: { negrita?: boolean; tamano?: number } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: texto, bold: opciones.negrita, size: opciones.tamano ?? 22, font: FUENTE })],
  });
}

/** Decodifica una data URL para pasársela a `ImageRun`. */
function decodificaImagen(dataUrl: string): { tipo: 'png' | 'jpg' | 'gif' | 'bmp'; datos: Uint8Array } {
  const [cabecera, base64] = dataUrl.split(',');
  const mime = /data:image\/(\w+);base64/.exec(cabecera ?? '')?.[1] ?? 'png';
  const tipo = mime === 'jpeg' ? 'jpg' : (mime as 'png' | 'jpg' | 'gif' | 'bmp');
  const binario = atob(base64 ?? '');
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return { tipo, datos: bytes };
}

const ALTO_FIRMA_PX = 70;

export async function construyeParteSemanal(datos: DatosParteSemanal): Promise<Blob> {
  const anchos = anchosDeColumna();
  const { ajustes, filas } = datos;

  const filasFirma: Paragraph[] = [parrafo(' ', { tamano: 22 })];
  if (ajustes.firma_imagen) {
    const { tipo, datos: bytes } = decodificaImagen(ajustes.firma_imagen);
    const proporcion = ajustes.firma_ancho && ajustes.firma_alto ? ajustes.firma_ancho / ajustes.firma_alto : 2;
    filasFirma.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: tipo,
            data: bytes,
            transformation: { width: Math.round(ALTO_FIRMA_PX * proporcion), height: ALTO_FIRMA_PX },
          }),
        ],
      }),
    );
  } else {
    filasFirma.push(parrafo('_______________________________', { tamano: 22 }));
  }
  filasFirma.push(parrafo(`Fdo.: ${ajustes.nombre_tecnico || '(sin configurar en Ajustes)'}`, { tamano: 20 }));

  const documento = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: ANCHO_PAGINA_A4, height: ALTO_PAGINA_A4, orientation: PageOrientation.LANDSCAPE },
            margin: { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN },
          },
        },
        children: [
          parrafo(
            `Parte de trabajo — semana del ${formateaFechaLarga(datos.inicio)} al ${formateaFechaLarga(datos.fin)}`,
            { negrita: true, tamano: 26 },
          ),
          parrafo(
            [
              ajustes.nombre_tecnico && `Técnico: ${ajustes.nombre_tecnico}`,
              ajustes.categoria_profesional && `Profesional: ${ajustes.categoria_profesional}`,
            ]
              .filter(Boolean)
              .join('     '),
          ),
          parrafo(ajustes.nif ? `Nº identificación fiscal: ${ajustes.nif}` : ''),
          parrafo(`Semana de guardia: ${datos.guardia ? 'Sí' : 'No'}`, { negrita: true }),
          new Paragraph({ text: '' }),
          new Table({
            width: { size: anchos.reduce((a, b) => a + b, 0), type: WidthType.DXA },
            columnWidths: anchos,
            borders: BORDE,
            rows: [
              filaCabecera1(anchos),
              filaCabecera2(anchos),
              ...filas.map((fila) => filaDatos(fila, anchos)),
              filaTotales(anchos, filas),
            ],
          }),
          new Paragraph({ text: '' }),
          ...filasFirma,
        ],
      },
    ],
  });

  return Packer.toBlob(documento);
}

export function nombreParteSemanal(inicio: string): string {
  return `parte-semana-${inicio}.docx`;
}

/** Entrega el fichero al sistema, igual que `.ics` y la copia de seguridad. */
export async function entregaParteSemanal(blob: Blob, inicio: string): Promise<void> {
  const nombre = nombreParteSemanal(inicio);

  if (typeof navigator !== 'undefined' && 'canShare' in navigator) {
    const adjunto = new File([blob], nombre, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    if (navigator.canShare?.({ files: [adjunto] })) {
      try {
        await navigator.share({ files: [adjunto], title: 'Parte semanal' });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
