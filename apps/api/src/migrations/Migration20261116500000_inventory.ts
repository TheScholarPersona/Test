import { Migration } from '@mikro-orm/migrations';

/** Bestand: Produkte, Bestandsposten je TU, Buchungsjournal. */
export class Migration20261116500000_inventory extends Migration {

  override name = 'Migration20261116500000_inventory';

  override up(): void | Promise<void> {
    this.addSql(`create table "product" ("id" uuid not null, "sku" varchar(64) not null, "description" varchar(255) not null default '', "base_unit" varchar(10) not null, "overdelivery_allowed" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "product" add constraint "product_sku_unique" unique ("sku");`);

    this.addSql(`create table "stock_booking" ("id" uuid not null, "type" text not null, "sku" varchar(64) not null, "barcode" varchar(64) not null, "quantity" numeric(15,3) not null, "unit_code" varchar(10) not null, "lot" varchar(64) null, "best_before" date null, "reference" varchar(120) not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "stock_booking_sku_index" on "stock_booking" ("sku");`);
    this.addSql(`create index "stock_booking_barcode_index" on "stock_booking" ("barcode");`);
    this.addSql(`create index "stock_booking_reference_index" on "stock_booking" ("reference");`);

    this.addSql(`create table "stock_item" ("id" uuid not null, "product_id" uuid not null, "unit_id" uuid not null, "quantity" numeric(15,3) not null, "unit_code" varchar(10) not null, "lot" varchar(64) null, "best_before" date null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`create index "stock_item_product_id_index" on "stock_item" ("product_id");`);
    this.addSql(`create index "stock_item_unit_id_index" on "stock_item" ("unit_id");`);

    this.addSql(`alter table "stock_booking" add constraint "stock_booking_type_check" check ("type" in ('RECEIPT', 'CORRECTION'));`);

    this.addSql(`alter table "stock_item" add constraint "stock_item_product_id_foreign" foreign key ("product_id") references "product" ("id") on delete restrict;`);
    this.addSql(`alter table "stock_item" add constraint "stock_item_unit_id_foreign" foreign key ("unit_id") references "transport_unit" ("id") on delete restrict;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "stock_item" drop constraint "stock_item_product_id_foreign";`);

    this.addSql(`drop table if exists "product" cascade;`);
    this.addSql(`drop table if exists "stock_booking" cascade;`);
    this.addSql(`drop table if exists "stock_item" cascade;`);
  }

}
