/** Schnittstelle zum Nachrichtenbroker; in Tests austauschbar. */
export interface EventPublisher {
  /** Veröffentlicht mit QoS 1 („mindestens einmal“). */
  publish(topic: string, message: Record<string, unknown>): Promise<void>;
  isConnected(): boolean;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
