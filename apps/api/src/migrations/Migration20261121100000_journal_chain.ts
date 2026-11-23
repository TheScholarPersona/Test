import { Migration } from '@mikro-orm/migrations';

/**
 * Buchungsjournal als Hash-Kette: Jede Buchung erhält beim Commit eine lückenlose Nummer (`seq`), den Hash der
 * Vorgängerbuchung (`prev_hash`) und ihren eigenen Hash (`hash` = SHA-256 aus `prev_hash` und kanonischem Inhalt).
 * Die Verkettung läuft als verzögerter Trigger am Ende der Transaktion – die Sperre auf `journal_head` ist damit immer
 * die letzte, die eine Transaktion nimmt (keine neue Sperrreihenfolge). Verkettete Buchungen sind unveränderlich.
 *
 * Das kanonische Format (Version v1) muss mit `journal-chain.ts` übereinstimmen.
 */
export class Migration20261121100000_journal_chain extends Migration {

  override name = 'Migration20261121100000_journal_chain';

  override up(): void | Promise<void> {
    this.addSql(`alter table "stock_booking" add "seq" bigint null, add "prev_hash" varchar(64) null, add "hash" varchar(64) null;`);
    this.addSql(`alter table "stock_booking" add constraint "stock_booking_seq_unique" unique ("seq");`);
    this.addSql(`create table "journal_head" ("id" int not null primary key check ("id" = 1), "seq" bigint not null, "hash" varchar(64) not null, "updated_at" timestamptz not null default now());`);
    this.addSql(`insert into "journal_head" ("id", "seq", "hash") values (1, 0, repeat('0', 64));`);

    this.addSql(`create function wms_journal_field(t text) returns text language sql immutable as $$
      select case when t is null then '-' else length(t)::text || ':' || t end $$;`);
    this.addSql(`create function wms_journal_canonical(b stock_booking, s bigint) returns text language sql stable as $$
      select 'v1' || '|' || wms_journal_field(s::text) || '|' || wms_journal_field(b.id::text) || '|' || wms_journal_field(b.type)
        || '|' || wms_journal_field(b.sku) || '|' || wms_journal_field(b.barcode) || '|' || wms_journal_field(b.quantity::text)
        || '|' || wms_journal_field(b.unit_code) || '|' || wms_journal_field(b.lot) || '|' || wms_journal_field(to_char(b.best_before, 'YYYY-MM-DD'))
        || '|' || wms_journal_field(b.reference)
        || '|' || wms_journal_field(to_char(b.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $$;`);
    this.addSql(`create function wms_journal_append(b stock_booking) returns void language plpgsql as $$
      declare head record; next_hash text;
      begin
        select "seq", "hash" into head from "journal_head" where "id" = 1 for update;
        next_hash := encode(sha256(convert_to(head.hash || wms_journal_canonical(b, head.seq + 1), 'UTF8')), 'hex');
        update "stock_booking" set "seq" = head.seq + 1, "prev_hash" = head.hash, "hash" = next_hash where "id" = b.id;
        update "journal_head" set "seq" = head.seq + 1, "hash" = next_hash, "updated_at" = now() where "id" = 1;
      end $$;`);
    this.addSql(`create function wms_journal_chain() returns trigger language plpgsql as $$
      begin perform wms_journal_append(new); return null; end $$;`);
    this.addSql(`create function wms_journal_guard() returns trigger language plpgsql as $$
      begin
        if tg_op = 'DELETE' or old.hash is not null then
          raise exception 'JOURNAL_IMMUTABLE: Buchung % ist verkettet und unveränderlich', old.id;
        end if;
        return new;
      end $$;`);

    // Bestehende Buchungen einmalig verketten (Reihenfolge: Zeitpunkt, dann Kennung).
    this.addSql(`do $$ declare r stock_booking; begin
      for r in select * from "stock_booking" order by "created_at", "id" loop perform wms_journal_append(r); end loop;
    end $$;`);

    this.addSql(`create constraint trigger "stock_booking_chain" after insert on "stock_booking" deferrable initially deferred for each row execute function wms_journal_chain();`);
    this.addSql(`create trigger "stock_booking_guard" before update or delete on "stock_booking" for each row execute function wms_journal_guard();`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop trigger "stock_booking_guard" on "stock_booking";`);
    this.addSql(`drop trigger "stock_booking_chain" on "stock_booking";`);
    this.addSql(`drop function wms_journal_guard(); drop function wms_journal_chain(); drop function wms_journal_append(stock_booking);`);
    this.addSql(`drop function wms_journal_canonical(stock_booking, bigint); drop function wms_journal_field(text);`);
    this.addSql(`drop table "journal_head";`);
    this.addSql(`alter table "stock_booking" drop constraint "stock_booking_seq_unique";`);
    this.addSql(`alter table "stock_booking" drop column "seq", drop column "prev_hash", drop column "hash";`);
  }

}
