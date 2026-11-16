/**
 * Auswahl von Route und Action – vom Spezifischen zum Allgemeinen wie in
 * OpenWMS (Kap. 3.7), aber als reine Funktionen über vorab geladene
 * Kandidaten: eine Datenbankabfrage je Suche, kein langlebiger Cache (R1, R2).
 */

/** Ort einer Route oder Action: genau ein Platz oder eine Gruppe. */
export type PlaceKey = { kind: 'location'; id: string } | { kind: 'group'; name: string };

export const placeLabel = (key: PlaceKey, labels: Record<string, string> = {}): string =>
  key.kind === 'location' ? `Platz ${labels[key.id] ?? key.id}` : `Gruppe ${key.name}`;

const sameKey = (a: PlaceKey, b: PlaceKey) => (a.kind === 'location' && b.kind === 'location' ? a.id === b.id : a.kind === 'group' && b.kind === 'group' && a.name === b.name);

/**
 * Kandidaten eines Orts in Suchreihenfolge: der Platz (falls vorhanden),
 * dann seine Gruppe und deren Elterngruppen bzw. die Gruppe und ihre Eltern.
 */
export function candidates(location: string | null, groupPath: readonly string[]): PlaceKey[] {
  return [...(location ? [{ kind: 'location', id: location } as PlaceKey] : []), ...groupPath.map((name) => ({ kind: 'group', name }) as PlaceKey)];
}

export interface RouteCandidate {
  routeId: string;
  source: PlaceKey;
  target: PlaceKey;
}

export interface RouteMatch<R extends RouteCandidate> {
  route: R;
  /** Index in den Quell- und Zielkandidaten (0 = genau der Platz). */
  sourceRank: number;
  targetRank: number;
}

/**
 * Beste Route von `sources` nach `targets`: zuerst die spezifischste Quelle,
 * darin das spezifischste Ziel. Bei Gleichstand gewinnt die kleinere `routeId`,
 * damit das Ergebnis eindeutig ist.
 */
export function bestRoute<R extends RouteCandidate>(routes: readonly R[], sources: readonly PlaceKey[], targets: readonly PlaceKey[]): RouteMatch<R> | null {
  let best: RouteMatch<R> | null = null;
  for (const route of routes) {
    const sourceRank = sources.findIndex((s) => sameKey(s, route.source));
    const targetRank = targets.findIndex((t) => sameKey(t, route.target));
    if (sourceRank < 0 || targetRank < 0) continue;
    const better =
      !best ||
      sourceRank < best.sourceRank ||
      (sourceRank === best.sourceRank && (targetRank < best.targetRank || (targetRank === best.targetRank && route.routeId < best.route.routeId)));
    if (better) best = { route, sourceRank, targetRank };
  }
  return best;
}

export interface ActionCandidate {
  name: string;
  /** `null` = für jede Route (auch ohne Route). */
  routeId: string | null;
  /** `null` = überall. */
  place: PlaceKey | null;
}

/**
 * Rang einer Action für ein Ereignis an `places` (Platz, Gruppe, Eltern …)
 * auf Route `routeId`. Reihenfolge: Ort vor Route – für jeden Ort zuerst
 * die passende Route, dann „jede Route“; zuletzt die ortsunabhängigen.
 * Kleiner ist spezifischer; `null` = passt nicht.
 */
export function actionRank(action: ActionCandidate, places: readonly PlaceKey[], routeId: string | null): number | null {
  if (action.routeId !== null && action.routeId !== routeId) return null;
  const routeRank = action.routeId === null ? 1 : 0;
  if (action.place === null) return places.length * 2 + routeRank;
  const placeRank = places.findIndex((p) => sameKey(p, action.place!));
  return placeRank < 0 ? null : placeRank * 2 + routeRank;
}

export function bestAction<A extends ActionCandidate>(actions: readonly A[], places: readonly PlaceKey[], routeId: string | null): A | null {
  let best: { action: A; rank: number } | null = null;
  for (const action of actions) {
    const rank = actionRank(action, places, routeId);
    if (rank === null) continue;
    if (!best || rank < best.rank || (rank === best.rank && action.name < best.action.name)) best = { action, rank };
  }
  return best?.action ?? null;
}
