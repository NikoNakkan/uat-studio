import { useCallback, useRef, useState } from 'react';
import { errorText } from './errors';

/**
 * One button press at a time: which action is busy, its error, and a guard against double clicks (a ref, so a
 * second click in the same render is refused too). Every page used to write this by hand.
 *
 *   const { busy, error, run } = useAction();
 *   <Button busy={busy === 'save'} disabled={!!busy} onClick={() => run('save', () => api.put(...))}>
 */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false);

  const run = useCallback(async <T,>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (lock.current) return undefined;
    lock.current = true;
    setBusy(name);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }, []);

  return { busy, error, setError, run };
}
