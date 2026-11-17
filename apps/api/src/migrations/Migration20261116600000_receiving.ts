import { Migration } from '@mikro-orm/migrations';

/** Wareneingang: Aufträge, Positionen (Menge oder TU), Erfassungen. */
export class Migration20261116600000_receiving extends Migration {

  override name = 'Migration20261116600000_receiving';

  override up(): void | Promise<void> {
    this.addSql(`create table "receiving_order" ("id" uuid not null, "order_id" varchar(64) not null, "supplier" varchar(100) null, "expected_at" timestamptz null, "state" text not null default 'OPEN', "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "receiving_order" add constraint "receiving_order_order_id_unique" unique ("order_id");`);

    this.addSql(`create table "receiving_capture" ("id" uuid not null, "kind" text not null, "order_id" uuid null, "pos_no" int null, "sku" varchar(64) null, "quantity" numeric(15,3) null, "unit_code" varchar(10) null, "barcode" varchar(64) not null, "location_id" varchar(54) not null, "lot" varchar(64) null, "best_before" date null, "overdelivered" boolean not null default false, "captured_by" varchar(100) null, "movement_number" varchar(20) null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "receiving_capture_order_id_index" on "receiving_capture" ("order_id");`);
    this.addSql(`create index "receiving_capture_barcode_index" on "receiving_capture" ("barcode");`);

    this.addSql(`create table "receiving_position" ("id" uuid not null, "order_id" uuid not null, "pos_no" int not null, "kind" text not null, "state" text not null default 'OPEN', "product_id" uuid null, "expected_quantity" numeric(15,3) null, "received_quantity" numeric(15,3) not null default '0', "unit_code" varchar(10) null, "expected_barcode" varchar(64) null, "unit_type_code" varchar(40) null, "received_barcode" varchar(64) null, "close_reason" varchar(200) null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`create index "receiving_position_order_id_index" on "receiving_position" ("order_id");`);
    this.addSql(`create index "receiving_position_product_id_index" on "receiving_position" ("product_id");`);
    this.addSql(`alter table "receiving_position" add constraint "receiving_position_order_id_pos_no_unique" unique ("order_id", "pos_no");`);

    this.addSql(`alter table "receiving_order" add constraint "receiving_order_state_check" check ("state" in ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED'));`);

    this.addSql(`alter table "receiving_capture" add constraint "receiving_capture_order_id_foreign" foreign key ("order_id") references "receiving_order" ("id") on delete cascade;`);
    this.addSql(`alter table "receiving_capture" add constraint "receiving_capture_kind_check" check ("kind" in ('QUANTITY', 'UNIT', 'BLIND'));`);

    this.addSql(`alter table "receiving_position" add constraint "receiving_position_order_id_foreign" foreign key ("order_id") references "receiving_order" ("id") on delete cascade;`);
    this.addSql(`alter table "receiving_position" add constraint "receiving_position_product_id_foreign" foreign key ("product_id") references "product" ("id") on delete restrict;`);
    this.addSql(`alter table "receiving_position" add constraint "receiving_position_kind_check" check ("kind" in ('QUANTITY', 'UNIT'));`);
    this.addSql(`alter table "receiving_position" add constraint "receiving_position_state_check" check ("state" in ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'SHORT', 'CANCELLED'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "receiving_capture" drop constraint "receiving_capture_order_id_foreign";`);
    this.addSql(`alter table "receiving_position" drop constraint "receiving_position_order_id_foreign";`);

    this.addSql(`drop table if exists "receiving_order" cascade;`);
    this.addSql(`drop table if exists "receiving_capture" cascade;`);
    this.addSql(`drop table if exists "receiving_position" cascade;`);
  }

}
