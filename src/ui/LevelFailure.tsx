import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { MAX_EXTRA_MISTAKES } from '../game/levels';
import { appStore, clearRewardOutcome, watchAdForExtraMistake } from '../state/app';
import { useStore } from '../state/store';
import { Button } from './controls';
import { colors, type } from './theme';

interface LevelFailureProps {
  /** The level attempt that ended, on either board size. */
  sessionId: string;
  /** True when it ended on the mistake limit rather than the clock. */
  byMistakes: boolean;
  extraMistakes: number;
  /** An extra mistake can still be added to this attempt. */
  canContinue: boolean;
  onRetry: () => void;
  onLevels: () => void;
  disabled?: boolean;
}

/**
 * Actions after a level ends early. When it ended on mistakes, one optional ad adds one
 * more mistake so play can continue; the ad never starts unless the player asks for it.
 */
export function LevelFailure({ sessionId, byMistakes, extraMistakes, canContinue, onRetry, onLevels, disabled }: LevelFailureProps) {
  const canRequestAds = useStore(appStore, (s) => s.ads.canRequestAds);
  const adsSimulated = useStore(appStore, (s) => s.adsSimulated);
  const reward = useStore(appStore, (s) => s.reward);
  const [asked, setAsked] = useState(false);
  const adBusy = reward.phase !== 'idle';
  const busy = adBusy || !!disabled;
  const left = MAX_EXTRA_MISTAKES - extraMistakes;

  useEffect(() => () => clearRewardOutcome(), []);

  const watch = () => {
    // The controller also refuses overlapping attempts; this keeps the button inert meanwhile.
    if (busy) return;
    setAsked(true);
    void watchAdForExtraMistake(sessionId);
  };

  const outcome = asked && !adBusy ? reward.lastOutcome : null;
  const message = adBusy ? (reward.phase === 'loading' ? 'Loading ad…' : 'Ad playing…')
    : outcome?.kind === 'dismissed' ? 'The ad was closed before it finished, so no mistake was added.'
      : outcome?.kind === 'failed' ? (outcome.reason === 'offline' ? 'No ad could be loaded. You appear to be offline.' : 'No ad is available right now.')
        : null;

  return (
    <>
      {canContinue && canRequestAds && (
        <Button
          label="Watch ad: +1 mistake"
          detail={`${left} of ${MAX_EXTRA_MISTAKES} left for this level${adsSimulated ? ' · simulated ad' : ''}`}
          variant="primary"
          icon="play-circle-outline"
          onPress={watch}
          disabled={busy}
          style={styles.action}
        />
      )}
      {canContinue && !canRequestAds && <Text style={styles.note}>Ads are unavailable right now, so this level cannot be continued.</Text>}
      {byMistakes && !canContinue && <Text style={styles.note}>You have used every extra mistake for this level.</Text>}
      {message && <Text accessibilityLiveRegion="polite" style={styles.note}>{message}</Text>}
      <Button label="Retry level" icon="refresh" variant={canContinue && canRequestAds ? 'secondary' : 'primary'} onPress={onRetry} disabled={busy} style={styles.action} />
      <Button label="Levels" icon="list-outline" onPress={onLevels} disabled={busy} style={styles.action} />
    </>
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: 'stretch' },
  note: { ...type.dim, color: colors.textDim, textAlign: 'center' },
});
