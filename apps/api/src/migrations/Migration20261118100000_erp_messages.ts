import { Migration } from '@mikro-orm/migrations';

/** ERP-Anbindung: Nachrichtenprotokoll für Ein- und Ausgang */
export class Migration20261118100000_erp_messages extends Migration {

  override name = 'Migration20261118100000_erp_messages';

  override up(): void | Promise<void> {
    this.addSql(`create table "erp_message" ("id" uuid not null, "direction" text not null, "message_id" varchar(100) not null, "type" varchar(40) not null, "action" varchar(20) null, "state" text not null, "reference" varchar(100) null, "payload" jsonb not null, "result" jsonb null, "attempts" int not null default 0, "next_attempt_at" timestamptz null, "lease_until" timestamptz null, "last_error" text null, "occurred_at" timestamptz not null, "completed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`create index "erp_message_type_index" on "erp_message" ("type");`);
    this.addSql(`create index "erp_message_state_index" on "erp_message" ("state");`);
    this.addSql(`create index "erp_message_reference_index" on "erp_message" ("reference");`);
    this.addSql(`create index "erp_message_created_at_index" on "erp_message" ("created_at");`);
    this.addSql(`alter table "erp_message" add constraint "erp_message_direction_message_id_unique" unique ("direction", "message_id");`);

    this.addSql(`alter table "erp_message" add constraint "erp_message_direction_check" check ("direction" in ('IN', 'OUT'));`);
    this.addSql(`alter table "erp_message" add constraint "erp_message_state_check" check ("state" in ('PENDING', 'IN_DELIVERY', 'SENT', 'PROCESSED', 'FAILED'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "erp_message" cascade;`);
  }

}
