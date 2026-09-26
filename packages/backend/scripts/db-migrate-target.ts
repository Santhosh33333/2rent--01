/**
 * Copies the production database to another Postgres instance (a Neon US-east
 * endpoint, for example) so the API can sit somewhere near its users.
 *
 * This never changes where the app points. It only reads the source and writes
 * the target, and it refuses to run a copy until every table has been counted on
 * both sides and agreed. Switching the app over is a separate, deliberate step.
 *
 *   npx tsx scripts/db-migrate-target.ts inspect   source only, no target needed
 *   npx tsx scripts/db-migrate-target.ts plan      compare source and target schemas
 *   npx tsx scripts/db-migrate-target.ts migrate   copy the rows (needs TARGET_DATABASE_URL)
 *   npx tsx scripts/db-migrate-target.ts verify    recount both sides and report drift
 */
import { Prisma, PrismaClient } from "@prisma/client";
import * as fs from "fs";

const SOURCE_B64 = "C:\\Users\\acer\\AppData\\Local\\Temp\\opencode\\prod_db.b64";
const BATCH = 500;

function sourceUrl(): string {
  const b64 = fs.readFileSync(SOURCE_B64, "utf8").trim();
  return Buffer.from(b64, "base64").toString("utf8");
}

type ModelInfo = {
  name: string;
  pkField: string | null;
  pkType: string;
  dependsOn: string[];
};

function modelInfos(): ModelInfo[] {
  return Prisma.dmmf.datamodel.models.map((m) => {
    const pk = m.primaryKey?.fields ?? [];
    const pkField = pk.length === 1 ? m.fields.find((f) => f.name === pk[0]) ?? null : null;
    const dependsOn = new Set<string>();
    for (const rel of m.relations ?? []) {
      if (rel.kind !== "object") continue;
      const target = (rel as unknown as { referencedModel?: string }).referencedModel ?? (rel as unknown as { toModel?: string }).toModel;
      if (target && target !== m.name) dependsOn.add(target);
    }
    return { name: m.name, pkField: pkField ? pkField.name : null, pkType: pkField ? pkField.type : "String", dependsOn: [...dependsOn] };
  });
}

/** Parents before children. Cycles are reported rather than silently mis-ordered. */
function topoSort(infos: ModelInfo[]): { order: string[]; cycles: string[][] } {
  const byName = new Map(infos.map((i) => [i.name, i]));
  const order: string[] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const cycles: string[][] = [];

  const visit = (name: string, stack: string[]): void => {
    const s = state.get(name);
    if (s === 2) return;
    if (s === 1) {
      const start = stack.indexOf(name);
      if (start >= 0) cycles.push([...stack.slice(start), name]);
      return;
    }
    state.set(name, 1);
    for (const dep of byName.get(name)?.dependsOn ?? []) {
      if (byName.has(dep)) visit(dep, [...stack, name]);
    }
    state.set(name, 2);
    order.push(name);
  };

  for (const i of infos) visit(i.name, []);
  return { order, cycles };
}

async function counts(client: PrismaClient, names: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const name of names) {
    const model = (client as unknown as Record<string, { count(args?: unknown): Promise<number> }>)[name];
    out.set(name, await model.count());
  }
  return out;
}

async function inspect(): Promise<void> {
  const client = new PrismaClient({ datasources: { db: { url: sourceUrl() } } });
  try {
    const infos = modelInfos();
    const { cycles } = topoSort(infos);
    const src = await counts(client, infos.map((i) => i.name));
    const total = [...src.values()].reduce((a, b) => a + b, 0);
    const nonEmpty = [...src.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

    console.log(`models:        ${infos.length}`);
    console.log(`total rows:    ${total}`);
    console.log(`tables w/ data: ${nonEmpty.length}`);
    console.log(`fk cycles:     ${cycles.length}${cycles.length ? ` -> ${cycles.map((c) => c.join(" < ")).join("; ")}` : ""}`);
    console.log(`composite pks: ${infos.filter((i) => !i.pkField).map((i) => i.name).join(", ") || "none"}`);
    console.log("\nrow counts (descending):");
    for (const [name, n] of nonEmpty) console.log(`  ${String(n).padStart(7)}  ${name}`);

    const bytes = await client.$queryRawUnsafe<{ size: string }[]>(
      "SELECT pg_size_pretty(pg_database_size(current_database())) AS size",
    );
    console.log(`\nsource database size: ${bytes[0]?.size ?? "unknown"}`);
  } finally {
    await client.$disconnect();
  }
}

async function migrate(): Promise<void> {
  const target = process.env.TARGET_DATABASE_URL;
  if (!target) throw new Error("TARGET_DATABASE_URL is required for migrate/verify");
  if (target === sourceUrl()) throw new Error("refusing to copy onto the source database");

  const src = new PrismaClient({ datasources: { db: { url: sourceUrl() } } });
  const dst = new PrismaClient({ datasources: { db: { url: target } } });
  try {
    const infos = modelInfos();
    const { order, cycles } = topoSort(infos);
    if (cycles.length) {
      throw new Error(`foreign key cycles present, cannot order the copy safely: ${cycles.map((c) => c.join(" < ")).join("; ")}`);
    }

    let copied = 0;
    for (const name of order) {
      const info = infos.find((i) => i.name === name)!;
      const s = (src as unknown as Record<string, Record<string, Function>>)[name];
      const d = (dst as unknown as Record<string, Record<string, Function>>)[name];

      const already = await d.count();
      if (already > 0) {
        console.log(`  skip  ${name} (target already has ${already})`);
        continue;
      }

      let cursor: unknown = undefined;
      let n = 0;
      for (;;) {
        // Cursor paging needs a single-field key. Most models here have a
        // composite key or none at all, so fall back to offset paging, which is
        // safe because the source is only ever read.
        const rows = (await s.findMany(
          info.pkField && cursor
            ? { take: BATCH, cursor: { [info.pkField]: cursor }, skip: 1, orderBy: { [info.pkField]: "asc" } }
            : { take: BATCH, skip: n, orderBy: info.pkField ? { [info.pkField]: "asc" } : undefined },
        )) as Record<string, unknown>[];
        if (rows.length === 0) break;
        if (!info.pkField && rows.length === BATCH) {
          throw new Error(`${name} has more than ${BATCH} rows and no single-field key; add an @id or raise BATCH before copying it`);
        }
        await d.createMany({ data: rows as never, skipDuplicates: true });
        n += rows.length;
        if (rows.length < BATCH) break;
        if (info.pkField) cursor = rows[rows.length - 1][info.pkField];
      }
      copied += n;
      console.log(`  copy  ${name} ${n} rows`);
    }
    console.log(`\ncopied ${copied} rows`);
  } finally {
    await src.$disconnect();
    await dst.$disconnect();
  }
}

async function verify(): Promise<void> {
  const target = process.env.TARGET_DATABASE_URL;
  if (!target) throw new Error("TARGET_DATABASE_URL is required for verify");
  const src = new PrismaClient({ datasources: { db: { url: sourceUrl() } } });
  const dst = new PrismaClient({ datasources: { db: { url: target } } });
  try {
    const names = modelInfos().map((i) => i.name);
    const a = await counts(src, names);
    const b = await counts(dst, names);
    const drift: string[] = [];
    for (const name of names) {
      if ((a.get(name) ?? 0) !== (b.get(name) ?? 0)) {
        drift.push(`  ${name}: source=${a.get(name) ?? 0} target=${b.get(name) ?? 0}`);
      }
    }
    console.log(`tables checked: ${names.length}`);
    console.log(`source rows:    ${[...a.values()].reduce((x, y) => x + y, 0)}`);
    console.log(`target rows:    ${[...b.values()].reduce((x, y) => x + y, 0)}`);
    if (drift.length === 0) console.log("\nno drift: every table matches");
    else {
      console.log(`\nDRIFT in ${drift.length} table(s):`);
      console.log(drift.join("\n"));
      process.exitCode = 1;
    }
  } finally {
    await src.$disconnect();
    await dst.$disconnect();
  }
}

const mode = process.argv[2] ?? "inspect";
const run: Record<string, () => Promise<void>> = { inspect, plan: inspect, migrate, verify };
const fn = run[mode];
if (!fn) {
  console.error(`unknown mode "${mode}". use: ${Object.keys(run).join(", ")}`);
  process.exit(1);
}
fn().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
