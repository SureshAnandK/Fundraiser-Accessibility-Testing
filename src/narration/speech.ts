/** The parts of a Chromium accessibility node (CDP `Accessibility.AXNode`) that speech is built from. */
export interface AxValue {
  value?: unknown;
  sources?: { type: string; attribute?: string; nativeSource?: string; value?: { value?: unknown }; superseded?: boolean; invalid?: boolean }[];
}
export interface AxNode {
  ignored: boolean;
  role?: AxValue;
  name?: AxValue;
  description?: AxValue;
  value?: AxValue;
  properties?: { name: string; value: { value?: unknown } }[];
}

export interface Announcement {
  /** What is spoken. */
  phrase: string;
  role: string;
  /** The accessible name exactly as the browser exposes it. */
  name: string;
  /** Where the name came from: aria-label, aria-labelledby, label, contents, alt, title, placeholder; `none` when there is no name. */
  nameSource: string;
  states: string[];
  /** The name holds nothing a voice can say, so a screen reader has only the role to read. */
  silent: boolean;
}

/** Wording follows NVDA where the role name alone would not be what a user hears. */
const ROLE_WORDS: Record<string, string> = {
  textbox: 'edit',
  searchbox: 'search edit',
  combobox: 'combo box',
  listbox: 'list box',
  checkbox: 'check box',
  radio: 'radio button',
  spinbutton: 'spin button',
  menubar: 'menu bar',
  menuitem: 'menu item',
  menuitemcheckbox: 'menu item check box',
  menuitemradio: 'menu item radio button',
  tablist: 'tab list',
  tabpanel: 'tab panel',
  toolbar: 'tool bar',
  treeitem: 'tree item',
  listitem: 'list item',
  gridcell: 'grid cell',
  image: 'graphic',
  img: 'graphic',
  Iframe: 'frame',
  IframePresentational: 'frame',
  DisclosureTriangle: 'button',
  generic: '',
  none: '',
  presentation: '',
};

const EDITABLE = ['textbox', 'searchbox', 'combobox', 'slider', 'spinbutton'];

/** Icon fonts put private-use glyphs into names; a synthesizer reads them as noise or not at all. */
const UNSPEAKABLE = /[-\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;

/** A screen reader reads a name in full; the cap only stops a runaway name (a link round a whole article). */
const MAX_SPOKEN = 500;

const text = (value: AxValue | undefined) => String(value?.value ?? '');

function speakable(raw: string): string {
  const clean = raw.replace(UNSPEAKABLE, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > MAX_SPOKEN ? clean.slice(0, clean.lastIndexOf(' ', MAX_SPOKEN)) : clean;
}

function roleWord(role: string, level: unknown): string {
  if (role === 'heading') return level ? `heading level ${level}` : 'heading';
  return ROLE_WORDS[role] ?? role.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function statesOf(properties: Map<string, unknown>): string[] {
  const token = (name: string) => String(properties.get(name) ?? 'false');
  const states: string[] = [];
  if (properties.has('checked')) states.push({ true: 'checked', mixed: 'half checked' }[token('checked')] ?? 'not checked');
  if (properties.has('pressed')) states.push({ true: 'pressed', mixed: 'half pressed' }[token('pressed')] ?? 'not pressed');
  if (properties.get('selected') === true) states.push('selected');
  if (properties.has('expanded')) states.push(properties.get('expanded') ? 'expanded' : 'collapsed');
  if (token('hasPopup') !== 'false') states.push('has popup');
  if (properties.get('required') === true) states.push('required');
  if (token('invalid') !== 'false') states.push('invalid entry');
  if (properties.get('readonly') === true) states.push('read only');
  if (properties.get('multiline') === true) states.push('multi line');
  if (properties.get('disabled') === true) states.push('unavailable');
  return states;
}

/** Sources are listed in priority order; the one in use is the first that produced a value. */
function nameSource(name: AxValue | undefined): string {
  if (!text(name).trim()) return 'none';
  const used = name?.sources?.find((s) => !s.superseded && !s.invalid && String(s.value?.value ?? '').trim());
  if (!used) return 'unknown';
  if (used.nativeSource) return used.nativeSource.startsWith('label') ? 'label' : used.nativeSource;
  return used.attribute ?? used.type;
}

/**
 * Turns an accessibility node into what a screen reader would say on landing on it: name, role,
 * states, value, description. This is a simulation built from the same data a screen reader is
 * given, not the output of one.
 */
export function announce(node: AxNode): Announcement {
  const properties = new Map((node.properties ?? []).map((p) => [p.name, p.value.value]));
  const role = text(node.role);
  const name = text(node.name);
  const spokenName = speakable(name);
  const silent = spokenName === '';
  const word = roleWord(role, properties.get('level'));
  const states = statesOf(properties);
  const value = EDITABLE.includes(role) ? speakable(text(node.value)) : '';
  const description = speakable(text(node.description));

  const parts = silent
    ? [`unlabelled ${word || 'element'}`, ...states, value, description]
    : [spokenName, word, ...states, value, description === spokenName ? '' : description];

  return { phrase: parts.filter(Boolean).join(', '), role, name, nameSource: nameSource(node.name), states, silent };
}
