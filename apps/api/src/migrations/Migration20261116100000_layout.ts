import { Migration } from '@mikro-orm/migrations';

/** Lagerstruktur: Platztypen, Gruppenhierarchie, Lagerplätze. */
export class Migration20261116100000_layout extends Migration {

  override name = 'Migration20261116100000_layout';

  override up(): void | Promise<void> {
    this.addSql(`create table "location_group" ("id" uuid not null, "name" varchar(40) not null, "description" varchar(255) not null default '', "group_type" varchar(40) null, "parent_id" uuid null, "inbound_blocked" boolean not null default false, "outbound_blocked" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "location_group" add constraint "location_group_name_unique" unique ("name");`);
    this.addSql(`create index "location_group_parent_id_index" on "location_group" ("parent_id");`);

    this.addSql(`create table "location_type" ("id" uuid not null, "code" varchar(40) not null, "description" varchar(255) not null default '', "length_mm" int null, "width_mm" int null, "height_mm" int null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "location_type" add constraint "location_type_code_unique" unique ("code");`);

    this.addSql(`create table "location" ("id" uuid not null, "location_id" varchar(54) not null, "erp_code" varchar(64) null, "plc_code" varchar(64) null, "description" varchar(255) not null default '', "sort_order" int not null default 0, "type_id" uuid not null, "group_id" uuid not null, "max_transport_units" int not null default 1, "max_weight_kg" numeric(12,3) null, "inbound_blocked" boolean not null default false, "outbound_blocked" boolean not null default false, "allocation_blocked" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "location" add constraint "location_location_id_unique" unique ("location_id");`);
    this.addSql(`alter table "location" add constraint "location_erp_code_unique" unique ("erp_code");`);
    this.addSql(`alter table "location" add constraint "location_plc_code_unique" unique ("plc_code");`);
    this.addSql(`create index "location_type_id_index" on "location" ("type_id");`);
    this.addSql(`create index "location_group_id_index" on "location" ("group_id");`);

    this.addSql(`alter table "location_group" add constraint "location_group_parent_id_foreign" foreign key ("parent_id") references "location_group" ("id") on delete restrict;`);

    this.addSql(`alter table "location" add constraint "location_type_id_foreign" foreign key ("type_id") references "location_type" ("id") on delete restrict;`);
    this.addSql(`alter table "location" add constraint "location_group_id_foreign" foreign key ("group_id") references "location_group" ("id") on delete restrict;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "location_group" drop constraint "location_group_parent_id_foreign";`);
    this.addSql(`alter table "location" drop constraint "location_group_id_foreign";`);
    this.addSql(`alter table "location" drop constraint "location_type_id_foreign";`);

    this.addSql(`drop table if exists "location_group" cascade;`);
    this.addSql(`drop table if exists "location_type" cascade;`);
    this.addSql(`drop table if exists "location" cascade;`);
  }

}
