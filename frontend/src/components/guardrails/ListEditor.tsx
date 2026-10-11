import { useState } from 'react';
import { inputCls } from '../../ui';

/**
 * A list of short entries (sites, file paths, button names, words): each can be removed, new ones are typed
 * and added with Enter or Add. `locked` entries stay and say why.
 */
export function ListEditor({ label, hint, items, onChange, placeholder, locked = {}, mono = false }: {
  label: string; hint: string; items: string[]; onChange: (items: string[]) => void; placeholder: string;
  locked?: Record<string, string>; mono?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    if (value && !items.includes(value)) onChange([...items, value]);
    setDraft('');
  };
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{label}</legend>
      <p className="text-xs text-muted">{hint}</p>
      <ul className="flex flex-wrap gap-2" aria-label={label}>
        {items.map(item => (
          <li key={item} className={`flex items-center gap-1 rounded-md border border-line bg-surface-2 py-0.5 pl-2 pr-1 text-sm ${mono ? 'font-mono' : ''}`}>
            {item}
            {locked[item]
              ? <span className="px-1 text-xs text-muted" title={locked[item]}>always</span>
              : <button type="button" onClick={() => onChange(items.filter(i => i !== item))} aria-label={`Remove ${item}`}
                  className="rounded px-1 text-muted hover:bg-surface hover:text-bad">×</button>}
          </li>
        ))}
        {!items.length && <li className="text-sm text-muted">None.</li>}
      </ul>
      <div className="flex gap-2">
        <input className={`${inputCls} ${mono ? 'font-mono' : ''}`} value={draft} placeholder={placeholder} aria-label={`Add to ${label}`}
          onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} disabled={!draft.trim()}
          className="rounded-md border border-line px-3 text-sm font-medium hover:bg-surface-2 disabled:opacity-50">Add</button>
      </div>
    </fieldset>
  );
}
