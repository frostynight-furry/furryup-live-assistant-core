'use strict';
// A literal substitution utility. The caller owns every template and value.
const slots = text => [...new Set([...text.matchAll(/\[\[([A-Za-z][A-Za-z0-9_]*)\]\]/g)].map(match => match[1]))].sort();
function createTextRenderer(rows) {
  if (!Array.isArray(rows)) throw new TypeError('Explicit template rows are required');
  const entries = new Map();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id || typeof row.text !== 'string' || entries.has(row.id)) throw new TypeError('Invalid or duplicate template');
    entries.set(row.id, row.text);
  }
  function text(id, values = {}) {
    const template = entries.get(id);
    if (typeof template !== 'string') throw new Error('Unknown assistant text: ' + id);
    return template.replace(/\[\[([A-Za-z][A-Za-z0-9_]*)\]\]/g, (_, name) => {
      if (!Object.hasOwn(values, name) || !['string', 'number', 'boolean'].includes(typeof values[name]) ||
          typeof values[name] === 'number' && !Number.isFinite(values[name])) throw new Error('Missing assistant text value: ' + name);
      return String(values[name]);
    });
  }
  return { text };
}
module.exports = { createTextRenderer, slots };
