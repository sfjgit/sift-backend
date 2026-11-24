import prisma from "@/utils/prisma/client";
(async () => {
  const q = process.argv.slice(2).join(" ");
  const r = await prisma.$queryRawUnsafe(q);
  console.log(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 1));
  process.exit(0);
})().catch((e) => { console.error(String(e).slice(-400)); process.exit(1); });
