import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEvent, EventEnvelopeSchema, SystemPingEvent, topicForEventType } from '../src/events.js';

describe('Events', () => {
  it('leitet das MQTT-Topic aus dem Event-Typ ab', () => {
    expect(topicForEventType('transport-unit.moved')).toBe('wms/transport-unit/moved');
    expect(SystemPingEvent.topic).toBe('wms/system/ping');
  });

  it.each(['Moved', 'transport_unit.moved', 'single', 'a..b'])('lehnt ungültigen Event-Typ %j ab', (type) => {
    expect(() => topicForEventType(type)).toThrow();
  });

  it('erzeugt einen gültigen Umschlag mit Metadaten', () => {
    const occurredAt = new Date('2026-01-02T03:04:05.000Z');
    const event = SystemPingEvent.create({ message: 'hallo' }, { source: 'wms-api', correlationId: 'run-1', occurredAt });

    expect(EventEnvelopeSchema.parse(event)).toBeTruthy();
    expect(event).toMatchObject({
      type: 'system.ping',
      version: 1,
      source: 'wms-api',
      correlationId: 'run-1',
      occurredAt: '2026-01-02T03:04:05.000Z',
      payload: { message: 'hallo' },
    });
  });

  it('lässt correlationId weg, wenn keine angegeben ist', () => {
    const event = SystemPingEvent.create({ message: 'x' }, { source: 'wms-api' });
    expect('correlationId' in event).toBe(false);
  });

  it('prüft das Payload beim Erzeugen und beim Lesen', () => {
    expect(() => SystemPingEvent.create({ message: '' }, { source: 'wms-api' })).toThrow();

    const other = defineEvent('system.other', 1, z.object({ n: z.number() }));
    const foreign = other.create({ n: 1 }, { source: 'wms-api' });
    expect(() => SystemPingEvent.parse(foreign)).toThrow(/Erwartet Event \[system.ping\]/);
  });
});
