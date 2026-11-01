import { useEffect, useRef, type ReactNode } from 'react';
import { X, LoaderCircle, AlertCircle } from 'lucide-react';
import s from './App.module.css';
export function Loading() {
  return (
    <div className={s.loading} role="status">
      <LoaderCircle size={22} className={s.spin} /> Opening your workspace…
    </div>
  );
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <div className={s.error} role="alert">
      <AlertCircle size={17} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  ) : null;
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={s.modal}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className={s.modalHeader}>
        <h2>{title}</h2>
        <button className={s.iconButton} onClick={onClose} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={s.empty}>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function relativeDate(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
}
