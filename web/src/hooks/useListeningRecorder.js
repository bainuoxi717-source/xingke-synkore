import { useEffect, useSyncExternalStore } from 'react';
import { listeningRecorder } from '../lib/listeningRecorder.js';
export function useListeningRecorder() {
  const state = useSyncExternalStore(listeningRecorder.subscribe, listeningRecorder.getSnapshot);
  useEffect(() => { listeningRecorder.initialize().catch(() => {}); }, []);
  return [state, listeningRecorder];
}
