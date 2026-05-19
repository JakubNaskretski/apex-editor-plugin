import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

self.MonacoEnvironment = {
  getWorker: () => new Worker(URL.createObjectURL(new Blob([''], { type: 'text/javascript' })))
};

const APEX_KEYWORDS = [
  'abstract', 'activate', 'and', 'any', 'as', 'asc', 'autonomous',
  'begin', 'break', 'bulk', 'by',
  'case', 'cast', 'catch', 'class', 'collect', 'commit', 'continue',
  'date', 'datetime', 'decimal', 'default', 'delete', 'deploy', 'desc', 'do',
  'else', 'end', 'enum', 'exception', 'exit', 'export', 'extends',
  'false', 'final', 'finally', 'float', 'for', 'from', 'future',
  'get', 'global', 'group', 'having', 'if', 'implements', 'import', 'in',
  'inner', 'insert', 'instanceof', 'interface', 'integer', 'into',
  'join', 'last_90_days', 'last_month', 'last_n_days', 'last_week',
  'like', 'limit', 'list', 'long', 'loop',
  'map', 'merge', 'new', 'not', 'null', 'nulls',
  'object', 'of', 'on', 'or', 'outer', 'override',
  'package', 'parallel', 'pragma', 'private', 'protected', 'public',
  'retrieve', 'return', 'returns', 'rollback',
  'savepoint', 'search', 'select', 'set', 'short', 'sort', 'static',
  'string', 'super', 'switch',
  'testmethod', 'then', 'this', 'this_month', 'this_week', 'throw',
  'time', 'today', 'tolabel', 'tomorrow', 'transaction', 'trigger', 'true', 'try',
  'type', 'undelete', 'update', 'upsert', 'using',
  'virtual', 'void', 'webservice', 'when', 'where', 'while', 'with',
  'yesterday', 'boolean', 'blob', 'double',
];

const APEX_TYPES = [
  'String', 'Integer', 'Long', 'Double', 'Decimal', 'Boolean',
  'Date', 'DateTime', 'Time', 'Blob', 'ID', 'Id',
  'List', 'Map', 'Set', 'SObject', 'Object',
  'Database', 'Schema', 'System', 'Math', 'Limits',
  'ApexPages', 'PageReference',
  'Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'User', 'Task', 'Event',
];

monaco.languages.register({ id: 'apex', extensions: ['.cls', '.trigger', '.apex'] });

monaco.languages.setMonarchTokensProvider('apex', {
  keywords: APEX_KEYWORDS,
  typeKeywords: APEX_TYPES,
  operators: ['=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||',
    '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '+=', '-=', '*=', '/='],
  symbols: /[=><!~?:&|+\-*\/\^%]+/,

  tokenizer: {
    root: [
      [/@[a-zA-Z_]\w*/, 'annotation'],
      [/\[(?=\s*(?:SELECT|FIND|select|find)\b)/, { token: 'keyword.soql', next: '@soql' }],
      [/[a-zA-Z_$][\w$]*/, { cases: {
        '@keywords': 'keyword',
        '@typeKeywords': 'type',
        '@default': 'identifier',
      }}],
      { include: '@whitespace' },
      [/[{}()\[\]]/, '@brackets'],
      [/[;,.]/, 'delimiter'],
      [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
      [/\d*\.\d+([eE][\-+]?\d+)?[fFdD]?/, 'number.float'],
      [/0[xX][0-9a-fA-F]+/, 'number.hex'],
      [/\d+[lL]?/, 'number'],
      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/'/, { token: 'string.quote', bracket: '@open', next: '@string' }],
    ],
    soql: [
      [/\]/, { token: 'keyword.soql', next: '@pop' }],
      [/\b(?:SELECT|FROM|WHERE|AND|OR|NOT|IN|LIKE|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|WITH|USING|SCOPE|FOR|UPDATE|RETURNING|INCLUDES|EXCLUDES|ASC|DESC|NULLS|FIRST|LAST|TRUE|FALSE|NULL|TODAY|YESTERDAY|TOMORROW|LAST_WEEK|THIS_WEEK|NEXT_WEEK|LAST_MONTH|THIS_MONTH|NEXT_MONTH|LAST_90_DAYS|NEXT_90_DAYS|COUNT|MAX|MIN|SUM|AVG)\b/i, 'keyword.soql'],
      [/'[^']*'/, 'string'],
      [/\d+/, 'number'],
      [/[a-zA-Z_][\w.]*/, 'identifier'],
      [/[,()=!<>]/, 'operator'],
      { include: '@whitespace' },
    ],
    whitespace: [
      [/[ \t\r\n]+/, 'white'],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
    ],
    comment: [
      [/[^\/*]+/, 'comment'],
      [/\/\*/, 'comment', '@push'],
      [/\*\//, 'comment', '@pop'],
      [/[\/*]/, 'comment'],
    ],
    string: [
      [/[^\\']+/, 'string'],
      [/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
  },
});

monaco.languages.setLanguageConfiguration('apex', {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: "'", close: "'" },
  ],
  indentationRules: {
    increaseIndentPattern: /^.*\{[^}"']*$/,
    decreaseIndentPattern: /^(.*\*\/)?\s*\}[;\s]*$/,
  },
});

window.monaco = monaco;
