import { X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';

export const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-stone-950 hover:bg-accent-strong font-semibold',
  ghost: 'hover:bg-stone-200/70 dark:hover:bg-white/10',
  subtle: 'bg-stone-200/70 hover:bg-stone-300/70 dark:bg-white/10 dark:hover:bg-white/15',
  danger: 'bg-red-600 text-white hover:bg-red-700 font-semibold',
};

export function Button({ variant = 'subtle', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-40',
        variants[variant],
        className,
      )}
    />
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx('inline-flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-stone-200/70 dark:hover:bg-white/10 disabled:opacity-40', className)}
    >
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={e => e.stopPropagation()}
        className={cx('animate-fade-in w-full rounded-2xl bg-white shadow-2xl dark:bg-stone-900', wide ? 'max-w-2xl' : 'max-w-md')}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <IconButton label="Fechar" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-3 dark:border-white/10">{footer}</div>}
      </div>
    </div>
  );
}

export function Chip({ children, onRemove, onClick, tone = 'default' }: { children: ReactNode; onRemove?: () => void; onClick?: () => void; tone?: 'default' | 'suggested' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs',
        tone === 'suggested' ? 'border border-dashed border-accent/70 text-accent-strong dark:text-accent' : 'bg-stone-200/80 dark:bg-white/10',
      )}
    >
      {onClick ? (
        <button onClick={onClick} className="hover:underline">
          {children}
        </button>
      ) : (
        children
      )}
      {onRemove && (
        <button onClick={onRemove} aria-label="Remover" className="opacity-60 hover:opacity-100">
          <X size={12} />
        </button>
      )}
    </span>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center text-stone-500 dark:text-stone-400">
      <div className="text-stone-400 dark:text-stone-500">{icon}</div>
      <p className="text-lg font-medium text-stone-700 dark:text-stone-200">{title}</p>
      {children}
    </div>
  );
}
