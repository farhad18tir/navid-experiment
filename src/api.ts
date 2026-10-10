import type { ClientEvent } from '../protocol/events';
import type { StimulusPlan } from '../protocol/types';

export type SaveState = 'saved' | 'pending' | 'failed';

export interface PracticeResult {
  stage: string;
  practiceRound: number;
  accuracy: number;
  passed: boolean;
}

export interface EventResult {
  accepted: string[];
  plan: StimulusPlan;
  practice: PracticeResult | null;
}

export interface Outbox {
  send(events: ClientEvent[]): Promise<EventResult>;
  flush(): Promise<EventResult>;
  blocked(): boolean;
}

export function createOutbox(sessionId: string, onState: (state: SaveState) => void): Outbox {
  const key = `navid-outbox:${sessionId}`;
  let queue: ClientEvent[] = [];
  try {
    const stored = localStorage.getItem(key);
    queue = stored ? (JSON.parse(stored) as ClientEvent[]) : [];
  } catch {
    queue = [];
  }
  let chain: Promise<void> = Promise.resolve();
  let blocked = false;
  const empty: EventResult = { accepted: [], plan: null as unknown as StimulusPlan, practice: null };

  function persist(): void {
    localStorage.setItem(key, JSON.stringify(queue));
    onState(queue.length === 0 ? 'saved' : 'pending');
  }

  async function flush(): Promise<EventResult> {
    if (queue.length === 0) {
      onState('saved');
      return empty;
    }
    if (blocked) {
      onState('failed');
      return empty;
    }
    onState('pending');
    const response = await fetch(`/api/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: queue }),
    });
    if (!response.ok) {
      onState('failed');
      if (response.status >= 400 && response.status < 500) blocked = true;
      throw new Error(await errorText(response));
    }
    const body = (await response.json()) as EventResult;
    const accepted = new Set(body.accepted);
    queue = queue.filter((event) => !accepted.has(event.clientEventId));
    persist();
    return body;
  }

  function enqueue(events: ClientEvent[]): Promise<EventResult> {
    for (const event of events) {
      if (!queue.some((item) => item.clientEventId === event.clientEventId)) queue.push(event);
    }
    persist();
    const run = chain.then(flush);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return { send: enqueue, flush: () => enqueue([]), blocked: () => blocked };
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { error?: string };
    return body.error ?? text;
  } catch {
    return text;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      message = text;
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}
