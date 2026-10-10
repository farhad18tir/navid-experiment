import { useEffect, useState, type FormEvent } from 'react';
import { AdminApp } from './admin/AdminApp';
import { api } from './api';
import { SessionRunner } from './experiment/SessionRunner';

export function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function go(next: string): void {
    window.history.pushState({}, '', next);
    setPath(next);
  }

  if (path.startsWith('/admin')) return <AdminApp />;
  const run = /^\/run\/([^/]+)$/.exec(path);
  if (run?.[1]) return <SessionRunner sessionId={decodeURIComponent(run[1])} />;
  return <Join onStart={(sessionId) => go(`/run/${encodeURIComponent(sessionId)}`)} onAdmin={() => go('/admin')} />;
}

function Join({ onStart, onAdmin }: { onStart: (sessionId: string) => void; onAdmin: () => void }) {
  const [participantId, setParticipantId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const body = await api<{ sessionId: string }>('/api/join', {
        method: 'POST',
        body: JSON.stringify({ participantId: participantId.trim() }),
      });
      onStart(body.sessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ورود به جلسه ناموفق بود');
    }
  }

  return (
    <main className="stage">
      <h1>آزمایش تصمیم‌گیری و حافظه</h1>
      <form onSubmit={(event) => void submit(event)} className="panel">
        <p>شناسه‌ای را که پژوهشگر به شما داده وارد کنید.</p>
        <input value={participantId} onChange={(event) => setParticipantId(event.target.value)} placeholder="شناسه" />
        <button type="submit">ادامه</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      <button type="button" onClick={onAdmin}>
        ورود پژوهشگر
      </button>
    </main>
  );
}
