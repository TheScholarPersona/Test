import { Migration } from '@mikro-orm/migrations';

/** Materialfluss: Routen mit Schritten, Action-Matrix, Entscheidungsprotokoll */
export class Migration20261117200000_flow extends Migration {

  override name = 'Migration20261117200000_flow';

  override up(): void | Promise<void> {
    this.addSql(`create table "flow_decision" ("id" uuid not null, "event_type" text not null, "barcode" varchar(64) null, "device_id" varchar(64) null, "location_coordinate" varchar(54) not null, "order_number" varchar(20) null, "route_id" varchar(40) null, "action_name" varchar(60) null, "program" varchar(40) null, "outcome" text not null, "next_coordinate" varchar(54) null, "trace" jsonb not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "flow_decision_barcode_index" on "flow_decision" ("barcode");`);
    this.addSql(`create index "flow_decision_created_at_index" on "flow_decision" ("created_at");`);

    this.addSql(`create table "flow_route" ("id" uuid not null, "route_id" varchar(40) not null, "description" varchar(255) not null default '', "source_location_id" uuid null, "source_group" varchar(40) null, "target_location_id" uuid null, "target_group" varchar(40) null, "enabled" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "flow_route" add constraint "flow_route_route_id_unique" unique ("route_id");`);
    this.addSql(`create index "flow_route_source_location_id_index" on "flow_route" ("source_location_id");`);
    this.addSql(`create index "flow_route_source_group_index" on "flow_route" ("source_group");`);
    this.addSql(`create index "flow_route_target_location_id_index" on "flow_route" ("target_location_id");`);
    this.addSql(`create index "flow_route_target_group_index" on "flow_route" ("target_group");`);

    this.addSql(`create table "flow_route_step" ("id" uuid not null, "route_id" uuid not null, "pos" int not null, "from_id" uuid not null, "next_id" uuid not null, "unit_type" varchar(20) null, "enabled" boolean not null default true, primary key ("id"));`);
    this.addSql(`create index "flow_route_step_route_id_index" on "flow_route_step" ("route_id");`);
    this.addSql(`create index "flow_route_step_from_id_index" on "flow_route_step" ("from_id");`);
    this.addSql(`create index "flow_route_step_next_id_index" on "flow_route_step" ("next_id");`);
    this.addSql(`alter table "flow_route_step" add constraint "flow_route_step_pos_unique" unique ("route_id", "pos");`);

    this.addSql(`create table "flow_action" ("id" uuid not null, "name" varchar(60) not null, "description" varchar(255) not null default '', "event_type" text not null, "route_id" uuid null, "location_id" uuid null, "group" varchar(40) null, "program" varchar(40) not null, "params" jsonb not null, "enabled" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`alter table "flow_action" add constraint "flow_action_name_unique" unique ("name");`);
    this.addSql(`create index "flow_action_event_type_index" on "flow_action" ("event_type");`);
    this.addSql(`create index "flow_action_route_id_index" on "flow_action" ("route_id");`);
    this.addSql(`create index "flow_action_location_id_index" on "flow_action" ("location_id");`);

    this.addSql(`alter table "flow_decision" add constraint "flow_decision_event_type_check" check ("event_type" in ('request', 'arrived', 'location-status', 'error'));`);
    this.addSql(`alter table "flow_decision" add constraint "flow_decision_outcome_check" check ("outcome" in ('COMMAND', 'FINISHED', 'HANDLED', 'DELEGATED', 'NO_ACTION', 'NO_NEXT_STEP', 'FAILED'));`);

    this.addSql(`alter table "flow_route" add constraint "flow_route_source_location_id_foreign" foreign key ("source_location_id") references "location" ("id") on delete restrict;`);
    this.addSql(`alter table "flow_route" add constraint "flow_route_target_location_id_foreign" foreign key ("target_location_id") references "location" ("id") on delete restrict;`);

    this.addSql(`alter table "flow_route_step" add constraint "flow_route_step_route_id_foreign" foreign key ("route_id") references "flow_route" ("id") on delete cascade;`);
    this.addSql(`alter table "flow_route_step" add constraint "flow_route_step_from_id_foreign" foreign key ("from_id") references "location" ("id") on delete restrict;`);
    this.addSql(`alter table "flow_route_step" add constraint "flow_route_step_next_id_foreign" foreign key ("next_id") references "location" ("id") on delete restrict;`);

    this.addSql(`alter table "flow_action" add constraint "flow_action_route_id_foreign" foreign key ("route_id") references "flow_route" ("id") on delete restrict;`);
    this.addSql(`alter table "flow_action" add constraint "flow_action_location_id_foreign" foreign key ("location_id") references "location" ("id") on delete restrict;`);
    this.addSql(`alter table "flow_action" add constraint "flow_action_event_type_check" check ("event_type" in ('request', 'arrived', 'location-status', 'error'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "flow_route_step" drop constraint "flow_route_step_route_id_foreign";`);
    this.addSql(`alter table "flow_action" drop constraint "flow_action_route_id_foreign";`);

    this.addSql(`drop table if exists "flow_decision" cascade;`);
    this.addSql(`drop table if exists "flow_route" cascade;`);
    this.addSql(`drop table if exists "flow_route_step" cascade;`);
    this.addSql(`drop table if exists "flow_action" cascade;`);
  }

}
