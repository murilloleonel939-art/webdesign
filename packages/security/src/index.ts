import { resolve, sep } from "node:path";

// Resuelve `userPath` dentro de `root` y rechaza cualquier ruta que salga de él.
export function safeJoin(root: string, userPath: string): string {
  if (userPath.includes("\0")) throw new Error("invalid path: null byte");
  const base = resolve(root);
  const target = resolve(base, userPath);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error("path traversal rejected");
  }
  return target;
}
