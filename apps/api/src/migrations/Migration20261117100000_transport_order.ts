import { Migration } from '@mikro-orm/migrations';

/** Transportaufträge mit Nummernsequenz; höchstens ein laufender Auftrag je TU (O-02); Historie bleibt beim Löschen von TU oder Platz erhalten. */
export class Migration20261117100000_transport_order extends Migration {

  override name = 'Migration20261117100000_transport_order';

  override up(): void | Promise<void> {
    this.addSql(`create sequence if not exists "transport_order_number_seq" start with 1;`);
    this.addSql(`create table "transport_order" ("id" uuid not null, "number" varchar(20) not null, "barcode" varchar(64) not null, "unit_id" uuid null, "state" text not null default 'INITIALIZED', "priority" text not null default 'NORMAL', "priority_rank" int not null default 3, "source_id" uuid null, "source_coordinate" varchar(54) not null, "target_id" uuid null, "target_coordinate" varchar(54) null, "target_group" varchar(40) null, "redirect" boolean not null default false, "decision_id" uuid null, "initiator" varchar(100) null, "problem_code" varchar(60) null, "problem_message" varchar(500) null, "problem_at" timestamptz null, "started_at" timestamptz null, "finished_at" timestamptz null, "finished_coordinate" varchar(54) null, "deviated" boolean not null default false, "ended_at" timestamptz null, "end_reason" varchar(200) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "transport_order" add constraint "transport_order_number_unique" unique ("number");`);
    this.addSql(`create index "transport_order_barcode_index" on "transport_order" ("barcode");`);
    this.addSql(`create index "transport_order_unit_id_index" on "transport_order" ("unit_id");`);
    this.addSql(`create index "transport_order_source_id_index" on "transport_order" ("source_id");`);
    this.addSql(`create index "transport_order_target_id_index" on "transport_order" ("target_id");`);
    this.addSql(`create index "transport_order_start_order_idx" on "transport_order" ("state", "priority_rank", "created_at");`);
    this.addSql(`create unique index "transport_order_one_active_per_unit" on "transport_order" ("unit_id") where "state" in ('STARTED', 'INTERRUPTED');`);

    this.addSql(`alter table "transport_order" add constraint "transport_order_unit_id_foreign" foreign key ("unit_id") references "transport_unit" ("id") on delete set null;`);
    this.addSql(`alter table "transport_order" add constraint "transport_order_source_id_foreign" foreign key ("source_id") references "location" ("id") on delete set null;`);
    this.addSql(`alter table "transport_order" add constraint "transport_order_target_id_foreign" foreign key ("target_id") references "location" ("id") on delete set null;`);
    this.addSql(`alter table "transport_order" add constraint "transport_order_state_check" check ("state" in ('INITIALIZED', 'STARTED', 'INTERRUPTED', 'FINISHED', 'CANCELED', 'ONFAILURE'));`);
    this.addSql(`alter table "transport_order" add constraint "transport_order_priority_check" check ("priority" in ('HIGHEST', 'HIGH', 'NORMAL', 'LOW', 'LOWEST'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "transport_order" cascade;`);
    this.addSql(`drop sequence if exists "transport_order_number_seq";`);
  }

}
