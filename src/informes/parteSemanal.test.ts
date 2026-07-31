import { describe, expect, it } from 'vitest';
import { construyeFilas } from './parteSemanal';
import type { HorarioLaboral } from '../domain/horario';
import { aInstanteISO } from '../domain/tiempo';
import type { Jornada, Ubicacion } from '../domain/tipos';

const MINUTOS_MINIMOS_GUARDIA = 180;

/**
 * Construye el instante con componentes locales, como haría la app, en vez de
 * fijar un desfase a mano: el cálculo de horas extra compara contra el
 * horario configurado usando la zona del entorno donde corre, y un desfase
 * escrito a mano no tiene por qué coincidir con la de la máquina que ejecuta
 * las pruebas (aquí, UTC).
 */
function instante(anio: number, mes: number, dia: number, hora: number, minuto: number): string {
  return aInstanteISO(new Date(anio, mes - 1, dia, hora, minuto));
}

/** Lunes 4 de mayo de 2026 (fuera de la jornada intensiva de verano). */
const HORARIO: HorarioLaboral = {
  mesInicioVerano: 7,
  mesFinVerano: 8,
  verano: { inicio: '08:00', fin: '14:30' },
  lunesJueves: [
    { inicio: '08:00', fin: '14:00' },
    { inicio: '15:00', fin: '17:30' },
  ],
  viernes: { inicio: '08:00', fin: '14:30' },
};

function jornada(cambios: Partial<Jornada>): Jornada {
  return {
    id: crypto.randomUUID(),
    fecha: '2026-05-04',
    hora_inicio: instante(2026, 5, 4, 8, 0),
    hora_fin: instante(2026, 5, 4, 14, 0),
    ubicacion_id: null,
    motivo: null,
    sistema: null,
    descripcion: '',
    notas: '',
    estado: 'cerrada',
    tipo_horas: 'normal',
    dieta: 'ninguna',
    actualizado_en: '2026-05-04T14:00:00+02:00',
    ...cambios,
  };
}

function ubicacion(cambios: Partial<Ubicacion>): Ubicacion {
  return {
    id: crypto.randomUUID(),
    nombre: 'Blangarma',
    direccion: '',
    cliente: 'Blangarma S.L.',
    notas_acceso: '',
    actualizado_en: '2026-05-04T00:00:00+02:00',
    usado_en: null,
    ...cambios,
  };
}

function filas(lista: Jornada[], porUbicacion: ReadonlyMap<string, Ubicacion> = new Map()) {
  return construyeFilas(lista, porUbicacion, HORARIO, MINUTOS_MINIMOS_GUARDIA);
}

describe('construyeFilas', () => {
  it('escribe día-mes solo la primera vez, y día suelto mientras no cambie el mes', () => {
    const sitio = ubicacion({});
    const resultado = filas(
      [
        jornada({ fecha: '2026-05-04' }),
        jornada({ fecha: '2026-05-05', hora_inicio: '2026-05-05T08:00:00+02:00', hora_fin: '2026-05-05T14:00:00+02:00' }),
        jornada({ fecha: '2026-06-01', hora_inicio: '2026-06-01T08:00:00+02:00', hora_fin: '2026-06-01T14:00:00+02:00' }),
      ],
      new Map([[sitio.id, sitio]]),
    );
    expect(resultado.map((f) => f.fecha)).toEqual(['4-5', '5', '1-6']);
  });

  it('resuelve el sitio a nombre y cliente, no dejando el id en el parte', () => {
    const sitio = ubicacion({ nombre: 'nave 3 polígono', cliente: 'Cliente S.L.' });
    const [fila] = filas([jornada({ ubicacion_id: sitio.id })], new Map([[sitio.id, sitio]]));
    expect(fila?.obra).toBe('nave 3 polígono');
    expect(fila?.clienteProyecto).toBe('Cliente S.L.');
  });

  it('marca "Sin asignar" una jornada sin ubicación, en vez de dejarlo en blanco sin explicar', () => {
    const [fila] = filas([jornada({ ubicacion_id: null })]);
    expect(fila?.obra).toBe('Sin asignar');
  });

  it('combina motivo y descripción en los trabajos, sin inventar nada si faltan', () => {
    const [conAmbos] = filas([jornada({ motivo: 'averia', descripcion: 'Cambiada la fuente' })]);
    expect(conAmbos?.trabajos).toBe('Avería — Cambiada la fuente');

    const [sinNada] = filas([jornada({ motivo: null, descripcion: '' })]);
    expect(sinNada?.trabajos).toBe('—');
  });

  it('las notas privadas nunca aparecen en el parte', () => {
    const [fila] = filas([
      jornada({ motivo: 'averia', descripcion: 'Cambiada la fuente', notas: 'me encargo yo de esto' }),
    ]);
    expect(fila?.trabajos).toBe('Avería — Cambiada la fuente');
    expect(fila?.trabajos).not.toContain('me encargo');
  });

  it('marca media dieta o dieta completa según corresponda, sin importe', () => {
    const [sinDieta] = filas([jornada({ dieta: 'ninguna' })]);
    expect(sinDieta?.mediaDieta).toBe(false);
    expect(sinDieta?.dietaCompleta).toBe(false);

    const [media] = filas([jornada({ dieta: 'media' })]);
    expect(media?.mediaDieta).toBe(true);
    expect(media?.dietaCompleta).toBe(false);

    const [completa] = filas([jornada({ dieta: 'completa' })]);
    expect(completa?.mediaDieta).toBe(false);
    expect(completa?.dietaCompleta).toBe(true);
  });

  it('una jornada sin cerrar muestra la salida en blanco, no una hora inventada', () => {
    const [fila] = filas([jornada({ hora_fin: null, estado: 'abierta' })]);
    expect(fila?.salida).toBe('--:--');
  });

  it('una jornada dentro del horario habitual no lleva nada en horas extra', () => {
    // 08:00-14:00 un lunes: coincide exactamente con el tramo de mañana.
    const [fila] = filas([jornada({})]);
    expect(fila?.horasExtra).toBe('');
  });

  it('lo que cae fuera del horario habitual se calcula solo, sin marcar nada', () => {
    // Viernes: horario 08:00-14:30. Se queda hasta las 16:00.
    const viernes = jornada({
      fecha: '2026-05-08',
      hora_inicio: instante(2026, 5, 8, 8, 0),
      hora_fin: instante(2026, 5, 8, 16, 0),
      tipo_horas: 'normal',
    });
    const [fila] = filas([viernes]);
    expect(fila?.horasExtra).toBe('1:30');
  });

  it('una jornada normal en fin de semana sale entera como horas extra', () => {
    const sabado = jornada({
      fecha: '2026-05-09',
      hora_inicio: instante(2026, 5, 9, 10, 0),
      hora_fin: instante(2026, 5, 9, 12, 0),
    });
    const [fila] = filas([sabado]);
    expect(fila?.horasExtra).toBe('2');
  });

  it('una salida de guardia cuenta como mínimo lo que fije el convenio, aunque el horario diga que estaba libre', () => {
    const corta = jornada({
      tipo_horas: 'guardia',
      fecha: '2026-05-09', // sábado: el horario no le asigna ningún tramo
      hora_inicio: '2026-05-09T02:00:00+02:00',
      hora_fin: '2026-05-09T02:45:00+02:00',
    });
    const [fila] = filas([corta]);
    expect(fila?.horasExtra).toBe('3');
    expect(fila?.entrada).toBe('02:00');
    expect(fila?.salida).toBe('02:45');
  });

  it('una salida de guardia más larga que el mínimo cuenta la duración real', () => {
    const larga = jornada({
      tipo_horas: 'guardia',
      hora_inicio: '2026-05-04T02:00:00+02:00',
      hora_fin: '2026-05-04T06:00:00+02:00',
    });
    const [fila] = filas([larga]);
    expect(fila?.horasExtra).toBe('4');
  });

  it('lleva los minutos de horas extra en minutosExtra, para poder sumarlos en totales', () => {
    // Viernes 08:00-16:00: 1:30 de extra, igual que arriba pero en minutos.
    const viernes = jornada({
      fecha: '2026-05-08',
      hora_inicio: instante(2026, 5, 8, 8, 0),
      hora_fin: instante(2026, 5, 8, 16, 0),
    });
    const sinExtra = jornada({});
    const [filaViernes, filaSinExtra] = filas([viernes, sinExtra]);
    expect(filaViernes?.minutosExtra).toBe(90);
    expect(filaSinExtra?.minutosExtra).toBe(0);
    const total = [filaViernes, filaSinExtra].reduce((suma, fila) => suma + (fila?.minutosExtra ?? 0), 0);
    expect(total).toBe(90);
  });

  it('antepone «Guardia» a la descripción de una salida de guardia', () => {
    const [fila] = filas([
      jornada({ tipo_horas: 'guardia', motivo: 'averia', descripcion: 'Rearme de central' }),
    ]);
    expect(fila?.trabajos).toBe('Guardia — Avería — Rearme de central');
  });
});
