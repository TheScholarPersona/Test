import { Migration } from '@mikro-orm/migrations';

/**
 * Verkettetes Änderungsprotokoll für Transporteinheiten und Bestandsposten: Jedes Anlegen, Ändern und Löschen –
 * auch per direktem SQL – erzeugt einen Eintrag mit dem Hash des neuen Zeilenzustands (`row_hash` über
 * `to_jsonb(zeile)::text`) und der Herkunft (`source` aus der Sitzungsvariable `wms.source`, die nur die
 * Verbindungen der API setzen – leer heißt: an der Anwendung vorbei). Die Einträge werden beim Commit verkettet wie das Buchungsjournal. Beide Ketten nehmen
 * zuerst die Sperre auf `journal_head` (id 1), das Protokoll danach seinen Kopf (id 2) – feste Reihenfolge, keine
 * Verklemmung. Bestehende Zeilen erhalten einen Eintrag `SNAPSHOT`.
 *
 * Das kanonische Format (v1) muss mit `change-log.ts` übereinstimmen.
 */
export class Migration20261124100000_change_log extends Migration {

  override name = 'Migration20261124100000_change_log';

  override up(): void | Promise<void> {
    this.addSql(`alter table "journal_head" drop constraint "journal_head_id_check";`);
    this.addSql(`alter table "journal_head" add constraint "journal_head_id_check" check ("id" in (1, 2));`);
    this.addSql(`insert into "journal_head" ("id", "seq", "hash") values (2, 0, repeat('0', 64));`);
    this.addSql(`create table "change_log" (
      "id" bigserial primary key, "table_name" varchar(40) not null, "row_id" uuid not null,
      "op" varchar(10) not null check ("op" in ('INSERT', 'UPDATE', 'DELETE', 'SNAPSHOT')), "source" varchar(40) null,
      "row_hash" varchar(64) null, "at" timestamptz not null default clock_timestamp(),
      "seq" bigint null unique, "prev_hash" varchar(64) null, "hash" varchar(64) null);`);
    this.addSql(`create index "change_log_row_idx" on "change_log" ("table_name", "row_id", "seq");`);

    this.addSql(`create function wms_row_hash(j jsonb) returns varchar language sql immutable as $$
      select encode(sha256(convert_to(j::text, 'UTF8')), 'hex') $$;`);
    this.addSql(`create function wms_change_canonical(c change_log, s bigint) returns text language sql stable as $$
      select 'v1' || '|' || wms_journal_field(s::text) || '|' || wms_journal_field(c.table_name) || '|' || wms_journal_field(c.row_id::text)
        || '|' || wms_journal_field(c.op) || '|' || wms_journal_field(c.source) || '|' || wms_journal_field(c.row_hash)
        || '|' || wms_journal_field(to_char(c.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $$;`);
    this.addSql(`create function wms_change_append(c change_log) returns void language plpgsql as $$
      declare head record; next_hash text;
      begin
        perform 1 from "journal_head" where "id" = 1 for update;
        select "seq", "hash" into head from "journal_head" where "id" = 2 for update;
        next_hash := encode(sha256(convert_to(head.hash || wms_change_canonical(c, head.seq + 1), 'UTF8')), 'hex');
        update "change_log" set "seq" = head.seq + 1, "prev_hash" = head.hash, "hash" = next_hash where "id" = c.id;
        update "journal_head" set "seq" = head.seq + 1, "hash" = next_hash, "updated_at" = now() where "id" = 2;
      end $$;`);
    this.addSql(`create function wms_change_chain() returns trigger language plpgsql as $$
      begin perform wms_change_append(new); return null; end $$;`);
    this.addSql(`create function wms_change_record() returns trigger language plpgsql as $$
      begin
        if tg_op = 'DELETE' then
          insert into "change_log" ("table_name", "row_id", "op", "source", "row_hash")
            values (tg_table_name, old.id, 'DELETE', nullif(current_setting('wms.source', true), ''), null);
        else
          insert into "change_log" ("table_name", "row_id", "op", "source", "row_hash")
            values (tg_table_name, new.id, tg_op, nullif(current_setting('wms.source', true), ''), wms_row_hash(to_jsonb(new)));
        end if;
        return null;
      end $$;`);
    this.addSql(`create function wms_change_guard() returns trigger language plpgsql as $$
      begin
        if tg_op = 'DELETE' or old.hash is not null then
          raise exception 'CHANGE_LOG_IMMUTABLE: Eintrag % ist verkettet und unveränderlich', old.id;
        end if;
        return new;
      end $$;`);

    // Bestehende Zeilen als Ausgangsstand erfassen und verketten.
    this.addSql(`insert into "change_log" ("table_name", "row_id", "op", "source", "row_hash")
      select 'transport_unit', t.id, 'SNAPSHOT', 'migration', wms_row_hash(to_jsonb(t)) from "transport_unit" t
      union all select 'stock_item', s.id, 'SNAPSHOT', 'migration', wms_row_hash(to_jsonb(s)) from "stock_item" s;`);
    this.addSql(`do $$ declare r change_log; begin
      for r in select * from "change_log" order by "id" loop perform wms_change_append(r); end loop;
    end $$;`);

    this.addSql(`create constraint trigger "change_log_chain" after insert on "change_log" deferrable initially deferred for each row execute function wms_change_chain();`);
    this.addSql(`create trigger "change_log_guard" before update or delete on "change_log" for each row execute function wms_change_guard();`);
    for (const table of ['transport_unit', 'stock_item']) {
      this.addSql(`create trigger "${table}_change_log" after insert or update or delete on "${table}" for each row execute function wms_change_record();`);
    }
  }

  override down(): void | Promise<void> {
    for (const table of ['transport_unit', 'stock_item']) this.addSql(`drop trigger "${table}_change_log" on "${table}";`);
    this.addSql(`drop trigger "change_log_guard" on "change_log"; drop trigger "change_log_chain" on "change_log";`);
    this.addSql(`drop function wms_change_guard(); drop function wms_change_record(); drop function wms_change_chain();`);
    this.addSql(`drop function wms_change_append(change_log); drop function wms_change_canonical(change_log, bigint); drop function wms_row_hash(jsonb);`);
    this.addSql(`drop table "change_log";`);
    this.addSql(`delete from "journal_head" where "id" = 2;`);
    this.addSql(`alter table "journal_head" drop constraint "journal_head_id_check";`);
    this.addSql(`alter table "journal_head" add constraint "journal_head_id_check" check ("id" = 1);`);
  }

}
