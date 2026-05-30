import { describe, expect, it } from 'vitest';
import { parseLogs, parseLimitUsage } from './logParser';

describe('parseLogs', () => {
  it('returns [] for empty input', () => {
    expect(parseLogs('')).toEqual([]);
  });

  it('skips the version/debug-level header line', () => {
    const entries = parseLogs('59.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO\n16:00:00.0 (1)|USER_DEBUG|[12]|DEBUG|hi');
    expect(entries).toHaveLength(1);
    expect(entries[0].eventType).toBe('USER_DEBUG');
  });

  it('detects a [N] line ref for USER_DEBUG', () => {
    const [e] = parseLogs('16:00:00.0 (1)|USER_DEBUG|[12]|DEBUG|hello world');
    expect(e.lineRef).toBe('[12]');
    expect(e.category).toBe('USER_DEBUG');
    expect(e.message).toContain('hello world');
    expect(e.timestamp).toBe('16:00:00.0'); // nanos stripped
  });

  it('does not mistake a non-bracketed first segment for a line ref', () => {
    const [e] = parseLogs('16:00:01.0 (2)|FATAL_ERROR|System.NullPointerException: boom');
    expect(e.lineRef).toBe('');
    expect(e.category).toBe('EXCEPTION');
    expect(e.message).toContain('System.NullPointerException');
  });

  it('attaches untimestamped continuation lines (stack traces) to the previous entry', () => {
    const raw = [
      '16:00:01.0 (2)|FATAL_ERROR|System.NullPointerException: boom',
      'Class.Foo.bar: line 10, column 1',
      'Class.Foo.baz: line 20, column 1'
    ].join('\n');
    const entries = parseLogs(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toContain('Class.Foo.bar');
    expect(entries[0].message).toContain('Class.Foo.baz');
  });
});

describe('parseLimitUsage', () => {
  it('extracts default-namespace governor limits', () => {
    const raw = [
      '16:00:02.0 (1)|LIMIT_USAGE_FOR_NS|(default)|',
      '  Number of SOQL queries: 3 out of 100',
      '  Number of DML statements: 1 out of 150'
    ].join('\n');
    const limits = parseLimitUsage(raw);
    expect(limits.find(l => l.name === 'SOQL queries')).toEqual({ name: 'SOQL queries', used: 3, max: 100 });
    expect(limits.find(l => l.name === 'DML statements')).toEqual({ name: 'DML statements', used: 1, max: 150 });
  });

  it('keeps managed-package limits separate from (default)', () => {
    const raw = [
      '16:00:02.0 (1)|LIMIT_USAGE_FOR_NS|(default)|',
      '  Number of SOQL queries: 3 out of 100',
      '16:00:02.1 (2)|LIMIT_USAGE_FOR_NS|myns|',
      '  Number of SOQL queries: 90 out of 100'
    ].join('\n');
    const limits = parseLimitUsage(raw);
    expect(limits.find(l => l.name === 'SOQL queries')?.used).toBe(3);
    expect(limits.find(l => l.name === 'myns: SOQL queries')?.used).toBe(90);
  });
});
