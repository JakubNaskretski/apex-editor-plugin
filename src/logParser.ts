export type LogCategory = 'USER_DEBUG' | 'SOQL' | 'DML' | 'EXCEPTION' | 'SYSTEM';

export interface LogEntry {
  timestamp: string;
  category: LogCategory;
  eventType: string;
  lineRef: string;
  message: string;
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

// Log line format: "HH:MM:SS.ms (nanos)|EVENT_TYPE|[line]|...fields"
// Header line example: "59.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO;..."
export function parseLogs(raw: string): LogEntry[] {
  if (!raw) {
    return [];
  }
  const entries: LogEntry[] = [];
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
    if (pipeIdx === -1) {
      continue;
    }
    const timestamp = trimmed.slice(0, pipeIdx);
    // Must look like a log timestamp: "HH:MM:SS.ms (nanos)"
    if (!/^\d{2}:\d{2}:\d{2}/.test(timestamp)) {
      continue;
    }
    const parts = trimmed.slice(pipeIdx + 1).split('|');
    const eventType = parts[0] ?? '';
    const lineRef = parts[1] ?? '';
    const message = parts.slice(2).join(' | ');
    entries.push({
      timestamp: timestamp.split(' ')[0], // strip nanos, keep HH:MM:SS.ms
      category: CATEGORY_MAP[eventType] ?? 'SYSTEM',
      eventType,
      lineRef,
      message,
    });
  }
  return entries;
}
