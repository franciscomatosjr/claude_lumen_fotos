import { Plus } from 'lucide-react';
import { useId, useState } from 'react';

/** Free-text tag entry with autocomplete from tags already in the library. Enter or comma adds. */
export function TagInput({ allTags, onAdd, autoFocus, placeholder = 'Adicionar tag…' }: { allTags: string[]; onAdd: (tags: string[]) => void; autoFocus?: boolean; placeholder?: string }) {
  const [value, setValue] = useState('');
  const listId = useId();
  const submit = () => {
    const tags = value.split(',').map(t => t.trim()).filter(Boolean);
    if (tags.length) onAdd(tags);
    setValue('');
  };
  return (
    <form
      className="flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2 dark:border-white/15 dark:bg-white/5"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        list={listId}
        value={value}
        autoFocus={autoFocus}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          // Keep viewer shortcuts (arrows, F, Delete) from firing while typing.
          e.stopPropagation();
          if (e.key === ',') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
      />
      <datalist id={listId}>
        {allTags.map(t => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <button type="submit" aria-label="Adicionar" className="opacity-60 hover:opacity-100">
        <Plus size={16} />
      </button>
    </form>
  );
}
