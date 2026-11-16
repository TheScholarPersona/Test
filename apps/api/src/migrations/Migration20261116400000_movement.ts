import { Migration } from '@mikro-orm/migrations';

/** Lagerbewegungen mit Nummernsequenz; höchstens eine offene Bewegung je TU; Historie bleibt beim Löschen von TU oder Platz erhalten. */
export class Migration20261116400000_movement extends Migration {

  override name = 'Migration20261116400000_movement';

  override up(): void | Promise<void> {
    this.addSql(`create sequence if not exists "movement_number_seq" start with 1;`);

    this.addSql(`create table "movement" ("id" uuid not null, "number" varchar(20) not null, "barcode" varchar(64) not null, "unit_id" uuid null, "type" text not null, "state" text not null default 'OPEN', "priority" text not null default 'NORMAL', "priority_rank" int not null default 3, "source_id" uuid null, "source_coordinate" varchar(54) not null, "target_id" uuid null, "target_coordinate" varchar(54) null, "target_group" varchar(40) null, "decision_id" uuid null, "initiator" varchar(100) null, "assigned_to" varchar(100) null, "due_at" timestamptz null, "completed_at" timestamptz null, "completed_location_id" uuid null, "completed_coordinate" varchar(54) null, "deviated" boolean not null default false, "started_at" timestamptz null, "cancelled_at" timestamptz null, "cancel_reason" varchar(200) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "movement" add constraint "movement_number_unique" unique ("number");`);
    this.addSql(`create index "movement_barcode_index" on "movement" ("barcode");`);
    this.addSql(`create index "movement_unit_id_index" on "movement" ("unit_id");`);
    this.addSql(`create index "movement_source_id_index" on "movement" ("source_id");`);
    this.addSql(`create index "movement_target_id_index" on "movement" ("target_id");`);
    this.addSql(`create index "movement_state_priority_idx" on "movement" ("state", "priority_rank", "created_at");`);
    this.addSql(`create unique index "movement_one_active_per_unit" on "movement" ("unit_id") where "state" in ('OPEN', 'IN_PROGRESS');`);

    this.addSql(`alter table "movement" add constraint "movement_unit_id_foreign" foreign key ("unit_id") references "transport_unit" ("id") on delete set null;`);
    this.addSql(`alter table "movement" add constraint "movement_source_id_foreign" foreign key ("source_id") references "location" ("id") on delete set null;`);
    this.addSql(`alter table "movement" add constraint "movement_target_id_foreign" foreign key ("target_id") references "location" ("id") on delete set null;`);
    this.addSql(`alter table "movement" add constraint "movement_completed_location_id_foreign" foreign key ("completed_location_id") references "location" ("id") on delete set null;`);
    this.addSql(`alter table "movement" add constraint "movement_type_check" check ("type" in ('INBOUND', 'RELOCATION', 'REPLENISHMENT', 'OUTBOUND', 'EMPTIES', 'CLEARING', 'MANUAL'));`);
    this.addSql(`alter table "movement" add constraint "movement_state_check" check ("state" in ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'));`);
    this.addSql(`alter table "movement" add constraint "movement_priority_check" check ("priority" in ('HIGHEST', 'HIGH', 'NORMAL', 'LOW', 'LOWEST'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "movement" cascade;`);
    this.addSql(`drop sequence if exists "movement_number_seq";`);
  }

}
