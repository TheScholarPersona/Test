import { Migration } from '@mikro-orm/migrations';

/** Outbox-Tabelle für zuverlässiges Veröffentlichen von Events (Transactional Outbox). */
export class Migration20261116000000_outbox extends Migration {
  override name = 'Migration20261116000000_outbox';

  override up(): void {
    this.addSql(
      `create table "outbox_message" ("id" uuid not null, "event_type" varchar(120) not null, "topic" varchar(255) not null, "envelope" jsonb not null, "occurred_at" timestamptz not null, "published_at" timestamptz null, "attempts" int not null default 0, "next_attempt_at" timestamptz not null, "last_error" text null, "version" int not null default 1, primary key ("id"));`,
    );
    // Das Relay sucht nur unveröffentlichte Einträge; der Teilindex bleibt dadurch klein.
    this.addSql(
      `create index "outbox_message_pending_idx" on "outbox_message" ("next_attempt_at", "occurred_at") where "published_at" is null;`,
    );
  }

  override down(): void {
    this.addSql(`drop table if exists "outbox_message";`);
  }
}
