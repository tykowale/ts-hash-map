function getBooleanHashCode(value: boolean): number {
  // Java convention for boolean hash codes
  return value ? 1231 : 1237;
}

function getStringHashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const charCode = value.charCodeAt(i);
    hash = (hash << 5) - hash + charCode;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
}

function getDateHashCode(value: Date): number {
  return value.getTime();
}

function getRegExpHashCode(value: RegExp): number {
  return getStringHashCode(value.toString());
}

function getFunctionHashCode(value: Function): number {
  return getStringHashCode(value.toString());
}

function getArrayHashCode(value: unknown[], refs: unknown[]): number {
  let hash = 0;
  for (const item of value) {
    hash = hash * 31 + getHashCode(item, refs);
  }
  return hash;
}

function getMapHashCode(value: Map<any, unknown>, refs: unknown[]): number {
  let hash = 0;
  for (const [key, val] of value.entries()) {
    hash ^= getHashCode(key, refs) ^ getHashCode(val, refs);
  }
  return hash;
}

function getSetHashCode(value: Set<unknown>, refs: unknown[]): number {
  let hash = 0;
  for (const item of value) {
    hash ^= getHashCode(item, refs);
  }
  return hash;
}

function getObjectHashCode(value: any, refs: any[]): number {
  let hash = 0;
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    hash ^= getStringHashCode(key) ^ getHashCode(value[key], refs);
  }
  return hash;
}

export function getHashCode(value: unknown, refs: unknown[] = []): number {
  // Handle null and undefined
  if (value == null) {
    return 0;
  }

  // Handle primitives with switch statement
  switch (typeof value) {
    case 'number':
      return value;
    case 'bigint':
      // Treat bigint as a string
      return getStringHashCode(value.toString());
    case 'boolean':
      return getBooleanHashCode(value);
    case 'string':
      return getStringHashCode(value);
    default:
      break;
  }

  if (typeof value === 'object') {
    if (refs.includes(value)) {
      return 0;
    }

    // Store current value in refs to handle circular references
    refs.push(value);

    if (Array.isArray(value)) {
      return getArrayHashCode(value, refs);
    } else if (value instanceof Date) {
      return getDateHashCode(value);
    } else if (value instanceof RegExp) {
      return getRegExpHashCode(value);
    } else if (value instanceof Function) {
      return getFunctionHashCode(value);
    } else if (value instanceof Map) {
      return getMapHashCode(value, refs);
    } else if (value instanceof Set) {
      return getSetHashCode(value, refs);
    } else {
      return getObjectHashCode(value, refs);
    }
  }

  return 0;
}
