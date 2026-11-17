import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

export interface WmsEvent {
  id: string;
  type: string;
  occurredAt: string;
  source: string;
  correlationId?: string;
  payload: Record<string, unknown>;
}

interface LiveState {
  connected: boolean;
  events: WmsEvent[];
}

const LiveContext = createContext<LiveState>({ connected: false, events: [] });
const KEEP = 200;

/** Welche Abfragen ein Ereignistyp veraltet macht (Präfix der Abfrageschlüssel). */
export function affectedQueries(type: string): string[] {
  const area = type.split('.')[0] ?? '';
  const map: Record<string, string[]> = {
    stock: ['stock', 'overview'],
    'stock-count': ['stock', 'counts'],
    product: ['products'],
    'receiving-order': ['receiving', 'overview'],
    'receiving-position': ['receiving'],
    receiving: ['receiving', 'stock', 'units'],
    'outbound-order': ['outbound', 'overview'],
    'outbound-pick': ['outbound', 'picks', 'stock'],
    allocation: ['outbound'],
    'transport-order': ['transport-orders', 'overview', 'units'],
    movement: ['movements', 'overview', 'units'],
    'transport-unit': ['units', 'stock', 'locations'],
    location: ['locations'],
    'location-group': ['locations'],
    flow: ['flow'],
  };
  return map[area] ?? [];
}

/**
 * Verbindet die Oberfläche per Server-Sent Events mit dem WMS. Jedes
 * Ereignis landet im Ereignisprotokoll und macht die betroffenen Abfragen
 * ungültig – Ansichten aktualisieren sich dadurch von selbst.
 */
export function LiveEventsProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [state, setState] = useState<LiveState>({ connected: false, events: [] });

  useEffect(() => {
    const source = new EventSource('/v1/events/stream');
    source.onopen = () => setState((s) => ({ ...s, connected: true }));
    source.onerror = () => setState((s) => ({ ...s, connected: false }));
    source.addEventListener('wms', (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as WmsEvent;
      setState((s) => ({ connected: true, events: [event, ...s.events].slice(0, KEEP) }));
      for (const key of affectedQueries(event.type)) void client.invalidateQueries({ queryKey: [key] });
    });
    return () => source.close();
  }, [client]);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
