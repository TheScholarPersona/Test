import { Migration } from '@mikro-orm/migrations';

/** TU-Fehlermeldungen und Anlagenzustand je Platz */
export class Migration20261117600000_unit_errors_plc_state extends Migration {

  override name = 'Migration20261117600000_unit_errors_plc_state';

  override up(): void | Promise<void> {
    this.addSql(`create table "transport_unit_error" ("id" uuid not null, "unit_id" uuid null, "barcode" varchar(64) not null, "code" varchar(60) not null, "message" varchar(200) null, "location_id" varchar(54) null, "reported_by" varchar(100) null, "reported_at" timestamptz not null, "resolved_at" timestamptz null, "resolved_by" varchar(100) null, "resolution" varchar(200) null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`create index "transport_unit_error_unit_id_index" on "transport_unit_error" ("unit_id");`);
    this.addSql(`create index "transport_unit_error_barcode_index" on "transport_unit_error" ("barcode");`);
    this.addSql(`create index "transport_unit_error_reported_at_index" on "transport_unit_error" ("reported_at");`);

    this.addSql(`alter table "location" add "plc_state" int not null default 0, add "plc_state_text" varchar(200) null, add "plc_state_at" timestamptz null;`);

    this.addSql(`alter table "transport_unit_error" add constraint "transport_unit_error_unit_id_foreign" foreign key ("unit_id") references "transport_unit" ("id") on delete set null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "transport_unit_error" cascade;`);

    this.addSql(`alter table "location" drop column "plc_state", drop column "plc_state_text", drop column "plc_state_at";`);
  }

}
