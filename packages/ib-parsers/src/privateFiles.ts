/// <reference types="node" />
// The real files of the two accounts, on the author's machine only, found by what they carry and
// never by name: a file name would write the account into the repository. Only each file's first
// bytes are read, so a test may call this while vitest collects it, to decide whether to skip.
import { closeSync, existsSync, openSync, readdirSync, readSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRIVATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../private");

/** A Flex response of `private/`, and the activity statements of the same IB account beside it. */
export interface PrivateFlex {
  path: string;
  statements: string[];
}

function head(file: string, bytes: number): string {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    return buffer.subarray(0, readSync(fd, buffer, 0, bytes, 0)).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Every Flex response of `private/`, in file name order. */
function flexResponses(): PrivateFlex[] {
  if (!existsSync(PRIVATE_DIR)) return [];
  const names = readdirSync(PRIVATE_DIR).sort();
  const statements = names.filter((name) => name.endsWith(".htm")).map((name) => path.join(PRIVATE_DIR, name));
  return names
    .filter((name) => name.endsWith(".xml"))
    .map((name) => path.join(PRIVATE_DIR, name))
    .map((file) => ({ file, text: head(file, 4096) }))
    .filter(({ text }) => text.includes("<FlexQueryResponse"))
    .map(({ file, text }) => {
      const ibAccountId = /accountId="([^"]+)"/.exec(text)?.[1] ?? "";
      return {
        path: file,
        statements: ibAccountId === "" ? [] : statements.filter((statement) => head(statement, 2048).includes(ibAccountId)),
      };
    });
}

/** alpha: the account whose yearly statements, back to its opening, sit beside its latest Flex. */
export function alphaFlex(): PrivateFlex | null {
  return flexResponses().filter((flex) => flex.statements.length > 0).at(-1) ?? null;
}

/** beta: the account known from its Flex alone, the latest one. */
export function betaFlex(): PrivateFlex | null {
  return flexResponses().filter((flex) => flex.statements.length === 0).at(-1) ?? null;
}
