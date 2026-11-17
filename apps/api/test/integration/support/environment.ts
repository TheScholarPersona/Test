import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import mqtt, { type MqttClient } from 'mqtt';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

export interface TestEnvironment {
  databaseUrl: string;
  mqttUrl: string;
  stop(): Promise<void>;
}

/** Startet PostgreSQL und Mosquitto in Containern (Images wie in docker-compose.yml). */
export async function startEnvironment(): Promise<TestEnvironment> {
  const [postgres, mosquitto]: [StartedPostgreSqlContainer, StartedTestContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').withDatabase('wms').withUsername('wms').withPassword('wms').start(),
    new GenericContainer('eclipse-mosquitto:2')
      .withCommand(['mosquitto', '-c', '/mosquitto-no-auth.conf'])
      .withExposedPorts(1883)
      .withWaitStrategy(Wait.forLogMessage(/mosquitto version .* running/))
      .start(),
  ]);
  return {
    databaseUrl: postgres.getConnectionUri(),
    mqttUrl: `mqtt://${mosquitto.getHost()}:${mosquitto.getMappedPort(1883)}`,
    async stop() {
      await Promise.all([postgres.stop(), mosquitto.stop()]);
    },
  };
}

export interface ReceivedMessage {
  topic: string;
  body: Record<string, unknown>;
}

/** MQTT-Abonnent, der empfangene Nachrichten sammelt und gezielt darauf warten kann. */
export class MessageCollector {
  readonly messages: ReceivedMessage[] = [];
  private waiters: { predicate: (m: ReceivedMessage) => boolean; resolve: (m: ReceivedMessage) => void }[] = [];

  private constructor(private readonly client: MqttClient) {
    client.on('message', (topic, payload) => {
      const message = { topic, body: JSON.parse(payload.toString()) as Record<string, unknown> };
      this.messages.push(message);
      this.waiters = this.waiters.filter((waiter) => {
        if (waiter.predicate(message)) {
          waiter.resolve(message);
          return false;
        }
        return true;
      });
    });
  }

  static async connect(url: string, topic = 'wms/#'): Promise<MessageCollector> {
    const client = await mqtt.connectAsync(url);
    await client.subscribeAsync(topic, { qos: 1 });
    return new MessageCollector(client);
  }

  waitFor(predicate: (m: ReceivedMessage) => boolean, timeoutMs = 10_000): Promise<ReceivedMessage> {
    const existing = this.messages.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Keine passende MQTT-Nachricht innerhalb von ${timeoutMs} ms`)), timeoutMs);
      this.waiters.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  async close(): Promise<void> {
    await this.client.endAsync();
  }
}
