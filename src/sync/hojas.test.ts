import { describe, expect, it } from 'vitest';
import { CABECERAS, construyeFila, letraColumna, rangoFila } from './hojas';
import type { Jornada, Nota, Ubicacion } from '../domain/tipos';

const jornada: Jornada = {
  id: 'j-1',
  fecha: '2026-07-29',
  hora_inicio: '2026-07-29T10:00:00+02:00',
  hora_fin: '2026-07-29T14:20:00+02:00',
  ubicacion_id: 'u-1',
  motivo: 'averia',
  sistema: 'cctv',
  descripcion: 'Cambiada fuente de alimentación',
  notas: 'Me acuerdo yo solo de esto',
  estado: 'cerrada',
  tipo_horas: 'normal',
  dieta: 'ninguna',
  actualizado_en: '2026-07-29T14:20:00+02:00',
};

const ubicacion: Ubicacion = {
  id: 'u-1',
  nombre: 'nave 3 polígono',
  direccion: '',
  cliente: 'Cliente S.L.',
  notas_acceso: 'Aparcar detrás; preguntar por Marta',
  actualizado_en: '2026-07-29T14:20:00+02:00',
  usado_en: '2026-07-29T14:20:00+02:00',
};

const nota: Nota = {
  id: 'n-1',
  creado_en: '2026-07-29T12:00:00+02:00',
  texto: 'Falta tubo de 25',
  tipo: 'nota',
  fecha_aviso: null,
  estado: 'pendiente',
  etiqueta: 'material',
  jornada_id: 'j-1',
  ubicacion_id: 'u-1',
  enviado_a_calendario: false,
  actualizado_en: '2026-07-29T12:00:00+02:00',
};

describe('direcciones de celda', () => {
  it('traduce índices a letras de columna', () => {
    expect(letraColumna(0)).toBe('A');
    expect(letraColumna(11)).toBe('L');
    expect(letraColumna(25)).toBe('Z');
    expect(letraColumna(26)).toBe('AA');
    expect(letraColumna(27)).toBe('AB');
  });

  it('cubre exactamente el ancho de la hoja', () => {
    expect(rangoFila('jornadas', 7)).toBe('jornadas!A7:N7');
    expect(rangoFila('ubicaciones', 2)).toBe('ubicaciones!A2:F2');
  });
});

describe('filas', () => {
  it('coloca el id en la columna A: de ahí sale el upsert', () => {
    for (const coleccion of ['jornadas', 'ubicaciones', 'notas'] as const) {
      expect(CABECERAS[coleccion][0]).toBe('id');
    }
    expect(construyeFila('jornadas', jornada, 5)[0]).toBe('j-1');
    expect(construyeFila('ubicaciones', ubicacion, 5)[0]).toBe('u-1');
    expect(construyeFila('notas', nota, 5)[0]).toBe('n-1');
  });

  it('escribe tantas celdas como columnas tiene la cabecera', () => {
    expect(construyeFila('jornadas', jornada, 2)).toHaveLength(CABECERAS.jornadas.length);
    expect(construyeFila('ubicaciones', ubicacion, 2)).toHaveLength(CABECERAS.ubicaciones.length);
    expect(construyeFila('notas', nota, 2)).toHaveLength(CABECERAS.notas.length);
  });

  it('deja la duración como fórmula de la propia fila, no como valor guardado', () => {
    const fila = construyeFila('jornadas', jornada, 9);
    const duracion = String(fila[CABECERAS.jornadas.indexOf('duracion_min')]);
    expect(duracion.startsWith('=')).toBe(true);
    expect(duracion).toContain('C9');
    expect(duracion).toContain('D9');
    // Separador de argumentos `,`: el documento se crea con locale en_US.
    expect(duracion).not.toContain(';');
  });

  it('resuelve el nombre del sitio en la hoja en vez de duplicarlo', () => {
    const fila = construyeFila('jornadas', jornada, 4);
    expect(fila[CABECERAS.jornadas.indexOf('ubicacion')]).toBe(
      '=IFERROR(VLOOKUP(F4,ubicaciones!A:B,2,FALSE),"")',
    );
  });

  it('convierte los nulos en celdas vacías, no en el texto "null"', () => {
    const abierta = { ...jornada, hora_fin: null, ubicacion_id: null, motivo: null, sistema: null };
    const fila = construyeFila('jornadas', abierta, 2);
    expect(fila[CABECERAS.jornadas.indexOf('hora_fin')]).toBe('');
    expect(fila[CABECERAS.jornadas.indexOf('ubicacion_id')]).toBe('');
    expect(fila[CABECERAS.jornadas.indexOf('motivo')]).toBe('');
    expect(fila.some((celda) => celda === null || celda === undefined)).toBe(false);
  });
});
