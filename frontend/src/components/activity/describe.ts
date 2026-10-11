// One plain sentence per tool call or script, for the folded steps of the live panel.

export function scriptName(s?: string) {
  if (!s) return 'a script';
  const file = s.match(/([\w.-]+\.(py|ts|js))/);
  if (file) return file[1];
  if (s.startsWith('npx ')) return s.length > 56 ? `${s.slice(0, 56)}…` : s;
  return s.split(' ')[0];
}

/** A tool call's input: whatever JSON the model sent, so every field is read with the helpers below. */
export type ToolInput = Record<string, unknown>;

/** Tool inputs arrive as JSON cut at 300 characters; read what can be read (the last value may be cut short). */
export function parse(input?: string): ToolInput {
  if (!input) return {};
  try {
    const value: unknown = JSON.parse(input);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as ToolInput;
  } catch { /* cut short: fall back to the "key": "value" pairs, the last one possibly partial */ }
  const out: ToolInput = {};
  for (const m of input.matchAll(/"(\w+)":\s*"((?:[^"\\]|\\.)*)/g)) out[m[1]] = m[2];
  return out;
}

export function pretty(input?: string) {
  try { return JSON.stringify(JSON.parse(input ?? ''), null, 2); } catch { return input ?? ''; }
}

/** The first of the given fields that holds text (or a number), as text. */
function field(a: ToolInput, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = a[k];
    if (typeof v === 'string' || typeof v === 'number') return String(v);
  }
  return undefined;
}

/** A field that holds a list, joined; or the field as text. */
function list(a: ToolInput, key: string): string | undefined {
  const v = a[key];
  return Array.isArray(v) ? v.map(String).join(', ') : field(a, key);
}

const q = (s?: string) => (s ? `“${s}”` : '');

/** One plain sentence per tool call. Unknown tools fall back to their name and first value. */
export function describe(tool: string, a: ToolInput): string {
  const t = tool.replace(/^.*\//, '').replace(/^mcp_[\w-]+?_/, '');
  const target = field(a, 'element', 'name', 'ref');
  const test = a.test && typeof a.test === 'object' ? field(a.test as ToolInput, 'title') : undefined;
  switch (t) {
    case 'read_kit_file': case 'read': case 'read_file': return `Read ${field(a, 'path', 'file') ?? 'a file'}`;
    case 'search': case 'grep': case 'search_kit': return `Searched for ${q(field(a, 'query', 'pattern'))}`;
    case 'list_files': case 'list_dir': return `Listed ${field(a, 'path') ?? 'files'}`;
    case 'write_file': case 'edit_file': case 'edit': return `Wrote ${field(a, 'path', 'file') ?? 'a file'}`;
    case 'run_script': return `Ran ${field(a, 'script', 'name') ?? 'a script'}`;
    case 'browser_navigate': return `Opened ${field(a, 'url') ?? 'a page'}`;
    case 'browser_navigate_back': return 'Went back';
    case 'browser_click': return `Clicked ${q(target)}`;
    case 'browser_type': return `Typed ${field(a, 'text') ? q(field(a, 'text')) + ' ' : ''}into ${q(target)}`;
    case 'browser_fill_form': return 'Filled in a form';
    case 'browser_select_option': return `Chose ${q(list(a, 'values'))} in ${q(target)}`;
    case 'browser_hover': return `Pointed at ${q(target)}`;
    case 'browser_press_key': return `Pressed ${field(a, 'key') ?? 'a key'}`;
    case 'browser_snapshot': return 'Looked at the page';
    case 'browser_take_screenshot': return 'Took a screenshot';
    case 'browser_wait_for': return field(a, 'text') ? `Waited for ${q(field(a, 'text'))}` : 'Waited';
    case 'browser_handle_dialog': return a.accept ? 'Accepted a dialog' : 'Dismissed a dialog';
    case 'browser_console_messages': return 'Read the console';
    case 'browser_network_requests': return 'Read the network requests';
    case 'planner_setup_page': case 'generator_setup_page': return `Opened the app from ${field(a, 'seedFile') ?? 'the seed'}`;
    case 'generator_read_log': return 'Read what it did in the browser';
    case 'generator_write_test': return `Wrote ${field(a, 'fileName') ?? 'the test'}`;
    case 'test_run': return `Ran ${list(a, 'locations') ?? 'tests'}`;
    case 'test_debug': return `Debugged ${test ?? 'a test'}`;
    case 'test_list': return 'Listed the tests';
    case 'map_login_page': return `Had Playwright's planner look at the login page${field(a, 'start') ? ` (${field(a, 'start')})` : ''}`;
    case 'write_login_ts': return 'Wrote tests/login.ts';
    case 'check_login': return 'Checked that every account logs in';
    default: {
      const first = Object.values(a).find((v): v is string => typeof v === 'string');
      const words = t.replace(/_/g, ' ');
      return first ? `${words[0].toUpperCase()}${words.slice(1)} ${q(first.length > 60 ? first.slice(0, 60) + '…' : first)}` : words;
    }
  }
}
