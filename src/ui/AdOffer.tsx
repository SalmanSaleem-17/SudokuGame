import { useEffect, useState } from 'react';
import { type StyleProp, StyleSheet, Text, type ViewStyle } from 'react-native';

import type { RewardOutcome } from '../ads/rewardController';
import type { ContinueOffer } from '../game/continue';
import { formatExtraTime } from '../game/continue';
import { appStore, clearRewardOutcome, watchAdToContinue } from '../state/app';
import { useStore } from '../state/store';
import { adOutcomeMessage } from './adPrompt';
import { Button } from './controls';
import { colors, type } from './theme';

interface AdOfferProps {
  /** Says what the ad gives, for example "Watch ad: +30 seconds". */
  label: string;
  detail?: string;
  /** Starts the ad. Called only from the player's tap on this button. */
  onWatch: () => Promise<RewardOutcome>;
  /** Finishes "The ad was closed before it finished, so …". */
  lost: string;
  /** Shown in place of the button while ads cannot be requested. Leave out to show nothing. */
  unavailable?: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A button that offers one optional rewarded ad and reports how the attempt went. An ad
 * never starts on its own: only this button, pressed by the player, starts one.
 */
export function AdOffer({ label, detail, onWatch, lost, unavailable, variant = 'secondary', disabled, style }: AdOfferProps) {
  const canRequestAds = useStore(appStore, (s) => s.ads.canRequestAds);
  const adsSimulated = useStore(appStore, (s) => s.adsSimulated);
  const reward = useStore(appStore, (s) => s.reward);
  const [asked, setAsked] = useState(false);
  const adBusy = reward.phase !== 'idle';

  useEffect(() => () => clearRewardOutcome(), []);

  if (!canRequestAds) return unavailable ? <Text style={styles.note}>{unavailable}</Text> : null;

  const watch = () => {
    // The controller also refuses overlapping attempts; this keeps the button inert meanwhile.
    if (adBusy || disabled) return;
    setAsked(true);
    void onWatch();
  };

  const outcome = asked && !adBusy ? reward.lastOutcome : null;
  const message = !asked ? null
    : adBusy ? (reward.phase === 'loading' ? 'Loading ad…' : 'Ad playing…')
      : outcome ? adOutcomeMessage(outcome, lost) : null;
  const details = [detail, adsSimulated ? 'simulated ad' : null].filter(Boolean).join(' · ');

  return (
    <>
      <Button label={label} detail={details || undefined} variant={variant} icon="play-circle-outline"
        onPress={watch} disabled={adBusy || disabled} style={style} />
      {message && <Text accessibilityLiveRegion="polite" style={styles.note}>{message}</Text>}
    </>
  );
}

interface ContinueWithAdProps {
  /** The game that ended, on any board size. */
  sessionId: string;
  offer: ContinueOffer;
  /** How the game is named in the button: a level attempt or a Play Now game. */
  scope: 'level' | 'game';
  /** Say so when ads are unavailable, instead of showing nothing. */
  explainUnavailable?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Offers to continue a game that ended on its mistake limit or its clock. */
export function ContinueWithAd({ sessionId, offer, scope, explainUnavailable, disabled, style }: ContinueWithAdProps) {
  const time = offer.kind === 'time';
  return (
    <AdOffer
      label={time ? `Watch ad: +${formatExtraTime(offer.seconds)}` : 'Watch ad: +1 mistake'}
      detail={`${offer.left} of ${offer.max} left for this ${scope}`}
      lost={time ? 'no time was added' : 'no mistake was added'}
      unavailable={explainUnavailable ? `Ads are unavailable right now, so this ${scope} cannot be continued.` : undefined}
      onWatch={() => watchAdToContinue(sessionId)}
      variant="primary"
      disabled={disabled}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  note: { ...type.dim, color: colors.textDim, textAlign: 'center' },
});
