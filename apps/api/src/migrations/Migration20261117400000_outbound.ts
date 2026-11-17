import { Migration } from '@mikro-orm/migrations';

/** Auslagerung: Aufträge, Positionen, Picks */
export class Migration20261117400000_outbound extends Migration {

  override name = 'Migration20261117400000_outbound';

  override up(): void | Promise<void> {
    this.addSql(`create table "outbound_order" ("id" uuid not null, "order_id" varchar(40) not null, "customer" varchar(100) null, "priority" text not null default 'NORMAL', "target_id" uuid null, "target_coordinate" varchar(54) null, "state" text not null default 'CREATED', "close_reason" varchar(200) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "outbound_order" add constraint "outbound_order_order_id_unique" unique ("order_id");`);
    this.addSql(`create index "outbound_order_target_id_index" on "outbound_order" ("target_id");`);

    this.addSql(`create table "outbound_line" ("id" uuid not null, "order_id" uuid not null, "line_no" int not null, "product_id" uuid not null, "quantity" numeric(15,3) not null, "unit_code" varchar(10) not null, "lot" varchar(64) null, "allocated" numeric(15,3) not null default '0', "picked" numeric(15,3) not null default '0', "state" text not null default 'OPEN', primary key ("id"));`);
    this.addSql(`create index "outbound_line_order_id_index" on "outbound_line" ("order_id");`);
    this.addSql(`create index "outbound_line_product_id_index" on "outbound_line" ("product_id");`);
    this.addSql(`alter table "outbound_line" add constraint "outbound_line_no_unique" unique ("order_id", "line_no");`);

    this.addSql(`create table "outbound_pick" ("id" uuid not null, "line_id" uuid not null, "stock_item_id" uuid not null, "reservation_id" uuid null, "barcode" varchar(64) not null, "location_coordinate" varchar(54) not null, "quantity" numeric(15,3) not null, "picked" numeric(15,3) not null default '0', "state" text not null default 'OPEN', "decision_id" uuid null, "movement_number" varchar(20) null, "transport_order_number" varchar(20) null, "transport_note" varchar(200) null, "picked_by" varchar(100) null, "picked_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "outbound_pick_line_id_index" on "outbound_pick" ("line_id");`);
    this.addSql(`create index "outbound_pick_stock_item_id_index" on "outbound_pick" ("stock_item_id");`);
    this.addSql(`create index "outbound_pick_barcode_index" on "outbound_pick" ("barcode");`);

    this.addSql(`alter table "outbound_order" add constraint "outbound_order_target_id_foreign" foreign key ("target_id") references "location" ("id") on delete set null;`);
    this.addSql(`alter table "outbound_order" add constraint "outbound_order_priority_check" check ("priority" in ('HIGHEST', 'HIGH', 'NORMAL', 'LOW', 'LOWEST'));`);
    this.addSql(`alter table "outbound_order" add constraint "outbound_order_state_check" check ("state" in ('CREATED', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'IN_PICKING', 'COMPLETED', 'CANCELLED'));`);

    this.addSql(`alter table "outbound_line" add constraint "outbound_line_order_id_foreign" foreign key ("order_id") references "outbound_order" ("id") on delete cascade;`);
    this.addSql(`alter table "outbound_line" add constraint "outbound_line_product_id_foreign" foreign key ("product_id") references "product" ("id") on delete restrict;`);
    this.addSql(`alter table "outbound_line" add constraint "outbound_line_state_check" check ("state" in ('OPEN', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'PICKED', 'SHORT', 'CANCELLED'));`);

    this.addSql(`alter table "outbound_pick" add constraint "outbound_pick_line_id_foreign" foreign key ("line_id") references "outbound_line" ("id") on delete cascade;`);
    this.addSql(`alter table "outbound_pick" add constraint "outbound_pick_state_check" check ("state" in ('OPEN', 'PICKED', 'SHORT', 'CANCELLED'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "outbound_line" drop constraint "outbound_line_order_id_foreign";`);
    this.addSql(`alter table "outbound_pick" drop constraint "outbound_pick_line_id_foreign";`);

    this.addSql(`drop table if exists "outbound_order" cascade;`);
    this.addSql(`drop table if exists "outbound_line" cascade;`);
    this.addSql(`drop table if exists "outbound_pick" cascade;`);
  }

}
