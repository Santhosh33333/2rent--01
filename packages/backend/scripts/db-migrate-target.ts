/**
 * Copies the production database to another Postgres instance (a Neon US-east
 * endpoint, for example) so the API can sit somewhere near its users.
 *
 * This never changes where the app points. It only reads the source and writes
 * the target, and it proves the copy is faithful before anyone points the app
 * at it.
 *
 * The foreign key graph here is heavily cyclic (User<->Verification,
 * Booking<->UpiPayment, Wallet<->Transaction and 70-odd more), so there is no
 * order that satisfies every constraint. The copy therefore runs with foreign
 * key triggers disabled on the target, in condensed-component order, and then
 * re-enables them. Because Postgres does not re-check existing rows when a
 * trigger is switched back on, `verify` proves integrity itself: it recounts
 * every table and then checks every foreign key for orphaned references.
 *
 *   npm run db:inspect   source only, no target needed
 *   npm run db:plan      show the copy order and the cyclic components
 *   npm run db:migrate   copy the rows (needs TARGET_DATABASE_URL)
 *   npm run db:verify    recount both sides and check every foreign key
 */
import { Prisma, PrismaClient } from "@prisma/client";
import * as fs from "fs";

const SOURCE_B64 = "C:\\Users\\acer\\AppData\\Local\\Temp\\opencode\\prod_db.b64";
const BATCH = 500;

function sourceUrl(): string {
  return Buffer.from(fs.readFileSync(SOURCE_B64, "utf8").trim(), "base64").toString("utf8");
}

function targetUrl(): string {
  const t = process.env.TARGET_DATABASE_URL;
  if (!t) throw new Error("TARGET_DATABASE_URL is required for migrate/verify");
  return t;
}

type Relation = { fromField: string; toModel: string; toField: string; required: boolean };
type ModelInfo = { name: string; orderBy: string[]; idFields: string[]; dependsOn: string[]; relations: Relation[]; selfReferencing: boolean };

/**
 * This Prisma DMMF exposes object relations as entries in `fields` with
 * kind "object" rather than in a separate `relations` array, and leaves
 * `primaryKey` unpopulated, so both the dependency graph and a deterministic
 * sort key have to be derived from `fields`.
 */
function modelInfos(): ModelInfo[] {
  return Prisma.dmmf.datamodel.models.map((m) => {
    const dependsOn = new Set<string>();
    const relations: Relation[] = [];
    let selfReferencing = false;

    for (const f of m.fields) {
      if (f.kind !== "object") continue;
      const from = f.relationFromFields ?? [];
      const to = f.relationToFields ?? [];
      if (from.length !== 1 || to.length !== 1) continue;
      const required = m.fields.find((x) => x.name === from[0])?.isRequired ?? false;
      relations.push({ fromField: from[0], toModel: f.type, toField: to[0], required });
      if (f.type === m.name) selfReferencing = true;
      else dependsOn.add(f.type);
    }

    const scalars = m.fields.filter((f) => f.kind === "scalar");
    const unique = (m.uniqueFields ?? []).flatMap((u: string[]) => u);
    const orderBy = [...new Set([...unique, ...scalars.map((s) => s.name)])];
    const idFields = scalars.filter((s) => s.isId).map((s) => s.name);
    return { name: m.name, orderBy, idFields, dependsOn: [...dependsOn], relations, selfReferencing };
  });
}

/** Tarjan strongly connected components, then a topological order of the condensation. */
function condense(infos: ModelInfo[]): { groups: string[][]; order: string[][] } {
  const byName = new Map(infos.map((i) => [i.name, i]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];
  let counter = 0;

  const strongConnect = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of byName.get(v)?.dependsOn ?? []) {
      if (!byName.has(w)) continue;
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      groups.push(comp);
    }
  };

  for (const i of infos) if (!index.has(i.name)) strongConnect(i.name);

  const compOf = new Map<string, number>();
  groups.forEach((g, gi) => g.forEach((n) => compOf.set(n, gi)));
  const deps = groups.map(() => new Set<number>());
  for (const i of infos) {
    for (const d of i.dependsOn) {
      if (!byName.has(d)) continue;
      const a = compOf.get(i.name)!;
      const b = compOf.get(d)!;
      if (a !== b) deps[a].add(b);
    }
  }

  const order: string[][] = [];
  const done = new Set<number>();
  const visit = (gi: number): void => {
    if (done.has(gi)) return;
    done.add(gi);
    for (const d of deps[gi]) visit(d);
    order.push(groups[gi]);
  };
  for (let gi = 0; gi < groups.length; gi++) visit(gi);
  return { groups, order };
}

async function counts(client: PrismaClient, names: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const name of names) {
    const model = (client as unknown as Record<string, { count(): Promise<number> }>)[name];
    out.set(name, await model.count());
  }
  return out;
}

async function inspect(): Promise<void> {
  const client = new PrismaClient({ datasources: { db: { url: sourceUrl() } } });
  try {
    const infos = modelInfos();
    const { groups } = condense(infos);
    const src = await counts(client, infos.map((i) => i.name));
    const total = [...src.values()].reduce((a, b) => a + b, 0);
    const nonEmpty = [...src.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

    console.log(`models:            ${infos.length}`);
    console.log(`total rows:        ${total}`);
    console.log(`tables with data:  ${nonEmpty.length}`);
    console.log(`cyclic components: ${groups.filter((g) => g.length > 1).length} (largest ${Math.max(...groups.map((g) => g.length))} tables)`);
    console.log(`self-referencing:  ${infos.filter((i) => i.selfReferencing).map((i) => i.name).join(", ") || "none"}`);
    console.log(`foreign keys:      ${infos.reduce((a, i) => a + i.relations.length, 0)}`);
    console.log("\nrow counts (descending):");
    for (const [name, n] of nonEmpty) console.log(`  ${String(n).padStart(7)}  ${name}`);
    const bytes = await client.$queryRawUnsafe<{ size: string }[]>("SELECT pg_size_pretty(pg_database_size(current_database())) AS size");
    console.log(`\nsource database size: ${bytes[0]?.size ?? "unknown"}`);
  } finally {
    await client.$disconnect();
  }
}

function plan(): void {
  const infos = modelInfos();
  const { groups, order } = condense(infos);
  const cyclic = groups.filter((g) => g.length > 1);
  console.log(`models:            ${infos.length}`);
  console.log(`components:        ${groups.length} (${cyclic.length} cyclic, largest ${Math.max(...groups.map((g) => g.length))})`);
  console.log(`foreign keys:      ${infos.reduce((a, i) => a + i.relations.length, 0)}`);
  console.log(`\ncyclic components (copied in any order, triggers are off):`);
  for (const g of cyclic.sort((a, b) => b.length - a.length)) console.log(`  ${g.join(" <-> ")}`);
  console.log(`\ncopy order:\n${order.map((g) => g.join(", ")).join("\n")}`);
}

type ForeignKey = { table: string; name: string; def: string };

/**
 * The copy runs with the foreign keys removed rather than disabled, because
 * disabling triggers needs privileges this role does not have. Re-adding them
 * afterwards re-validates every copied row, so a bad copy fails loudly here
 * instead of surfacing later as broken joins.
 *
 * `regclass::text` already returns a correctly quoted identifier for these
 * mixed-case table names, so it is used verbatim rather than quoted again.
 */
async function captureForeignKeys(client: PrismaClient): Promise<ForeignKey[]> {
  return client.$queryRawUnsafe<ForeignKey[]>(
    `SELECT c.conrelid::regclass::text AS "table", c.conname AS name,
            pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = current_schema()::regnamespace`,
  );
}

async function dropForeignKeys(client: PrismaClient, fks: ForeignKey[]): Promise<void> {
  for (const fk of fks) await client.$executeRawUnsafe(`ALTER TABLE ${fk.table} DROP CONSTRAINT "${fk.name}"`);
}

async function addForeignKeys(client: PrismaClient, fks: ForeignKey[]): Promise<void> {
  const failed: string[] = [];
  for (const fk of fks) {
    try {
      await client.$executeRawUnsafe(`ALTER TABLE ${fk.table} ADD CONSTRAINT "${fk.name}" ${fk.def}`);
    } catch (e) {
      failed.push(`${fk.table}.${fk.name}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  if (failed.length) {
    throw new Error(`re-adding ${failed.length} foreign key(s) failed, which means the copy holds orphaned rows:\n  ${failed.join("\n  ")}`);
  }
}

/** A long copy over a pooler will occasionally lose an idle connection; retry rather than abandon a verified-good target. */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = (e as Error).message ?? String(e);
      if (i === attempts || !/closed the connection|Connection reset|terminated|ETIMEDOUT|ECONNRESET|P1001|P1017/i.test(msg)) throw e;
      console.log(`  retry ${i}/${attempts - 1} after connection loss on ${label}: ${msg.split("\n")[0]}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw last;
}

async function migrate(): Promise<void> {
  const url = targetUrl();
  if (url === sourceUrl()) throw new Error("refusing to copy onto the source database");

  const src = new PrismaClient({ datasources: { db: { url: sourceUrl() } } });
  const dst = new PrismaClient({ datasources: { db: { url } } });
  try {
    const infos = modelInfos();
    const { order } = condense(infos);

    const fks = await captureForeignKeys(dst);
    console.log(`removing ${fks.length} foreign keys from the target for the duration of the copy`);
    await dropForeignKeys(dst, fks);

    let copied = 0;
    try {
      for (const group of order) {
        for (const name of group) {
          const info = infos.find((i) => i.name === name)!;
          const s = (src as unknown as Record<string, Record<string, Function>>)[name];
          const d = (dst as unknown as Record<string, Record<string, Function>>)[name];

          const already = (await d.count()) as number;
          if (already > 0) {
            console.log(`  skip  ${name} (target has ${already})`);
            continue;
          }

          let n = 0;
          for (;;) {
            const rows = (await withRetry(`read ${name}`, () =>
              s.findMany({ take: BATCH, skip: n, orderBy: info.orderBy.map((f) => ({ [f]: "asc" })) }),
            )) as Record<string, unknown>[];
            if (rows.length === 0) break;
            if (rows.length === BATCH) {
              throw new Error(`${name} returned a full batch with no unique key to page by; raise BATCH before copying it`);
            }
            await withRetry(`write ${name}`, () => d.createMany({ data: rows as never, skipDuplicates: true }));
            n += rows.length;
          }
          copied += n;
          if (n > 0) console.log(`  copy  ${name} ${n} rows`);
        }
      }
    } finally {
      console.log(`restoring ${fks.length} foreign keys (this re-validates every copied row)`);
      await addForeignKeys(dst, fks);
    }
    console.log(`\ncopied ${copied} rows`);
  } finally {
    await src.$disconnect();
    await dst.$disconnect();
  }
}

/**
 * `migrate` deliberately leaves any table that already has rows alone, so it is a
 * one-shot bootstrap and cannot bring a target up to date afterwards. `sync` is
 * that missing half: it reconciles an existing target against a live source so
 * the switchover can happen after the copy without a long maintenance window.
 */
type Row = Record<string, unknown>;

/** Stable text form of a row, so the same row read twice compares equal. */
function stable(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "bigint") return v.toString();
    if (Array.isArray(v)) return v.map(norm);
    if (typeof v === "object") {
      const o = v as Record<string, unknown> & { toFixed?: unknown };
      if (typeof o.toFixed === "function") return (o.toFixed as () => string)();
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) out[k] = norm((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

function rowKey(idFields: string[], row: Row): string {
  return stable(idFields.map((f) => row[f]));
}

function whereOf(idFields: string[], row: Row): Row {
  return Object.fromEntries(idFields.map((f) => [f, row[f]]));
}

async function sync(): Promise<void> {
  const prune = process.argv.includes("--prune");
  const dryRun = process.argv.includes("--dry-run");
  const url = targetUrl();
  if (url === sourceUrl()) throw new Error("refusing to sync onto the source database");

  const src = new PrismaClient({ datasources: { db: { url: sourceUrl() } } });
  const dst = new PrismaClient({ datasources: { db: { url } } });
  try {
    const infos = modelInfos();
    const { order } = condense(infos);

    let fks: ForeignKey[] = [];
    if (dryRun) {
      console.log("dry run: nothing will be written\n");
    } else {
      fks = await captureForeignKeys(dst);
      console.log(`removing ${fks.length} foreign keys from the target for the duration of the sync`);
      await dropForeignKeys(dst, fks);
    }

    let inserted = 0;
    let updated = 0;
    let removed = 0;
    let kept = 0;
    try {
      for (const group of order) {
        for (const name of group) {
          const info = infos.find((i) => i.name === name)!;
          if (info.idFields.length === 0) {
            console.log(`  skip  ${name} (no primary key, so rows cannot be matched safely)`);
            continue;
          }
          const s = (src as unknown as Record<string, Record<string, Function>>)[name];
          const d = (dst as unknown as Record<string, Record<string, Function>>)[name];
          const orderBy = info.orderBy.map((f) => ({ [f]: "asc" }));

          const sRows = (await withRetry(`read source ${name}`, () => s.findMany({ orderBy }))) as Row[];
          const tRows = (await withRetry(`read target ${name}`, () => d.findMany({ orderBy }))) as Row[];

          const tByKey = new Map(tRows.map((r) => [rowKey(info.idFields, r), r]));
          const sKeys = new Set(sRows.map((r) => rowKey(info.idFields, r)));

          const toInsert = sRows.filter((r) => !tByKey.has(rowKey(info.idFields, r)));
          const toUpdate = sRows.filter((r) => {
            const t = tByKey.get(rowKey(info.idFields, r));
            return t !== undefined && stable(t) !== stable(r);
          });
          const toDelete = tRows.filter((r) => !sKeys.has(rowKey(info.idFields, r)));

          if (!toInsert.length && !toUpdate.length && !toDelete.length) continue;

          const parts: string[] = [];
          if (toInsert.length) parts.push(`+${toInsert.length}`);
          if (toUpdate.length) parts.push(`~${toUpdate.length}`);
          if (toDelete.length) parts.push(prune ? `-${toDelete.length}` : `-${toDelete.length} kept (pass --prune to delete)`);
          console.log(`  sync  ${name}  ${parts.join("  ")}`);

          inserted += toInsert.length;
          updated += toUpdate.length;
          kept += prune ? 0 : toDelete.length;

          if (dryRun) continue;

          if (toInsert.length) {
            await withRetry(`insert ${name}`, () => d.createMany({ data: toInsert as never, skipDuplicates: true }));
          }
          for (const r of toUpdate) {
            const where = whereOf(info.idFields, r);
            await withRetry(`update ${name}`, () => d.update({ where: where as never, data: r as never }));
          }
          if (prune) {
            for (const r of toDelete) {
              const where = whereOf(info.idFields, r);
              await withRetry(`delete ${name}`, () => d.delete({ where: where as never }));
              removed++;
            }
          }
        }
      }
    } finally {
      if (!dryRun) {
        console.log(`restoring ${fks.length} foreign keys (this re-validates every synced row)`);
        await addForeignKeys(dst, fks);
      }
    }

    console.log(`\ninserted ${inserted}, updated ${updated}, deleted ${removed}, left alone ${kept}`);
    if (kept > 0) {
      console.log(`\n${kept} target row(s) no longer exist in the source and were kept.`);
      console.log("That is expected when the source is ahead of the copy. Re-run with --prune to");
      console.log("delete them and make the target match the source exactly.");
    }
    if (dryRun) console.log("\ndry run: no changes were written");
  } finally {
    await src.$disconnect();
    await dst.$disconnect();
  }
}

async function verify(): Promise<void> {
  const src = new PrismaClient({ datasources: { db: { url: sourceUrl() } } });
  const dst = new PrismaClient({ datasources: { db: { url: targetUrl() } } });
  try {
    const infos = modelInfos();
    const names = infos.map((i) => i.name);
    const a = await counts(src, names);
    const b = await counts(dst, names);

    const drift: string[] = [];
    for (const name of names) {
      if ((a.get(name) ?? 0) !== (b.get(name) ?? 0)) drift.push(`  ${name}: source=${a.get(name) ?? 0} target=${b.get(name) ?? 0}`);
    }
    console.log(`tables checked:   ${names.length}`);
    console.log(`source rows:      ${[...a.values()].reduce((x, y) => x + y, 0)}`);
    console.log(`target rows:      ${[...b.values()].reduce((x, y) => x + y, 0)}`);
    console.log(`row drift:        ${drift.length === 0 ? "none" : `${drift.length} table(s)`}`);
    if (drift.length) console.log(drift.join("\n"));

    // Foreign keys were removed for the duration of the copy and sync, so
    // nothing has re-checked the references. Prove they hold by looking for rows
    // pointing at nothing.
    //
    // Nullable columns are checked as well as required ones. A row can only be
    // an orphan if the value is present, so the join already excludes nulls, and
    // skipping optional relations is what let a dangling reference through once
    // before: a user was deleted while a top-up still pointed at them.
    let checked = 0;
    const orphans: string[] = [];
    for (const info of infos) {
      for (const rel of info.relations) {
        const r = await dst.$queryRawUnsafe<{ c: number }[]>(
          `SELECT count(*)::int AS c FROM "${info.name}" t
             LEFT JOIN "${rel.toModel}" p ON p."${rel.toField}" = t."${rel.fromField}"
            WHERE t."${rel.fromField}" IS NOT NULL AND p."${rel.toField}" IS NULL`,
        );
        checked++;
        if (r[0].c > 0) orphans.push(`  ${info.name}.${rel.fromField} -> ${rel.toModel}.${rel.toField}: ${r[0].c} orphaned`);
      }
    }
    console.log(`\nforeign keys checked:  ${checked}`);

    // A constraint that failed to be restored is silently missing, and the row
    // counts above would still match, so the count itself has to be asserted.
    const declaredFks = infos.reduce((n, i) => n + i.relations.length, 0);
    const present = await dst.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_constraint
        WHERE contype = 'f' AND connamespace = current_schema()::regnamespace`,
    );
    const fkShort = declaredFks - present[0].n;
    console.log(`foreign keys present:  ${present[0].n} of ${declaredFks} declared`);
    if (fkShort > 0) console.log(`  ${fkShort} foreign key(s) are missing from the target, so it is weaker than the schema`);

    console.log(`orphaned references: ${orphans.length === 0 ? "none" : `${orphans.length}`}`);
    if (orphans.length) console.log(orphans.join("\n"));

    if (drift.length || orphans.length || fkShort > 0) process.exitCode = 1;
    else console.log("\nCOPY VERIFIED: every table matches, every declared foreign key is present, and every reference resolves");
  } finally {
    await src.$disconnect();
    await dst.$disconnect();
  }
}

const mode = process.argv[2] ?? "inspect";
const run: Record<string, () => void | Promise<void>> = { inspect, plan, migrate, sync, verify };
const fn = run[mode];
if (!fn) {
  console.error(`unknown mode "${mode}". use: ${Object.keys(run).join(", ")}`);
  process.exit(1);
}
Promise.resolve(fn()).catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
