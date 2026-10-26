import { AlertCircle, Cloud, CloudOff, Loader2, LogOut } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useStore } from '../lib/store';
import { session } from '../sync/api';
import { signIn, signOut, syncNow, syncStatus } from '../sync/engine';
import { formatMB } from './Views';
import { Button, Modal, cx } from './ui';

const input = 'w-full rounded-lg border border-stone-300 bg-transparent px-3 py-2 outline-none focus:border-accent dark:border-white/15';

export function AuthDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await signIn(mode, email.trim(), password);
      onClose();
    } catch (err) {
      setError(err instanceof TypeError ? 'Sem conexão com o servidor' : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={mode === 'login' ? 'Entrar' : 'Criar conta'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Com uma conta, suas fotos ganham cópia de segurança na nuvem e álbuns, tags e edições aparecem em todos os seus aparelhos. A IA continua rodando só no seu dispositivo.
        </p>
        <input autoFocus type="email" required autoComplete="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} className={input} />
        <input
          type="password"
          required
          minLength={mode === 'signup' ? 8 : undefined}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          placeholder={mode === 'signup' ? 'Senha (mínimo de 8 caracteres)' : 'Senha'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          className={input}
        />
        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
            <AlertCircle size={14} /> {error}
          </p>
        )}
        <Button variant="primary" type="submit" disabled={busy}>
          {busy && <Loader2 size={15} className="animate-spin" />}
          {mode === 'login' ? 'Entrar' : 'Criar conta'}
        </Button>
        <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} className="text-sm text-stone-500 underline dark:text-stone-400">
          {mode === 'login' ? 'Não tem conta? Criar uma' : 'Já tem conta? Entrar'}
        </button>
      </form>
    </Modal>
  );
}

function statusLine(s: ReturnType<typeof syncStatus.get>) {
  switch (s.state) {
    case 'syncing':
      return { icon: <Loader2 size={13} className="animate-spin" />, text: s.uploading ? `Enviando ${s.uploading} ${s.uploading === 1 ? 'foto' : 'fotos'}…` : 'Sincronizando…' };
    case 'offline':
      return { icon: <CloudOff size={13} />, text: 'Sem conexão; as mudanças vão depois' };
    case 'quota':
      return { icon: <AlertCircle size={13} className="text-red-500" />, text: 'Espaço na nuvem cheio' };
    case 'error':
      return { icon: <AlertCircle size={13} className="text-red-500" />, text: 'Falha ao sincronizar', retry: true };
    default:
      return s.pending
        ? { icon: <Loader2 size={13} className="animate-spin" />, text: 'Mudanças aguardando envio' }
        : { icon: <Cloud size={13} className="text-accent" />, text: 'Tudo sincronizado' };
  }
}

/** Sidebar card: invitation to sign in, or the account with its sync state. */
export function AccountCard() {
  const s = useStore(session);
  const status = useStore(syncStatus);
  const [auth, setAuth] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);

  if (s.state === 'unknown') return null;
  if (s.state === 'signed-out')
    return (
      <>
        <button onClick={() => setAuth(true)} className="flex w-full items-center gap-2 rounded-xl bg-stone-100 p-3 text-left text-xs text-stone-600 hover:bg-stone-200/70 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10">
          <Cloud size={16} className="shrink-0 text-accent" />
          <span>
            <span className="block font-medium text-stone-900 dark:text-white">Entrar para fazer backup</span>
            Sincronize entre seus aparelhos
          </span>
        </button>
        {auth && <AuthDialog onClose={() => setAuth(false)} />}
      </>
    );

  const { account } = s;
  const line = statusLine(status);
  const used = Math.min(1, account.usedBytes / account.quotaBytes);
  return (
    <div className="rounded-xl bg-stone-100 p-3 text-xs text-stone-600 dark:bg-white/5 dark:text-stone-300">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-stone-900 dark:text-white" title={account.email}>
          {account.email}
        </span>
        <button onClick={() => setConfirmOut(true)} aria-label="Sair da conta" title="Sair" className="rounded p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-white/10 dark:hover:text-white">
          <LogOut size={14} />
        </button>
      </div>
      <p className="mt-1.5 flex items-center gap-1.5" aria-live="polite">
        {line.icon} {line.text}
        {line.retry && (
          <button onClick={() => void syncNow()} className="underline">
            Tentar de novo
          </button>
        )}
      </p>
      <div className="mt-2 h-1 overflow-hidden rounded bg-stone-200 dark:bg-white/10" role="meter" aria-label="Espaço usado na nuvem" aria-valuenow={Math.round(used * 100)}>
        <div className={cx('h-full', used > 0.9 ? 'bg-red-500' : 'bg-accent')} style={{ width: `${used * 100}%` }} />
      </div>
      <p className="mt-1 text-stone-400">
        {formatMB(account.usedBytes)} de {(account.quotaBytes / 1e9).toFixed(0)} GB
      </p>
      {confirmOut && (
        <Modal
          title="Sair da conta?"
          onClose={() => setConfirmOut(false)}
          footer={
            <>
              <Button onClick={() => setConfirmOut(false)}>Cancelar</Button>
              <Button variant="danger" onClick={() => void signOut()}>
                Sair e limpar este aparelho
              </Button>
            </>
          }
        >
          <p className="text-sm">
            As fotos já enviadas continuam na nuvem e voltam quando você entrar de novo. A cópia deste aparelho será apagada
            {status.pending || status.uploading ? (
              <strong className="text-red-600 dark:text-red-400"> — e ainda há mudanças não enviadas, que serão perdidas.</strong>
            ) : (
              '.'
            )}
          </p>
        </Modal>
      )}
    </div>
  );
}
