export type LogCategory = 'USER_DEBUG' | 'SOQL' | 'DML' | 'EXCEPTION' | 'SYSTEM';

export interface LogEntry {
  timestamp: string;
  category: LogCategory;
  eventType: string;
  lineRef: string;
  message: string;
}

export interface LimitMetric {
  name: string;
  used: number;
  max: number;
}

/**
 * Extract the latest LIMIT_USAGE_FOR_NS governor-limit snapshot from a debug log.
 * Keyed by namespace + metric so a managed package can't overwrite the (default)
 * namespace's numbers; the default namespace's metrics are shown unprefixed.
 */
export function parseLimitUsage(raw: string): LimitMetric[] {
  if (!raw) {
    return [];
  }
  let inBlock = false;
  let ns = '';
  const latest = new Map<string, LimitMetric>();
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const nsMatch = line.match(/\|LIMIT_USAGE_FOR_NS\|([^|]*)\|/) || line.trim().match(/^LIMIT_USAGE_FOR_NS\|([^|]*)\|/);
    if (nsMatch) {
      inBlock = true;
      ns = (nsMatch[1] ?? '').trim();
      continue;
    }
    if (!inBlock) {
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) { inBlock = false; continue; }
    if (/^\d{2}:\d{2}:\d{2}/.test(trimmed)) { inBlock = false; continue; }
    const m = trimmed.match(/^(.+?):\s*(\d+)\s+out of\s+(\d+)/i);
    if (m) {
      const metric = m[1].replace(/^Number of\s+/i, '').trim();
      const isDefault = !ns || /^\(default\)$/i.test(ns);
      const name = isDefault ? metric : `${ns}: ${metric}`;
      latest.set(name, { name, used: Number(m[2]), max: Number(m[3]) });
    }
  }
  return Array.from(latest.values());
}

const CATEGORY_MAP: Record<string, LogCategory> = {
  USER_DEBUG: 'USER_DEBUG',
  SOQL_EXECUTE_BEGIN: 'SOQL',
  SOQL_EXECUTE_END: 'SOQL',
  SOQL_EXECUTE_EXPLAIN: 'SOQL',
  DML_BEGIN: 'DML',
  DML_END: 'DML',
  EXCEPTION_THROWN: 'EXCEPTION',
  FATAL_ERROR: 'EXCEPTION',
};

const LINE_REF_RE = /^\[.+\]$/;

// Log line format: "HH:MM:SS.ms (nanos)|EVENT_TYPE|[line]|...fields"
// Header line example: "59.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO;..."
export function parseLogs(raw: string): LogEntry[] {
  if (!raw) {
    return [];
  }
  const entries: LogEntry[] = [];
  let last: LogEntry | null = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    // Skip the version/debug-level header line
    if (/^\d+\.\d+\s+\w/.test(trimmed) && trimmed.includes('APEX_CODE')) {
      continue;
    }
    const pipeIdx = trimmed.indexOf('|');
    const timestampField = pipeIdx === -1 ? '' : trimmed.slice(0, pipeIdx);
    const isNewEntry = pipeIdx !== -1 && /^\d{2}:\d{2}:\d{2}/.test(timestampField);
    if (!isNewEntry) {
      // Untimestamped continuation line — Salesforce emits multi-line bodies
      // (FATAL_ERROR stack traces, variable dumps) on follow-up lines. Attach
      // them to the previous entry instead of dropping them.
      if (last) {
        last.message = last.message ? `${last.message}\n${trimmed}` : trimmed;
      }
      continue;
    }
    const parts = trimmed.slice(pipeIdx + 1).split('|');
    const eventType = parts[0] ?? '';
    const rest = parts.slice(1);
    // Some events (FATAL_ERROR, anonymous CODE_UNITs) have no [N] line-ref segment.
    // Only treat the first segment as the line ref when it actually looks like one.
    let lineRef = '';
    let message: string;
    if (rest.length > 0 && LINE_REF_RE.test(rest[0])) {
      lineRef = rest[0];
      message = rest.slice(1).join(' | ');
    } else {
      message = rest.join(' | ');
    }
    const entry: LogEntry = {
      timestamp: timestampField.split(' ')[0], // strip nanos, keep HH:MM:SS.ms
      category: CATEGORY_MAP[eventType] ?? 'SYSTEM',
      eventType,
      lineRef,
      message,
    };
    entries.push(entry);
    last = entry;
  }
  return entries;
}
