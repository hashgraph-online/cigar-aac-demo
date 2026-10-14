/**
 * CPB `jcs-n` normalization.
 *
 * From the draft: "remove, bottom-up and recursively, every member whose value
 * is JSON null, an empty array (zero elements), or an empty object (zero
 * members)" — applied after exclusion-set removal and before serialization.
 *
 * "Bottom-up" is load-bearing. Given {"a":{"b":null}}, removing `b` leaves `a`
 * as an empty object, which must then itself be removed. A single top-down
 * pass would leave {"a":{}} and produce a different digest.
 *
 * Note on scope: the rule says *member*, which in JSON means an object member.
 * Array elements are not members, so a null inside an array is preserved —
 * removing it would change the array's length and therefore its meaning.
 */

function isEmptyish(v) {
  if (v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object' && v !== undefined) return Object.keys(v).length === 0;
  return false;
}

/**
 * @param {unknown} value
 * @returns {unknown} a deep copy with null/empty-array/empty-object members removed
 */
export function normalizeJcsN(value) {
  if (Array.isArray(value)) {
    // Recurse into elements but keep every position.
    return value.map((el) => normalizeJcsN(el));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      // Post-order: normalize the child first, then test the *result*.
      const child = normalizeJcsN(value[key]);
      if (isEmptyish(child)) continue;
      out[key] = child;
    }
    return out;
  }
  return value;
}
