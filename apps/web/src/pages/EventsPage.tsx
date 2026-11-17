import { useState } from 'react';
import { LiveFeed } from '../components/LiveFeed';
import { Panel } from '../components/ui';
import { useLive } from '../live/events';

export function EventsPage() {
  const { connected, events } = useLive();
  const [filter, setFilter] = useState('');
  return (
    <>
      <h1>Ereignisse</h1>
      <p className="muted">
        Live über Server-Sent Events ({connected ? 'verbunden' : 'getrennt'}). Angezeigt werden die letzten {events.length} Ereignisse seit dem Öffnen der Seite.
      </p>
      <div className="toolbar">
        <label>
          Typ enthält
          <input value={filter} onChange={(e) => setFilter(e.target.value.trim())} placeholder="z. B. stock oder flow.command" />
        </label>
      </div>
      <Panel>
        <LiveFeed limit={200} filter={filter ? (type) => type.includes(filter) : undefined} />
      </Panel>
    </>
  );
}
