function isSymbolEqual(a: symbol, b: symbol): boolean {
  return a.valueOf() === b.valueOf();
}

function isDateEqual(a: Date, b: Date): boolean {
  return +a === +b || (isNaN(+a) && isNaN(+b));
}

function isRegExpEqual(a: RegExp, b: RegExp): boolean {
  return a.toString() === b.toString();
}

function isFunctionEqual(a: Function, b: Function): boolean {
  return a.toString() === b.toString();
}

function isArrayEqual(a: unknown[], b: unknown[], refs: unknown[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (!(i in a) && !(i in b)) {
      continue;
    }
    if (!isEqual(a[i], b[i], refs)) {
      return false;
    }
  }

  return true;
}

function isMapEqual(a: Map<any, unknown>, b: Map<any, unknown>, refs: unknown[]): boolean {
  if (a.size !== b.size) {
    return false;
  }

  const aIterator = a.entries();
  for (const [key, value] of aIterator) {
    if (!b.has(key) || !isEqual(value, b.get(key), refs)) {
      return false;
    }
  }

  return true;
}

function isSetEqual(a: Set<unknown>, b: Set<unknown>): boolean {
  if (a.size !== b.size) {
    return false;
  }

  const aIterator = a.values();
  for (const value of aIterator) {
    if (!b.has(value)) {
      return false;
    }
  }

  return true;
}

function isObjectEqual(a: any, b: any, refs: any[]): boolean {
  if (Object.keys(a).length !== Object.keys(b).length) {
    return false;
  }

  for (const key in a) {
    if (!isEqual(a[key], b[key], refs)) {
      return false;
    }
  }

  return true;
}

export function isEqual(a: unknown, b: unknown, refs: unknown[] = []): boolean {
  // this catches primitives and objects that are the same in mem
  if (a === b) {
    return true;
  }

  // if one is nullish and the other is not then they are not equal
  // if both are null/undefined it will be caught above
  if (a == null || b == null) {
    return false;
  }

  // prevent circular refs, if both are already in the refs array
  // then we've seen them already
  if (refs.includes(a) && refs.includes(b)) {
    return true;
  }

  refs.push(a, b);

  const typeA = typeof a;
  const typeB = typeof b;

  if (typeA !== typeB) {
    return false;
  }

  // this is used for checking equality against non-primitives.
  // strings, booleans, etc would be caught in the first check so no need to
  // check again. We know they are false and will be caught in the default
  switch (typeA) {
    case 'symbol':
      return isSymbolEqual(a as symbol, b as symbol);
    case 'object':
      if (Array.isArray(a) && Array.isArray(b)) {
        return isArrayEqual(a, b, refs);
      } else if (a instanceof Date && b instanceof Date) {
        return isDateEqual(a, b);
      } else if (a instanceof RegExp && b instanceof RegExp) {
        return isRegExpEqual(a, b);
      } else if (a instanceof Function && b instanceof Function) {
        return isFunctionEqual(a, b);
      } else if (a instanceof Map && b instanceof Map) {
        return isMapEqual(a, b, refs);
      } else if (a instanceof Set && b instanceof Set) {
        return isSetEqual(a, b);
      } else {
        return isObjectEqual(a, b, refs);
      }
    default:
      return false;
  }
}
