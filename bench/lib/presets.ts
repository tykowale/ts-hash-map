/**
 * Named subsets of the suite. A preset fixes the families, the group filter and the time budget, so
 * two runs of the same preset always measure the same groups in the same order. That matters
 * because JIT feedback carries over between groups inside a family process: a subset run is only
 * comparable with another run of the same subset, never with a full run.
 *
 * To add rows, append a pattern to a preset's `groups`. Each pattern is a regex fragment matched
 * against the whole `family/group` id (case-insensitive); the family is added to the run
 * automatically.
 */

export interface Preset {
  description: string;
  /** Regex fragments, each matching whole `family/group` ids. */
  groups: string[];
  /** Minimum measured CPU time per case; an explicit `--time` wins. */
  timeMs: number;
}

export const PRESETS: Record<string, Preset> = {
  hill: {
    description:
      'about 25 groups across key types, sized for a 1-2 minute screen and a 3-run bench:branches',
    timeMs: 150,
    groups: [
      'int-keys/int (get-hit|get-miss|set-fresh|churn) n=1000',
      'int-keys/int get-hit n=(10|100000)',
      'int-keys/sparse-int get-hit n=100000',
      'string-keys/uuid-fresh get-hit n=(10|1000)',
      'string-keys/string-8 get-hit n=1000',
      'object-keys/user-record (get-hit|get-miss|set-fresh|churn) n=1000',
      'object-keys/user-record get-hit n=(10|10000)',
      'array-keys/tuple (get-hit|set-fresh|churn) n=1000',
      'nested-keys/nested get-hit n=1000',
      'mixed-keys/mixed get-hit n=1000',
      'iteration/for\\.\\.of entries n=1000',
      'construction/from entries n=10',
      'construction/single resize.*',
    ],
  },
};

export function presetNames(): string[] {
  return Object.keys(PRESETS);
}

export function getPreset(name: string): Preset {
  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(`unknown preset: ${name}; available: ${presetNames().join(', ')}`);
  }
  return preset;
}

/** Families a preset touches, in suite order (alphabetical, like run.ts). */
export function presetFamilies(preset: Preset): string[] {
  const families = preset.groups.map((g) => {
    const family = g.split('/')[0];
    if (!family || !/^[a-z0-9-]+$/.test(family)) {
      throw new Error(`preset group pattern must start with a literal family name: ${g}`);
    }
    return family;
  });
  return [...new Set(families)].sort();
}

export function presetFilter(preset: Preset): string {
  return `^(${preset.groups.join('|')})$`;
}

/**
 * The flags a preset stands for, to put in front of the user's own flags (a later `--time` or
 * `--sizes` then overrides the preset's).
 */
export function presetArgs(name: string): { families: string[]; args: string[] } {
  const preset = getPreset(name);
  return {
    families: presetFamilies(preset),
    args: ['--filter', presetFilter(preset), '--time', String(preset.timeMs)],
  };
}

export const PRESET_USAGE = `  --preset <name>     run a named subset (${presetNames().join(', ')}); sets --family, --filter
                      and --time (an explicit --time still wins); cannot be combined with
                      --family or --filter`;
