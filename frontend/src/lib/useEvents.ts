import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Event } from '../api';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

/** Events after which the data on screen may have changed, so the given queries are refreshed. */
const MILESTONES = new Set(['stage', 'run', 'waiting', 'answered', 'script_end', 'agent_end', 'finding']);

/**
 * Live events of a run (or the app channel) over Server-Sent Events.
 *
 * A browser keeps at most 6 connections per server and each live feed holds one open, so with several Studio tabs
 * every other request queued forever. A hidden tab therefore closes its feed and reopens it when shown again; the
 * server replays the channel and events already shown are skipped by sequence number.
 */
export function useEvents(channelUrl: string | null, refresh: unknown[][] = []) {
  const [events, setEvents] = useState<Event[]>([]);
  const [live, setLive] = useState<LiveStatus>('connecting');
  // A new channel starts empty: reset during render (React's pattern for state that follows an input), not in
  // the effect, so the old channel's events are never shown under the new one.
  const [channel, setChannel] = useState(channelUrl);
  if (channel !== channelUrl) {
    setChannel(channelUrl);
    setEvents([]);
    setLive('connecting');
  }
  const qc = useQueryClient();
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; });

  useEffect(() => {
    if (!channelUrl) return;
    let lastSeq = 0;
    let dead = false;
    let es: EventSource | null = null;
    const refreshAll = () => { for (const key of refreshRef.current) qc.invalidateQueries({ queryKey: key }); };

    const open = () => {
      if (es || dead) return;
      es = new EventSource(channelUrl);
      es.onopen = () => { if (!dead) setLive('live'); };
      es.onerror = () => { if (!dead) setLive('reconnecting'); };
      es.onmessage = msg => {
        const e = JSON.parse(msg.data) as Event;
        if (e.seq <= lastSeq) return;
        lastSeq = e.seq;
        setEvents(prev => (prev.length > 3000 ? [...prev.slice(-2500), e] : [...prev, e]));
        if (MILESTONES.has(e.type)) refreshAll();
      };
    };
    const close = () => { es?.close(); es = null; };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { close(); return; }
      setLive('connecting');
      open();
      refreshAll();
    };

    if (document.visibilityState !== 'hidden') open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { dead = true; close(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [channelUrl, qc]);

  return { events, live };
}
