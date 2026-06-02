/**
 * Snippet dictionary for the Apex editor's suggestion popup.
 *
 * The data model deliberately mirrors VS Code's own snippet schema
 * (`prefix` / `body` / `description`) and uses VS Code snippet-body syntax
 * (`$0` for the final caret, `$1` / `${1:placeholder}` for tab stops). The
 * webview popup only honours the first stop today, but keeping the format
 * identical means this dictionary can later move straight into native VS Code
 * snippet files (or be served through a CompletionItemProvider) unchanged.
 */
export interface ApexSnippet {
  /** What the user types to trigger the suggestion (e.g. "sd"). */
  prefix: string;
  /** Display text in the popup; also prefix-matched while typing, so a label of
   *  "System.debug" is suggested when the user types "system". Defaults to prefix. */
  label?: string;
  /** Inserted text. May use $0 / $1 / ${1:placeholder}. */
  body: string;
  /** Optional hint shown to the right of the suggestion. */
  description?: string;
}

/** Built-in starter set. User entries from `apexEditor.customSnippets` are
 *  merged on top and override a built-in when they share the same prefix. */
export const BUILTIN_SNIPPETS: ApexSnippet[] = [
  { prefix: 'sd', label: 'System.debug', body: 'System.debug($0);', description: 'Debug log' },
  { prefix: 'sdj', label: 'System.debug(JSON)', body: 'System.debug(JSON.serializePretty($0));', description: 'Debug as JSON' },
  { prefix: 'soql', label: 'SOQL query', body: '[SELECT Id FROM $0]', description: 'Inline query' },
  { prefix: 'fore', label: 'for (each)', body: 'for (${1:SObject} ${2:item} : ${3:items}) {\n  $0\n}', description: 'For-each loop' },
  { prefix: 'forl', label: 'for (index)', body: 'for (Integer ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n  $0\n}', description: 'Indexed loop' },
  { prefix: 'ins', label: 'insert', body: 'insert $0;', description: 'DML insert' },
  { prefix: 'upd', label: 'update', body: 'update $0;', description: 'DML update' },
  { prefix: 'try', label: 'try / catch', body: 'try {\n  $0\n} catch (Exception e) {\n  System.debug(e.getMessage());\n}', description: 'Try / catch' },
  { prefix: 'ifb', label: 'if block', body: 'if ($1) {\n  $0\n}', description: 'If block' },
  { prefix: 'map', label: 'Map literal', body: 'Map<${1:Id}, ${2:SObject}> ${3:byId} = new Map<${1:Id}, ${2:SObject}>($0);', description: 'New map' },
  { prefix: 'lim', label: 'Limits debug', body: "System.debug('Queries: ' + Limits.getQueries() + '/' + Limits.getLimitQueries());", description: 'Governor limits' },
  { prefix: 'qrun', label: 'Query + loop', body: 'for (${1:Account} ${2:a} : [SELECT Id FROM ${1:Account}]) {\n  $0\n}', description: 'Query and iterate' }
];

/**
 * Merge user-configured snippets over the built-ins. A user entry replaces a
 * built-in with the same `prefix`; otherwise it is appended. Malformed entries
 * (missing prefix/body, wrong types) are dropped. `body` may be a string or an
 * array of strings (joined with newlines) to match VS Code's snippet format.
 *
 * Accepts `unknown` because it is fed straight from untrusted settings JSON.
 */
export function mergeSnippets(custom: unknown): ApexSnippet[] {
  const byPrefix = new Map<string, ApexSnippet>();
  for (const s of BUILTIN_SNIPPETS) {
    byPrefix.set(s.prefix, s);
  }
  if (Array.isArray(custom)) {
    for (const raw of custom) {
      const normalized = normalizeSnippet(raw);
      if (normalized) {
        byPrefix.set(normalized.prefix, normalized);
      }
    }
  }
  return [...byPrefix.values()];
}

function normalizeSnippet(raw: unknown): ApexSnippet | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const prefix = typeof o.prefix === 'string' ? o.prefix.trim() : '';
  const body = Array.isArray(o.body)
    ? o.body.filter(x => typeof x === 'string').join('\n')
    : typeof o.body === 'string'
      ? o.body
      : '';
  if (!prefix || !body) {
    return null;
  }
  const snippet: ApexSnippet = { prefix, body };
  if (typeof o.label === 'string' && o.label.trim()) {
    snippet.label = o.label.trim();
  }
  if (typeof o.description === 'string' && o.description.trim()) {
    snippet.description = o.description.trim();
  }
  return snippet;
}
