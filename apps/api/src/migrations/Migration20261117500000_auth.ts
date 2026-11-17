import { Migration } from '@mikro-orm/migrations';

/** Anmeldung: Benutzer und Sitzungen */
export class Migration20261117500000_auth extends Migration {

  override name = 'Migration20261117500000_auth';

  override up(): void | Promise<void> {
    this.addSql(`create table "app_user" ("id" uuid not null, "username" varchar(60) not null, "display_name" varchar(120) not null default '', "password_hash" varchar(255) not null, "roles" jsonb not null, "active" boolean not null default true, "last_login_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "app_user" add constraint "app_user_username_unique" unique ("username");`);

    this.addSql(`create table "app_session" ("id" varchar(64) not null, "user_id" uuid not null, "created_at" timestamptz not null, "expires_at" timestamptz not null, "last_seen_at" timestamptz not null, "user_agent" varchar(255) null, primary key ("id"));`);
    this.addSql(`create index "app_session_user_id_index" on "app_session" ("user_id");`);
    this.addSql(`create index "app_session_expires_at_index" on "app_session" ("expires_at");`);

    this.addSql(`alter table "app_session" add constraint "app_session_user_id_foreign" foreign key ("user_id") references "app_user" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "app_session" drop constraint "app_session_user_id_foreign";`);

    this.addSql(`drop table if exists "app_user" cascade;`);
    this.addSql(`drop table if exists "app_session" cascade;`);
  }

}
