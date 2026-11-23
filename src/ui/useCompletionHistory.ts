import { useEffect, useState } from 'react';

import { listCompletions } from '../state/app';
import type { Completion } from '../storage/repository';
import { useScreenFocused } from './hooks';

export function useCompletionHistory(): Completion[] | null | undefined {
  const focused = useScreenFocused();
  const [completions, setCompletions] = useState<Completion[] | null>();

  useEffect(() => {
    if (!focused) return;
    let live = true;
    void listCompletions().then(
      (history) => {
        if (live) setCompletions(history);
      },
      () => {
        if (live) setCompletions(null);
      },
    );
    return () => { live = false; };
  }, [focused]);

  return completions;
}
