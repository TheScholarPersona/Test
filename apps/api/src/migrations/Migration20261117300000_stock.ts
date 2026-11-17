import { Migration } from '@mikro-orm/migrations';

/** Bestandsführung: alternative Einheiten, Reservierungen (nie mehr als Bestand), Inventur, neue Buchungsarten */
export class Migration20261117300000_stock extends Migration {

  override name = 'Migration20261117300000_stock';

  override up(): void | Promise<void> {
    this.addSql(`create sequence if not exists "stock_count_number_seq" start with 1;`);
    this.addSql(`create table "product_unit" ("id" uuid not null, "product_id" uuid not null, "unit_code" varchar(10) not null, "factor" numeric(15,6) not null, primary key ("id"));`);
    this.addSql(`create index "product_unit_product_id_index" on "product_unit" ("product_id");`);
    this.addSql(`alter table "product_unit" add constraint "product_unit_unique" unique ("product_id", "unit_code");`);

    this.addSql(`create table "stock_reservation" ("id" uuid not null, "item_id" uuid not null, "quantity" numeric(15,3) not null, "unit_code" varchar(10) not null, "reference" varchar(120) not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "stock_reservation_item_id_index" on "stock_reservation" ("item_id");`);
    this.addSql(`create index "stock_reservation_reference_index" on "stock_reservation" ("reference");`);

    this.addSql(`create table "stock_count" ("id" uuid not null, "number" varchar(20) not null, "barcode" varchar(64) not null, "unit_id" uuid null, "state" text not null default 'OPEN', "reference" varchar(120) null, "counted_by" varchar(100) null, "counted_at" timestamptz null, "closed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "stock_count" add constraint "stock_count_number_unique" unique ("number");`);
    this.addSql(`create index "stock_count_barcode_index" on "stock_count" ("barcode");`);
    this.addSql(`create index "stock_count_unit_id_index" on "stock_count" ("unit_id");`);
    this.addSql(`create unique index "stock_count_one_open_per_unit" on "stock_count" ("unit_id") where "state" in ('OPEN', 'COUNTED');`);

    this.addSql(`create table "stock_count_line" ("id" uuid not null, "count_id" uuid not null, "sku" varchar(64) not null, "lot" varchar(64) null, "best_before" date null, "unit_code" varchar(10) not null, "expected" numeric(15,3) not null, "counted" numeric(15,3) null, primary key ("id"));`);
    this.addSql(`create index "stock_count_line_count_id_index" on "stock_count_line" ("count_id");`);

    this.addSql(`alter table "stock_booking" drop constraint "stock_booking_type_check";`);
    this.addSql(`alter table "stock_booking" add constraint "stock_booking_type_check" check ("type" in ('RECEIPT', 'CORRECTION', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN'));`);

    this.addSql(`alter table "stock_item" add "reserved" numeric(15,3) not null default '0';`);
    this.addSql(`alter table "stock_item" add constraint "stock_item_reserved_check" check (reserved >= 0 and reserved <= quantity);`);

    this.addSql(`alter table "product_unit" add constraint "product_unit_product_id_foreign" foreign key ("product_id") references "product" ("id") on delete cascade;`);

    this.addSql(`alter table "stock_reservation" add constraint "stock_reservation_item_id_foreign" foreign key ("item_id") references "stock_item" ("id") on delete restrict;`);

    this.addSql(`alter table "stock_count" add constraint "stock_count_unit_id_foreign" foreign key ("unit_id") references "transport_unit" ("id") on delete set null;`);
    this.addSql(`alter table "stock_count" add constraint "stock_count_state_check" check ("state" in ('OPEN', 'COUNTED', 'CLOSED', 'CANCELLED'));`);

    this.addSql(`alter table "stock_count_line" add constraint "stock_count_line_count_id_foreign" foreign key ("count_id") references "stock_count" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "stock_count_line" drop constraint "stock_count_line_count_id_foreign";`);

    this.addSql(`drop table if exists "product_unit" cascade;`);
    this.addSql(`drop table if exists "stock_reservation" cascade;`);
    this.addSql(`drop table if exists "stock_count" cascade;`);
    this.addSql(`drop table if exists "stock_count_line" cascade;`);
    this.addSql(`drop sequence if exists "stock_count_number_seq";`);

    this.addSql(`alter table "stock_booking" drop constraint "stock_booking_type_check";`);
    this.addSql(`alter table "stock_booking" add constraint "stock_booking_type_check" check ("type" in ('RECEIPT', 'CORRECTION'));`);

    this.addSql(`alter table "stock_item" drop constraint "stock_item_reserved_check";`);
    this.addSql(`alter table "stock_item" drop column "reserved";`);
  }

}
