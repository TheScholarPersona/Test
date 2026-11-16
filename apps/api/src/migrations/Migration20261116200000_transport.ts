import { Migration } from '@mikro-orm/migrations';

/** Transporteinheiten: Typen, Platzierungs- und Stapelregeln, TUs, Barcode-Sequenz. */
export class Migration20261116200000_transport extends Migration {

  override name = 'Migration20261116200000_transport';

  override up(): void | Promise<void> {
    // Fortlaufende Nummer für erzeugte Barcodes (TU0000000001, …).
    this.addSql(`create sequence if not exists "transport_unit_barcode_seq" start with 1;`);

    this.addSql(`create table "transport_unit_type" ("id" uuid not null, "code" varchar(40) not null, "description" varchar(255) not null default '', "length_mm" int null, "width_mm" int null, "height_mm" int null, "tare_weight_kg" numeric(12,3) null, "max_payload_kg" numeric(12,3) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "transport_unit_type" add constraint "transport_unit_type_code_unique" unique ("code");`);

    this.addSql(`create table "transport_unit_stacking_rule" ("id" uuid not null, "base_type_id" uuid not null, "allowed_type_id" uuid not null, "max_count" int not null, primary key ("id"));`);
    this.addSql(`create index "transport_unit_stacking_rule_base_type_id_index" on "transport_unit_stacking_rule" ("base_type_id");`);
    this.addSql(`create index "transport_unit_stacking_rule_allowed_type_id_index" on "transport_unit_stacking_rule" ("allowed_type_id");`);
    this.addSql(`alter table "transport_unit_stacking_rule" add constraint "transport_unit_stacking_rule_base_type_id_allowed_c568f_unique" unique ("base_type_id", "allowed_type_id");`);

    this.addSql(`create table "transport_unit_placement_rule" ("id" uuid not null, "unit_type_id" uuid not null, "location_type_id" uuid not null, "privilege_level" int not null default 0, primary key ("id"));`);
    this.addSql(`create index "transport_unit_placement_rule_unit_type_id_index" on "transport_unit_placement_rule" ("unit_type_id");`);
    this.addSql(`create index "transport_unit_placement_rule_location_type_id_index" on "transport_unit_placement_rule" ("location_type_id");`);
    this.addSql(`alter table "transport_unit_placement_rule" add constraint "transport_unit_placement_rule_unit_type_id_locati_fcac5_unique" unique ("unit_type_id", "location_type_id");`);

    this.addSql(`create table "transport_unit" ("id" uuid not null, "barcode" varchar(64) not null, "type_id" uuid not null, "state" text not null default 'AVAILABLE', "location_id" uuid not null, "target_id" uuid null, "parent_id" uuid null, "weight_kg" numeric(12,3) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "transport_unit" add constraint "transport_unit_barcode_unique" unique ("barcode");`);
    this.addSql(`create index "transport_unit_type_id_index" on "transport_unit" ("type_id");`);
    this.addSql(`create index "transport_unit_location_id_index" on "transport_unit" ("location_id");`);
    this.addSql(`create index "transport_unit_target_id_index" on "transport_unit" ("target_id");`);
    this.addSql(`create index "transport_unit_parent_id_index" on "transport_unit" ("parent_id");`);

    this.addSql(`alter table "transport_unit_stacking_rule" add constraint "transport_unit_stacking_rule_base_type_id_foreign" foreign key ("base_type_id") references "transport_unit_type" ("id") on delete cascade;`);
    this.addSql(`alter table "transport_unit_stacking_rule" add constraint "transport_unit_stacking_rule_allowed_type_id_foreign" foreign key ("allowed_type_id") references "transport_unit_type" ("id") on delete restrict;`);

    this.addSql(`alter table "transport_unit_placement_rule" add constraint "transport_unit_placement_rule_unit_type_id_foreign" foreign key ("unit_type_id") references "transport_unit_type" ("id") on delete cascade;`);
    this.addSql(`alter table "transport_unit_placement_rule" add constraint "transport_unit_placement_rule_location_type_id_foreign" foreign key ("location_type_id") references "location_type" ("id") on delete restrict;`);

    this.addSql(`alter table "transport_unit" add constraint "transport_unit_type_id_foreign" foreign key ("type_id") references "transport_unit_type" ("id") on delete restrict;`);
    this.addSql(`alter table "transport_unit" add constraint "transport_unit_location_id_foreign" foreign key ("location_id") references "location" ("id") on delete restrict;`);
    this.addSql(`alter table "transport_unit" add constraint "transport_unit_target_id_foreign" foreign key ("target_id") references "location" ("id") on delete set null;`);
    this.addSql(`alter table "transport_unit" add constraint "transport_unit_parent_id_foreign" foreign key ("parent_id") references "transport_unit" ("id") on delete restrict;`);
    this.addSql(`alter table "transport_unit" add constraint "transport_unit_state_check" check ("state" in ('AVAILABLE', 'BLOCKED', 'QUALITY_CHECK'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transport_unit_stacking_rule" drop constraint "transport_unit_stacking_rule_base_type_id_foreign";`);
    this.addSql(`alter table "transport_unit_stacking_rule" drop constraint "transport_unit_stacking_rule_allowed_type_id_foreign";`);
    this.addSql(`alter table "transport_unit_placement_rule" drop constraint "transport_unit_placement_rule_unit_type_id_foreign";`);
    this.addSql(`alter table "transport_unit" drop constraint "transport_unit_type_id_foreign";`);
    this.addSql(`alter table "transport_unit" drop constraint "transport_unit_parent_id_foreign";`);

    this.addSql(`drop table if exists "transport_unit_type" cascade;`);
    this.addSql(`drop table if exists "transport_unit_stacking_rule" cascade;`);
    this.addSql(`drop table if exists "transport_unit_placement_rule" cascade;`);
    this.addSql(`drop table if exists "transport_unit" cascade;`);
    this.addSql(`drop sequence if exists "transport_unit_barcode_seq";`);
  }

}
