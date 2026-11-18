import { Migration } from '@mikro-orm/migrations';

/** Versand: Sendungen mit Ladekontrolle, Packen am Packplatz, Buchungsart SHIP */
export class Migration20261117900000_shipping extends Migration {

  override name = 'Migration20261117900000_shipping';

  override up(): void | Promise<void> {
    this.addSql(`create sequence if not exists "shipment_number_seq" start with 1;`);
    this.addSql(`create table "shipment" ("id" uuid not null, "number" varchar(20) not null, "order_id" varchar(40) not null, "customer_code" varchar(40) null, "ship_to_name" varchar(100) null, "ship_to_street" varchar(100) null, "ship_to_postal_code" varchar(20) null, "ship_to_city" varchar(100) null, "ship_to_country" varchar(2) null, "carrier_code" varchar(40) null, "state" text not null default 'OPEN', "cancel_reason" varchar(200) null, "created_by" varchar(100) null, "loaded_at" timestamptz null, "shipped_at" timestamptz null, "shipped_by" varchar(100) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "shipment" add constraint "shipment_number_unique" unique ("number");`);
    this.addSql(`create index "shipment_order_id_index" on "shipment" ("order_id");`);
    this.addSql(`create index "shipment_state_index" on "shipment" ("state");`);
    this.addSql(`create index "shipment_created_at_index" on "shipment" ("created_at");`);

    this.addSql(`create table "shipment_unit" ("id" uuid not null, "shipment_id" uuid not null, "barcode" varchar(64) not null, "loaded" boolean not null default false, "loaded_at" timestamptz null, "loaded_by" varchar(100) null, "contents" jsonb null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "shipment_unit_shipment_id_index" on "shipment_unit" ("shipment_id");`);
    this.addSql(`create index "shipment_unit_barcode_index" on "shipment_unit" ("barcode");`);

    this.addSql(`alter table "outbound_pick" add "packed_into" varchar(64) null;`);
    this.addSql(`create index "outbound_pick_packed_into_index" on "outbound_pick" ("packed_into");`);

    this.addSql(`alter table "stock_booking" drop constraint "stock_booking_type_check";`);
    this.addSql(`alter table "stock_booking" add constraint "stock_booking_type_check" check ("type" in ('RECEIPT', 'CORRECTION', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'SHIP'));`);

    this.addSql(`alter table "shipment" add constraint "shipment_state_check" check ("state" in ('OPEN', 'LOADED', 'SHIPPED', 'CANCELLED'));`);

    this.addSql(`alter table "shipment_unit" add constraint "shipment_unit_shipment_id_foreign" foreign key ("shipment_id") references "shipment" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "shipment_unit" drop constraint "shipment_unit_shipment_id_foreign";`);

    this.addSql(`drop table if exists "shipment" cascade;`);
    this.addSql(`drop table if exists "shipment_unit" cascade;`);
    this.addSql(`drop sequence if exists "shipment_number_seq";`);

    this.addSql(`drop index "outbound_pick_packed_into_index";`);
    this.addSql(`alter table "outbound_pick" drop column "packed_into";`);

    this.addSql(`alter table "stock_booking" drop constraint "stock_booking_type_check";`);
    this.addSql(`alter table "stock_booking" add constraint "stock_booking_type_check" check ("type" in ('RECEIPT', 'CORRECTION', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN'));`);
  }

}
