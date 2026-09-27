import { ensureLegalDocumentsSeeded } from "../src/services/legalConsentService";
import { prisma } from "../src/config/database";

(async () => {
  const r = await ensureLegalDocumentsSeeded();
  console.log("inserted:", r.inserted);
  const rows = await prisma.legalDocument.findMany({
    orderBy: { kind: "asc" },
    select: { kind: true, version: true, isCurrent: true, contentHtml: true },
  });
  for (const d of rows) {
    console.log(`  ${d.kind} v${d.version} current=${d.isCurrent} html=${d.contentHtml.length}b`);
  }
  // Idempotency: a second run must insert nothing and must not bump versions.
  const again = await ensureLegalDocumentsSeeded();
  console.log("second run inserted:", again.inserted);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("ERR", e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
