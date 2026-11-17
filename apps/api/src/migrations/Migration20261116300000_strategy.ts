import { Migration } from '@mikro-orm/migrations';

/** Strategie-Kern: versionierte Regelsätze und gespeicherte Entscheidungen. */
export class Migration20261116300000_strategy extends Migration {

  override name = 'Migration20261116300000_strategy';

  override up(): void | Promise<void> {
    this.addSql(`create table "strategy_decision" ("id" uuid not null, "decision_point" varchar(40) not null, "subject" varchar(100) not null, "rule_set_id" uuid not null, "rule_set_version" int not null, "rule_name" varchar(80) not null, "strategy" varchar(80) not null, "params" jsonb not null, "facts" jsonb not null, "outcome" jsonb not null, "chosen_key" varchar(100) null, "chosen_label" varchar(100) null, "assigned" boolean not null default false, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "strategy_decision_subject_index" on "strategy_decision" ("subject");`);

    this.addSql(`create table "strategy_rule_set" ("id" uuid not null, "decision_point" varchar(40) not null, "rule_set_version" int not null, "status" text not null default 'DRAFT', "description" varchar(255) not null default '', "rules" jsonb not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "activated_at" timestamptz null, "archived_at" timestamptz null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "strategy_rule_set" add constraint "strategy_rule_set_decision_point_rule_set_version_unique" unique ("decision_point", "rule_set_version");`);
    this.addSql(`create unique index "strategy_rule_set_one_active" on "strategy_rule_set" ("decision_point") where "status" = 'ACTIVE';`);

    this.addSql(`alter table "strategy_rule_set" add constraint "strategy_rule_set_status_check" check ("status" in ('DRAFT', 'ACTIVE', 'ARCHIVED'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "strategy_decision" cascade;`);
    this.addSql(`drop table if exists "strategy_rule_set" cascade;`);
  }

}
