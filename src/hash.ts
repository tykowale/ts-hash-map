function objectHash(obj: any, visited: Set<any> = new Set()): number {
  if (visited.has(obj)) {
    return 0; // Return 0 for cyclic references to prevent infinite recursion
  }
  visited.add(obj);

  let hash = 0;

  for (const prop in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, prop)) {
      const keyHash = Hash(prop);
      const valueHash = Hash(obj[prop], visited);
      hash += (keyHash ^ valueHash);
    }
  }

  return hash;
}

function stringHash(input: string): number {
  let hash = 0;

  for (let i = 0; i < input.length; i++) {
    const character = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + character;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return hash;
}

export function Hash(unknownType: any, visited: Set<any> = new Set()): number {
  switch (typeof unknownType) {
    case 'object':
      return objectHash(unknownType, visited);
    default:
      return stringHash(String(unknownType));
  }
};

