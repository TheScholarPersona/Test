import { Migration } from '@mikro-orm/migrations';

/** Avis: Priorität, Detailattribute und Sperre */
export class Migration20261118000000_receiving_priority_lock extends Migration {

  override name = 'Migration20261118000000_receiving_priority_lock';

  override up(): void | Promise<void> {
    this.addSql(`alter table "receiving_order" add "priority" text not null default 'NORMAL', add "priority_rank" int not null default 3, add "details" jsonb null, add "locked" boolean not null default false, add "lock_reason" varchar(200) null;`);
    this.addSql(`alter table "receiving_order" add constraint "receiving_order_priority_check" check ("priority" in ('HIGHEST', 'HIGH', 'NORMAL', 'LOW', 'LOWEST'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "receiving_order" drop constraint "receiving_order_priority_check";`);
    this.addSql(`alter table "receiving_order" drop column "priority", drop column "priority_rank", drop column "details", drop column "locked", drop column "lock_reason";`);
  }

}
