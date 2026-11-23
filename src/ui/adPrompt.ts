import { Alert } from 'react-native';

import type { RewardOutcome } from '../ads/rewardController';

/**
 * What to tell the player when an ad did not end in a reward. `lost` finishes the sentence
 * about an ad closed early, for example "no credits were added".
 */
export function adOutcomeMessage(outcome: RewardOutcome, lost: string): string | null {
  if (outcome.kind === 'dismissed') return `The ad was closed before it finished, so ${lost}.`;
  if (outcome.kind === 'failed') {
    return outcome.reason === 'offline' ? 'No ad could be loaded. You appear to be offline.' : 'No ad is available right now.';
  }
  return null;
}

interface AdPrompt {
  title: string;
  /** What the ad gives. Shown before anything starts. */
  message: string;
  /** Starts the ad. Runs only after the player chooses "Watch ad". */
  watch: () => Promise<RewardOutcome>;
  /** Shown once the reward has been applied. */
  earned?: string;
  lost: string;
}

/** Asks before showing a rewarded ad, for rewards offered from a tile or a small link. */
export function promptForAd({ title, message, watch, earned, lost }: AdPrompt) {
  Alert.alert(title, message, [
    { text: 'Not now', style: 'cancel' },
    {
      text: 'Watch ad',
      onPress: () => {
        void watch().then((outcome) => {
          const text = outcome.kind === 'earned' ? earned : adOutcomeMessage(outcome, lost);
          if (text) Alert.alert(title, text);
        });
      },
    },
  ], { cancelable: true });
}
