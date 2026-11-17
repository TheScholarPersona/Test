import { Migration } from '@mikro-orm/migrations';

/** Bewegungsgruppen */
export class Migration20261117700000_movement_groups extends Migration {

  override name = 'Migration20261117700000_movement_groups';

  override up(): void | Promise<void> {
    this.addSql(`create sequence if not exists "movement_group_number_seq" start with 1;`);
    this.addSql(`create table "movement_group" ("id" uuid not null, "number" varchar(20) not null, "description" varchar(200) null, "assigned_to" varchar(100) null, "created_by" varchar(100) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "movement_group" add constraint "movement_group_number_unique" unique ("number");`);
    this.addSql(`create index "movement_group_assigned_to_index" on "movement_group" ("assigned_to");`);
    this.addSql(`create index "movement_group_created_at_index" on "movement_group" ("created_at");`);

    this.addSql(`alter table "movement" add "group_id" uuid null;`);
    this.addSql(`alter table "movement" add constraint "movement_group_id_foreign" foreign key ("group_id") references "movement_group" ("id") on delete set null;`);
    this.addSql(`create index "movement_group_id_index" on "movement" ("group_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "movement" drop constraint "movement_group_id_foreign";`);

    this.addSql(`drop table if exists "movement_group" cascade;`);

    this.addSql(`drop index "movement_group_id_index";`);
    this.addSql(`alter table "movement" drop column "group_id";`);
    this.addSql(`drop sequence if exists "movement_group_number_seq";`);
  }

}
