'use client';
/** Petits messages éphémères en bas de l'écran (erreurs, confirmations). */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'error' | 'ok' | 'info';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

type PushToast = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<PushToast>(() => {});

export function useToast(): PushToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback<PushToast>((message, kind = 'error') => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, message, kind }]);
    // Les infos (« À vous ! Terrain 2… ») arrivent sans qu'on les attende : on
    // laisse le temps de les lire.
    setTimeout(
      () => setToasts((list) => list.filter((t) => t.id !== id)),
      kind === 'ok' ? 3000 : kind === 'error' ? 5000 : 7000,
    );
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
