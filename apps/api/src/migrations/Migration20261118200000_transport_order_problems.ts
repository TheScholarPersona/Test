import { Migration } from '@mikro-orm/migrations';

/** Transportauftrag: Problemhistorie */
export class Migration20261118200000_transport_order_problems extends Migration {

  override name = 'Migration20261118200000_transport_order_problems';

  override up(): void | Promise<void> {
    this.addSql(`alter table "transport_order" add "problems" jsonb not null default '[]';`);
    this.addSql(`update "transport_order" set "problems" = jsonb_build_array(jsonb_build_object('code', "problem_code", 'message', coalesce("problem_message", ''), 'at', to_char("problem_at" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where "problem_code" is not null and "problem_at" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "transport_order" drop column "problems";`);
  }

}
