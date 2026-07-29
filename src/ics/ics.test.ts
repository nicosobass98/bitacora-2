import { describe, expect, it } from 'vitest';
import { aFormatoICS, construyeICS, escapaTexto, nombreFichero, pliegaLinea } from './ics';
import type { Nota } from '../domain/tipos';

function nota(cambios: Partial<Nota> = {}): Nota {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    creado_en: '2026-07-29T10:00:00+02:00',
    texto: 'Pedir tubo de 25',
    tipo: 'recordatorio',
    fecha_aviso: '2026-08-03T09:00:00+02:00',
    estado: 'pendiente',
    etiqueta: 'material',
    jornada_id: null,
    ubicacion_id: null,
    enviado_a_calendario: false,
    actualizado_en: '2026-07-29T10:00:00+02:00',
    ...cambios,
  };
}

describe('formato de fecha iCalendar', () => {
  it('convierte a UTC compacto', () => {
    expect(aFormatoICS('2026-08-03T09:00:00+02:00')).toBe('20260803T070000Z');
    expect(aFormatoICS('2026-01-05T00:30:00Z')).toBe('20260105T003000Z');
  });

  it('rechaza un instante inválido en vez de escribir basura en el fichero', () => {
    expect(() => aFormatoICS('mañana')).toThrow();
  });
});

describe('escapado RFC 5545', () => {
  it('escapa la barra, el punto y coma, la coma y los saltos de línea', () => {
    expect(escapaTexto('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
    expect(escapaTexto('linea1\nlinea2')).toBe('linea1\\nlinea2');
    expect(escapaTexto('linea1\r\nlinea2')).toBe('linea1\\nlinea2');
  });
});

describe('plegado de líneas', () => {
  it('deja intactas las líneas cortas', () => {
    expect(pliegaLinea('SUMMARY:corto')).toBe('SUMMARY:corto');
  });

  it('pliega a 75 octetos con un espacio de continuación', () => {
    const plegada = pliegaLinea(`SUMMARY:${'a'.repeat(200)}`);
    const lineas = plegada.split('\r\n');
    expect(lineas.length).toBeGreaterThan(1);
    expect(lineas[0]!.length).toBeLessThanOrEqual(75);
    for (const linea of lineas.slice(1)) expect(linea.startsWith(' ')).toBe(true);
  });

  it('mide en octetos, de modo que no parte un carácter multibyte', () => {
    const plegada = pliegaLinea(`DESCRIPTION:${'ñ'.repeat(120)}`);
    const codificador = new TextEncoder();
    for (const linea of plegada.split('\r\n')) {
      expect(codificador.encode(linea).length).toBeLessThanOrEqual(75);
      expect(linea).not.toContain('�');
    }
    expect(plegada.replace(/\r\n /g, '')).toBe(`DESCRIPTION:${'ñ'.repeat(120)}`);
  });
});

describe('construcción del evento', () => {
  it('genera un VEVENT con su VALARM', () => {
    const ics = construyeICS(nota(), { ahora: new Date('2026-07-29T08:00:00Z') });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART:20260803T070000Z');
    expect(ics).toContain('DTEND:20260803T071500Z');
    expect(ics).toContain('DTSTAMP:20260729T080000Z');
    expect(ics).toContain('SUMMARY:Pedir tubo de 25');
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER;RELATED=START:PT0S');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('usa el id de la nota como UID, para actualizar en vez de duplicar', () => {
    const ics = construyeICS(nota());
    expect(ics).toContain('UID:11111111-2222-3333-4444-555555555555@bitacora.local');
  });

  it('acepta antelación en minutos', () => {
    const ics = construyeICS(nota(), { minutosAntes: 30 });
    expect(ics).toContain('TRIGGER;RELATED=START:-PT30M');
  });

  it('separa las líneas con CRLF', () => {
    const ics = construyeICS(nota());
    expect(ics.split('\r\n').length).toBeGreaterThan(10);
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('se niega a construir un evento sin fecha de aviso', () => {
    expect(() => construyeICS(nota({ fecha_aviso: null }))).toThrow();
  });
});

describe('nombre de fichero', () => {
  it('quita tildes y caracteres raros', () => {
    expect(nombreFichero(nota({ texto: 'Revisión cámara 3 (¡urgente!)' }))).toBe(
      'revision-camara-3-urgente.ics',
    );
  });

  it('cae en un nombre por defecto si no queda nada utilizable', () => {
    expect(nombreFichero(nota({ texto: '¿¿¿???' }))).toBe('recordatorio.ics');
  });
});
