/**
 * Loads the library under test. By default that is this checkout's `src/`; `--dist` switches to the
 * built `dist/index.mjs` (what users install), and `--root <dir>` points at another checkout, which
 * is how `bench:branches` runs these scenarios against a base branch's library code.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as Lib from '../../src/index.ts';
import { config } from './config.ts';

function moduleUrl(relative: string): string {
  const path = join(config.root, relative);
  if (!existsSync(path)) {
    throw new Error(
      `benchmark target not found: ${path}${config.dist ? ' (run npm run build)' : ''}`,
    );
  }
  return pathToFileURL(path).href;
}

const lib = (await import(
  moduleUrl(config.dist ? 'dist/index.mjs' : 'src/index.ts')
)) as typeof Lib;

export const HashMap = lib.HashMap;
export type HashMap<K, V> = Lib.HashMap<K, V>;
export type HashMapOptions = Lib.HashMapOptions;

export type HashFn = (value: unknown) => number;
export type EqualsFn = (a: unknown, b: unknown) => boolean;

/**
 * `getHashCode` and `isEqual` are internal, so they always come from `<root>/src`, even with
 * `--dist`. Returns undefined when the target checkout does not have them.
 */
export async function loadInternals(): Promise<
  { getHashCode: HashFn; isEqual: EqualsFn } | undefined
> {
  try {
    const hash = (await import(moduleUrl('src/hash.ts'))) as { getHashCode?: HashFn };
    const eq = (await import(moduleUrl('src/is-equal.ts'))) as { isEqual?: EqualsFn };
    if (hash.getHashCode && eq.isEqual) {
      return { getHashCode: hash.getHashCode, isEqual: eq.isEqual };
    }
  } catch {
    // fall through: the target checkout has a different layout
  }
  return undefined;
}

export const target = { root: config.root, dist: config.dist };
