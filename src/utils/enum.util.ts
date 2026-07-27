// File: enum.util.ts
// Path: src/utils/enum.util.ts

import { Prisma } from "@prisma/client";

/** Reads enum members directly from the compiled Prisma schema (DMMF). */
export function getEnumValues(enumName: string): string[] {
  const found = Prisma.dmmf.datamodel.enums.find((e) => e.name === enumName);
  if (!found) throw new Error(`Enum "${enumName}" not found in Prisma schema`);
  return found.values.map((v) => v.name);
}

/** SUPER_ADMIN -> "Super Admin" — derived, so labels stay in sync with the enum. */
export function toLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
