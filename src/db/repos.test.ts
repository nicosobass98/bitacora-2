import { beforeEach, describe, expect, it } from 'vitest';
import { abrirBD } from './db';
import { cuentaPendientes, encola, esperaTrasIntentos, marcaFallo, pendientesListos, reintentaFallidos, todosLosElementos, MAX_INTENTOS } from './outbox';
import {
  abreJornada,
  cierraJornada,
  creaNota,
  creaUbicacion,
  esSemanaDeGuardia,
  estaCompleta,
  guardaJornada,
  jornadaAbierta,
  jornadasEntreFechas,
  jornadasPorCompletar,
  jornadasPorFecha,
  jornadasPorUbicacion,
  leeAjustes,
  guardaAjustes,
  marcaSemanaDeGuardia,
  pendientesDeHoy,
  todasLasSemanasDeGuardia,
  ubicacionesPorUsoReciente,
} from './repos';
import { hoy } from '../domain/tiempo';

async function limpia() {
  const bd = await abrirBD();
  for (const almacen of ['jornadas', 'ubicaciones', 'notas', 'outbox', 'ajustes', 'guardias'] as const) {
    await bd.clear(almacen);
  }
}

beforeEach(limpia);

describe('abrir y cerrar jornada', () => {
  it('abre con la hora puesta sola y sin nada obligatorio', async () => {
    const jornada = await abreJornada({});
    expect(jornada.estado).toBe('abierta');
    expect(jornada.hora_inicio).toBeTruthy();
    expect(jornada.hora_fin).toBeNull();
    expect(jornada.ubicacion_id).toBeNull();
    expect(await jornadaAbierta()).toMatchObject({ id: jornada.id });
  });

  it('acepta una hora de inicio explícita para registrar en frío', async () => {
    const jornada = await abreJornada({ hora_inicio: '2026-03-12T22:40:00+01:00' });
    expect(jornada.hora_inicio).toBe('2026-03-12T22:40:00+01:00');
    expect(jornada.estado).toBe('abierta');
  });

  it('abre siempre como horas normales: la clasificación se decide en frío', async () => {
    const jornada = await abreJornada({});
    expect(jornada.tipo_horas).toBe('normal');
  });

  it('archiva la jornada en el día de su hora de inicio, no en el de hoy', async () => {
    await abreJornada({ hora_inicio: '2026-03-12T22:40:00+01:00' });
    expect(await jornadasPorFecha('2026-03-12')).toHaveLength(1);
    expect(await jornadasPorFecha(hoy())).toHaveLength(0);
  });

  it('marca la modificación con la hora real aunque el inicio sea de antes', async () => {
    // `actualizado_en` dice cuándo se tocó el registro, no cuándo pasó lo que
    // cuenta: si se copiara del inicio, la sincronización perdería el orden.
    const jornada = await abreJornada({ hora_inicio: '2026-03-12T22:40:00+01:00' });
    expect(jornada.actualizado_en.slice(0, 10)).toBe(hoy());
  });

  it('no encola nada al abrir: una jornada abierta vive solo en el móvil', async () => {
    await abreJornada({});
    const cola = await todosLosElementos();
    expect(cola.filter((e) => e.coleccion === 'jornadas')).toHaveLength(0);
  });

  it('al cerrar una jornada completa queda cerrada y encolada', async () => {
    const sitio = await creaUbicacion({ nombre: 'nave 3 polígono' });
    const jornada = await abreJornada({ ubicacion_id: sitio.id, motivo: 'averia' });
    const cerrada = await cierraJornada(jornada.id, { notas: 'Cambiada la fuente' });

    expect(cerrada.estado).toBe('cerrada');
    expect(cerrada.hora_fin).toBeTruthy();
    expect(estaCompleta(cerrada)).toBe(true);

    const cola = await todosLosElementos();
    expect(cola.map((e) => e.coleccion).sort()).toEqual(['jornadas', 'ubicaciones']);
  });

  it('una jornada cerrada deprisa queda incompleta, pero se sincroniza igual', async () => {
    const jornada = await abreJornada({});
    const cerrada = await cierraJornada(jornada.id);

    expect(cerrada.estado).toBe('incompleta');
    const cola = await todosLosElementos();
    expect(cola.some((e) => e.coleccion === 'jornadas')).toBe(true);
  });

  it('completar una jornada incompleta la pasa a cerrada', async () => {
    const sitio = await creaUbicacion({ nombre: 'nave 3 polígono' });
    const jornada = await abreJornada({});
    const incompleta = await cierraJornada(jornada.id);
    expect(await jornadasPorCompletar()).toHaveLength(1);

    const completa = await guardaJornada({
      ...incompleta,
      ubicacion_id: sitio.id,
      motivo: 'mantenimiento',
    });

    expect(completa.estado).toBe('cerrada');
    expect(await jornadasPorCompletar()).toHaveLength(0);
  });

  it('una jornada sin ubicación no aparece en la búsqueda por sitio', async () => {
    const sitio = await creaUbicacion({ nombre: 'nave 3 polígono' });
    const sinSitio = await abreJornada({});
    await cierraJornada(sinSitio.id);

    expect(await jornadasPorUbicacion(sitio.id)).toHaveLength(0);
    // Y por eso está en el contador de por completar: es un agujero en el histórico.
    expect(await jornadasPorCompletar()).toHaveLength(1);
  });

  it('mueve la jornada de día si se corrige la hora de inicio', async () => {
    const jornada = await abreJornada({});
    const cerrada = await cierraJornada(jornada.id);
    await guardaJornada({ ...cerrada, hora_inicio: '2026-03-12T22:00:00+01:00' });

    expect(await jornadasPorFecha('2026-03-12')).toHaveLength(1);
    expect(await jornadasPorFecha(hoy())).toHaveLength(0);
  });
});

describe('búsqueda bidireccional', () => {
  it('encuentra las visitas de un sitio y las jornadas de un día', async () => {
    const sitio = await creaUbicacion({ nombre: 'nave 3 polígono' });
    const primera = await abreJornada({ ubicacion_id: sitio.id, motivo: 'revision' });
    await cierraJornada(primera.id);
    const segunda = await abreJornada({ ubicacion_id: sitio.id, motivo: 'averia' });
    await cierraJornada(segunda.id);

    expect(await jornadasPorUbicacion(sitio.id)).toHaveLength(2);
    expect(await jornadasPorFecha(hoy())).toHaveLength(2);
  });

  it('jornadasEntreFechas incluye los dos extremos del rango', async () => {
    const sitio = await creaUbicacion({ nombre: 'nave 3 polígono' });
    const dentro = await abreJornada({ ubicacion_id: sitio.id, hora_inicio: '2026-05-06T08:00:00+02:00' });
    await cierraJornada(dentro.id, { hora_fin: '2026-05-06T10:00:00+02:00' });
    const enElBorde = await abreJornada({ ubicacion_id: sitio.id, hora_inicio: '2026-05-10T08:00:00+02:00' });
    await cierraJornada(enElBorde.id, { hora_fin: '2026-05-10T10:00:00+02:00' });
    const fuera = await abreJornada({ ubicacion_id: sitio.id, hora_inicio: '2026-05-11T08:00:00+02:00' });
    await cierraJornada(fuera.id, { hora_fin: '2026-05-11T10:00:00+02:00' });

    const semana = await jornadasEntreFechas('2026-05-04', '2026-05-10');
    expect(semana.map((j) => j.id).sort()).toEqual([dentro.id, enElBorde.id].sort());
  });
});

describe('semanas de guardia', () => {
  it('una semana no marcada no es de guardia', async () => {
    expect(await esSemanaDeGuardia('2026-07-27')).toBe(false);
  });

  it('marcar y desmarcar cambia el resultado', async () => {
    await marcaSemanaDeGuardia('2026-07-27', true);
    expect(await esSemanaDeGuardia('2026-07-27')).toBe(true);

    await marcaSemanaDeGuardia('2026-07-27', false);
    expect(await esSemanaDeGuardia('2026-07-27')).toBe(false);
  });

  it('no afecta a otras semanas', async () => {
    await marcaSemanaDeGuardia('2026-07-27', true);
    expect(await esSemanaDeGuardia('2026-08-03')).toBe(false);
    expect(await todasLasSemanasDeGuardia()).toHaveLength(1);
  });
});

describe('ubicaciones', () => {
  it('ordena el autocompletado por uso reciente', async () => {
    const antigua = await creaUbicacion({ nombre: 'antigua' });
    await creaUbicacion({ nombre: 'reciente' });
    // Usar la antigua la sube al principio de la lista.
    await abreJornada({ ubicacion_id: antigua.id });

    const orden = (await ubicacionesPorUsoReciente()).map((u) => u.nombre);
    expect(orden[0]).toBe('antigua');
  });
});

describe('notas', () => {
  it('hereda jornada y sitio de la jornada abierta', async () => {
    const sitio = await creaUbicacion({ nombre: 'nave 3 polígono' });
    const jornada = await abreJornada({ ubicacion_id: sitio.id, motivo: 'averia' });

    const nota = await creaNota({ texto: 'Falta tubo de 25' });
    expect(nota.jornada_id).toBe(jornada.id);
    expect(nota.ubicacion_id).toBe(sitio.id);
  });

  it('respeta un sitio elegido a mano aunque haya jornada abierta', async () => {
    const miercoles = await creaUbicacion({ nombre: 'sitio del miércoles' });
    const hoyMismo = await creaUbicacion({ nombre: 'sitio de hoy' });
    await abreJornada({ ubicacion_id: hoyMismo.id });

    const nota = await creaNota({ texto: 'lo del miércoles', ubicacion_id: miercoles.id });
    expect(nota.ubicacion_id).toBe(miercoles.id);
  });

  it('una nota con fecha de aviso es un recordatorio y nace sin calendario', async () => {
    const nota = await creaNota({ texto: 'Pedir material', fecha_aviso: `${hoy()}T09:00:00+02:00` });
    expect(nota.tipo).toBe('recordatorio');
    expect(nota.enviado_a_calendario).toBe(false);
  });

  it('los pendientes de hoy incluyen los avisos ya vencidos', async () => {
    await creaNota({ texto: 'de ayer', fecha_aviso: '2020-01-01T09:00:00+01:00' });
    await creaNota({ texto: 'del futuro', fecha_aviso: '2099-01-01T09:00:00+01:00' });
    await creaNota({ texto: 'sin aviso' });

    const pendientes = await pendientesDeHoy();
    expect(pendientes.map((n) => n.texto)).toEqual(['de ayer']);
  });
});

describe('cola outbox', () => {
  it('no duplica trabajo: reencolar la misma entidad sustituye los datos', async () => {
    const jornada = await abreJornada({});
    const cerrada = await cierraJornada(jornada.id);
    await encola('jornadas', { ...cerrada, notas: 'corregido' });

    const cola = await todosLosElementos();
    const deJornadas = cola.filter((e) => e.coleccion === 'jornadas');
    expect(deJornadas).toHaveLength(1);
    expect((deJornadas[0]!.datos as typeof cerrada).notas).toBe('corregido');
  });

  it('espera cada vez más entre reintentos', async () => {
    const esperas = Array.from({ length: MAX_INTENTOS }, (_, i) => esperaTrasIntentos(i));
    for (let i = 1; i < esperas.length; i++) {
      expect(esperas[i]!).toBeGreaterThan(esperas[i - 1]!);
    }
  });

  it('un error temporal reprograma el intento en vez de darlo por perdido', async () => {
    const jornada = await abreJornada({});
    await cierraJornada(jornada.id);
    const [elemento] = await todosLosElementos();

    await marcaFallo([elemento!.id], 'error de servidor');
    const [tras] = await todosLosElementos();
    expect(tras!.estado).toBe('pendiente');
    expect(tras!.intentos).toBe(1);
    expect(tras!.ultimo_error).toBe('error de servidor');
    // Con la espera por delante, todavía no toca reintentar.
    expect(await pendientesListos()).toHaveLength(0);
  });

  it('un error permanente se marca y se ve, nunca se falla en silencio', async () => {
    const jornada = await abreJornada({});
    await cierraJornada(jornada.id);
    const [elemento] = await todosLosElementos();

    await marcaFallo([elemento!.id], 'petición inválida', true);
    expect((await cuentaPendientes()).fallidos).toBe(1);

    await reintentaFallidos();
    const cuenta = await cuentaPendientes();
    expect(cuenta.fallidos).toBe(0);
    expect(cuenta.pendientes).toBeGreaterThan(0);
  });

  it('se rinde tras agotar los reintentos', async () => {
    const jornada = await abreJornada({});
    await cierraJornada(jornada.id);
    const [elemento] = await todosLosElementos();

    for (let i = 0; i < MAX_INTENTOS; i++) await marcaFallo([elemento!.id], 'sin red');
    const [tras] = await todosLosElementos();
    expect(tras!.estado).toBe('fallido');
  });
});

describe('ajustes', () => {
  it('devuelve los valores por defecto y conserva lo guardado', async () => {
    expect((await leeAjustes()).horas_aviso_jornada_abierta).toBe(12);
    await guardaAjustes({ spreadsheet_id: 'abc', horas_aviso_jornada_abierta: 8 });
    const ajustes = await leeAjustes();
    expect(ajustes.spreadsheet_id).toBe('abc');
    expect(ajustes.horas_aviso_jornada_abierta).toBe(8);
  });
});
