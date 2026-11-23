import { StyleSheet, Text } from 'react-native';

import type { ContinueOffer } from '../game/continue';
import { appStore } from '../state/app';
import { useStore } from '../state/store';
import { ContinueWithAd } from './AdOffer';
import { Button } from './controls';
import { colors, type } from './theme';

interface LevelFailureProps {
  /** The level attempt that ended, on either board size. */
  sessionId: string;
  /** True when it ended on the mistake limit rather than the clock. */
  byMistakes: boolean;
  /** What one ad can still add to this attempt; null when nothing is left. */
  offer: ContinueOffer | null;
  onRetry: () => void;
  onLevels: () => void;
  disabled?: boolean;
}

/**
 * Actions after a level ends early. One optional ad adds one more mistake, or more time,
 * so play can continue; the ad never starts unless the player asks for it.
 */
export function LevelFailure({ sessionId, byMistakes, offer, onRetry, onLevels, disabled }: LevelFailureProps) {
  const canRequestAds = useStore(appStore, (s) => s.ads.canRequestAds);
  const adBusy = useStore(appStore, (s) => s.reward.phase !== 'idle');
  const busy = adBusy || !!disabled;

  return (
    <>
      {offer ? (
        <ContinueWithAd sessionId={sessionId} offer={offer} scope="level" explainUnavailable disabled={disabled} style={styles.action} />
      ) : (
        <Text style={styles.note}>
          {byMistakes ? 'You have used every extra mistake for this level.' : 'You have used all the extra time for this level.'}
        </Text>
      )}
      <Button label="Retry level" icon="refresh" variant={offer && canRequestAds ? 'secondary' : 'primary'} onPress={onRetry} disabled={busy} style={styles.action} />
      <Button label="Levels" icon="list-outline" onPress={onLevels} disabled={busy} style={styles.action} />
    </>
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: 'stretch' },
  note: { ...type.dim, color: colors.textDim, textAlign: 'center' },
});
