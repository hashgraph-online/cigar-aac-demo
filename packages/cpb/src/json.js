/** RFC 8785 input boundary: JSON.parse alone silently drops duplicate names. */
export function parseJson(source) {
  if (typeof source !== 'string') throw new SyntaxError('JSON input must be text.');
  let value;
  try { value = JSON.parse(source); }
  catch { throw new SyntaxError('This file is not valid JSON.'); }
  // Syntax is already validated. Track member names on the original tokens,
  // including escaped spellings, before returning the parsed value to a hasher.
  const stack = [];
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g;
  for (const [token] of source.matchAll(tokens)) {
    const frame = stack.at(-1);
    if (token === '{' || token === '[') {
      if (stack.length >= 128) throw new SyntaxError('JSON nesting exceeds the demo limit of 128.');
      stack.push(token === '{' ? { keys: new Set(), member: true } : null);
    } else if (token === '}' || token === ']') stack.pop();
    else if (frame && token === ':') frame.member = false;
    else if (frame && token === ',') frame.member = true;
    else if (frame?.member && token.startsWith('"')) {
      const name = JSON.parse(token);
      if (frame.keys.has(name)) throw new SyntaxError('This file contains duplicate JSON member names.');
      frame.keys.add(name);
    }
  }
  return value;
}
