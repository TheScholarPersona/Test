import { Migration } from '@mikro-orm/migrations';

/** Geschäftspartner; Kunde am Auslagerauftrag mit Lieferadresse, Lieferant am Avis */
export class Migration20261117800000_partners extends Migration {

  override name = 'Migration20261117800000_partners';

  override up(): void | Promise<void> {
    this.addSql(`create table "partner" ("id" uuid not null, "code" varchar(40) not null, "name" varchar(100) not null, "customer" boolean not null default false, "supplier" boolean not null default false, "carrier" boolean not null default false, "street" varchar(100) null, "postal_code" varchar(20) null, "city" varchar(100) null, "country" varchar(2) null, "email" varchar(200) null, "phone" varchar(50) null, "active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "partner" add constraint "partner_code_unique" unique ("code");`);

    this.addSql(`alter table "outbound_order" add "customer_code" varchar(40) null, add "ship_to_name" varchar(100) null, add "ship_to_street" varchar(100) null, add "ship_to_postal_code" varchar(20) null, add "ship_to_city" varchar(100) null, add "ship_to_country" varchar(2) null;`);
    this.addSql(`create index "outbound_order_customer_code_index" on "outbound_order" ("customer_code");`);

    this.addSql(`alter table "receiving_order" add "supplier_code" varchar(40) null;`);
    this.addSql(`create index "receiving_order_supplier_code_index" on "receiving_order" ("supplier_code");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "partner" cascade;`);

    this.addSql(`drop index "outbound_order_customer_code_index";`);
    this.addSql(`alter table "outbound_order" drop column "customer_code", drop column "ship_to_name", drop column "ship_to_street", drop column "ship_to_postal_code", drop column "ship_to_city", drop column "ship_to_country";`);

    this.addSql(`drop index "receiving_order_supplier_code_index";`);
    this.addSql(`alter table "receiving_order" drop column "supplier_code";`);
  }

}
