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

function getArrayHashCode(value: unknown[], refs: unknown[]): number {
  let hash = 0;

  for (const item of value) {
    // 31 is just random large prime. It could really be anything
    hash = (hash * 31) + getHashCode(item, refs);
    hash |= 0; // Convert to 32-bit integer
  }

  return hash;
}

function getMapHashCode(value: Map<any, unknown>, refs: unknown[]): number {
  let hash = 0;
  for (const [key, val] of value.entries()) {
    // 59 is just random large prime. It could really be anything
    hash ^= (hash * 59) + getHashCode(key, refs) ^ getHashCode(val, refs);
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
}

function getSetHashCode(value: Set<unknown>, refs: unknown[]): number {
  let hash = 0;
  for (const item of value) {
    hash += getHashCode(item, refs);
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
}

function getObjectHashCode(value: any, refs: any[]): number {
  let hash = 0;

  const keys = Object.keys(value).sort();
  for (const key of keys) {
    // 97 is just random large prime. It could really be anything
    hash ^= (hash * 97) + getStringHashCode(key) ^ getHashCode(value[key], refs);
    hash |= 0; // Convert to 32-bit integer
  }

  return hash;
}

export function getHashCode(value: unknown, refs: unknown[] = []): number {
  // null and undefined are 0
  if (value == null) {
    return 0;
  }

  // a lot of the primitives will just be treated as strings
  switch (typeof value) {
    case 'number':
      return value;
    case 'boolean':
      return getBooleanHashCode(value);
    case 'string':
      return getStringHashCode(value);
    case 'bigint':
    case 'function':
    case 'symbol':
      return getStringHashCode(value.toString());
    default:
      break;
  }

  if (typeof value !== 'object') {
    return 0;
  }

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
  } else if (value instanceof Map) {
    return getMapHashCode(value, refs);
  } else if (value instanceof Set) {
    return getSetHashCode(value, refs);
  } else {
    return getObjectHashCode(value, refs);
  }

}
