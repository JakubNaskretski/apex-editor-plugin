import { describe, expect, it } from 'vitest';
import { BUILTIN_SNIPPETS, mergeSnippets } from './snippets';

describe('mergeSnippets', () => {
  it('returns the built-ins when there are no custom snippets', () => {
    expect(mergeSnippets(undefined)).toEqual(BUILTIN_SNIPPETS);
    expect(mergeSnippets([])).toEqual(BUILTIN_SNIPPETS);
  });

  it('ignores non-array input', () => {
    expect(mergeSnippets({ prefix: 'x', body: 'y' })).toEqual(BUILTIN_SNIPPETS);
    expect(mergeSnippets('nope')).toEqual(BUILTIN_SNIPPETS);
  });

  it('appends a new custom snippet after the built-ins', () => {
    const merged = mergeSnippets([{ prefix: 'zz', body: 'Zebra;' }]);
    expect(merged).toHaveLength(BUILTIN_SNIPPETS.length + 1);
    expect(merged.at(-1)).toEqual({ prefix: 'zz', body: 'Zebra;' });
  });

  it('overrides a built-in that shares the same prefix', () => {
    const merged = mergeSnippets([{ prefix: 'sd', body: 'System.debug(LoggingLevel.ERROR, $0);', label: 'debug (error)' }]);
    expect(merged).toHaveLength(BUILTIN_SNIPPETS.length); // replaced, not added
    const sd = merged.find(s => s.prefix === 'sd');
    expect(sd?.body).toBe('System.debug(LoggingLevel.ERROR, $0);');
    expect(sd?.label).toBe('debug (error)');
  });

  it('joins an array body with newlines (VS Code snippet format)', () => {
    const merged = mergeSnippets([{ prefix: 'blk', body: ['if (true) {', '  $0', '}'] }]);
    expect(merged.find(s => s.prefix === 'blk')?.body).toBe('if (true) {\n  $0\n}');
  });

  it('drops malformed entries (missing prefix or body, wrong types)', () => {
    const merged = mergeSnippets([
      { prefix: '', body: 'x' },
      { prefix: 'noBody' },
      { body: 'noPrefix' },
      null,
      42,
      { prefix: 'ok', body: 'fine' }
    ]);
    expect(merged).toHaveLength(BUILTIN_SNIPPETS.length + 1);
    expect(merged.find(s => s.prefix === 'ok')?.body).toBe('fine');
    expect(merged.some(s => s.prefix === 'noBody')).toBe(false);
  });

  it('trims whitespace on prefix, label and description', () => {
    const merged = mergeSnippets([{ prefix: '  tr  ', body: 'x', label: '  L  ', description: '  D  ' }]);
    const tr = merged.find(s => s.prefix === 'tr');
    expect(tr).toEqual({ prefix: 'tr', body: 'x', label: 'L', description: 'D' });
  });
});
