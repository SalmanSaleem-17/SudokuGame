import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { CREDITS_PER_REWARD, RewardOutcome } from '../ads/rewardController';
import { techniqueDisplayName } from '../game/drills';
import { evaluateHint } from '../game/hintAccess';
import { EMPTY_OVERLAY, MARK_TARGET, Overlay, overlayForCells, overlayForHintStep } from '../game/overlay';
import { Session, clearIncorrect } from '../game/session';
import { appStore, clearRewardOutcome, mutateSession, revealHint, watchRewardedAd } from '../state/app';
import { useStore } from '../state/store';
import { Button } from './controls';
import { TOUCH, colors, gradients, radius, spacing, type } from './theme';

interface HintPanelProps {
  session: Session;
  width: number;
  onOverlay: (overlay: Overlay) => void;
  onApply: (cell: number, digit: number) => void;
  onClose: () => void;
  onPractice: () => void;
}

type HintView = 'hint' | 'earnConfirm' | 'earnStatus';
type HintAction = Pick<ComponentProps<typeof Button>, 'label' | 'onPress' | 'disabled'>;

function HintActions({ inline, secondary, primary }: { inline: boolean; secondary: HintAction; primary: HintAction }) {
  const main = <Button {...primary} variant="primary" style={[styles.action, inline && styles.primaryAction]} />;
  const alternate = <Button {...secondary} variant={inline ? 'secondary' : 'ghost'} style={[styles.action, inline && styles.secondaryAction]} />;

  return inline ? (
    <View style={[styles.actions, styles.inlineActions]}>{alternate}{main}</View>
  ) : (
    <View style={styles.actions}>{main}{alternate}</View>
  );
}

function outcomeMessage(outcome: RewardOutcome | null, credits: number): string {
  if (!outcome) return '';
  switch (outcome.kind) {
    case 'earned':
      return `${outcome.credits} hint credits added. You now have ${credits}.`;
    case 'dismissed':
      return 'The ad was closed before it finished, so no credits were added.';
    case 'busy':
      return 'An ad is already opening.';
    case 'failed':
      switch (outcome.reason) {
        case 'offline':
          return 'No ad could be loaded. You appear to be offline.';
        case 'consent':
          return 'Ads are turned off by your privacy choices, so credits cannot be earned.';
        case 'grant-error':
          return 'The reward could not be saved. No credits were added.';
        default:
          return 'No ad is available right now.';
      }
  }
}

/**
 * Hint flow shown in place of the keypad, so the board stays visible. Covers the free
 * hint, paid hints, blocked and unavailable states, and the opt-in rewarded ad.
 */
export function HintPanel({ session, width, onOverlay, onApply, onClose, onPractice }: HintPanelProps) {
  const credits = useStore(appStore, (s) => s.credits);
  const ads = useStore(appStore, (s) => s.ads);
  const adsSimulated = useStore(appStore, (s) => s.adsSimulated);
  const reward = useStore(appStore, (s) => s.reward);
  const [view, setView] = useState<HintView>('hint');
  const [stepIndex, setStepIndex] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const { fontScale } = useWindowDimensions();
  const inline = width >= 296 * Math.max(1, fontScale);

  const offer = useMemo(() => evaluateHint(session, credits), [session, credits]);
  const steps = offer.kind === 'owned' ? offer.hint.result.steps : null;
  const step = steps ? steps[Math.min(stepIndex, steps.length - 1)] : null;
  const adBusy = reward.phase !== 'idle';

  useEffect(() => {
    if (view === 'hint' && steps && step) {
      onOverlay(overlayForHintStep(session.values, steps, Math.min(stepIndex, steps.length - 1)));
    } else {
      onOverlay(EMPTY_OVERLAY);
    }
  }, [view, steps, step, stepIndex, session.values, onOverlay]);

  useEffect(() => () => clearRewardOutcome(), []);

  const reveal = useCallback(async () => {
    if (offer.kind !== 'available' || revealing) return;
    setRevealing(true);
    setRevealError(null);
    const result = await revealHint(session.slot, offer);
    setRevealing(false);
    setStepIndex(0);
    if (result === 'error') setRevealError('The hint could not be saved, so nothing was used. Please try again.');
  }, [offer, revealing, session.slot]);

  const watch = useCallback(async () => {
    // The controller also rejects overlapping attempts; this keeps the button inert meanwhile.
    if (adBusy) return;
    setView('earnStatus');
    await watchRewardedAd();
  }, [adBusy]);

  const earnAction = ads.canRequestAds ? (
    <Button
      label="Earn hint credits"
      icon="gift-outline"
      variant="ghost"
      style={styles.action}
      onPress={() => {
        clearRewardOutcome();
        setView('earnConfirm');
      }}
    />
  ) : (
    <Text style={styles.status}>Ads are unavailable right now.</Text>
  );

  let content;
  if (view === 'earnConfirm') {
    content = (
      <>
        <Text style={type.heading} accessibilityRole="header">Earn {CREDITS_PER_REWARD} hint credits</Text>
        <Text style={type.dim}>Finish one ad to earn credits. Your puzzle pauses during the ad. Credits stay on this device and work offline.</Text>
        {adsSimulated && <Text style={styles.status}>Simulated ad</Text>}
        <HintActions
          inline={inline}
          secondary={{ label: 'Not now', onPress: () => setView('hint') }}
          primary={{ label: 'Watch ad', onPress: watch, disabled: adBusy }}
        />
      </>
    );
  } else if (view === 'earnStatus') {
    content = adBusy ? (
      <>
        <Text style={type.heading} accessibilityRole="header" accessibilityLiveRegion="polite">
          {reward.phase === 'loading' ? 'Loading ad…' : 'Ad playing…'}
        </Text>
        <Text style={type.dim}>Your puzzle is paused.</Text>
      </>
    ) : (
      <>
        <Text style={type.heading} accessibilityRole="header">{reward.lastOutcome?.kind === 'earned' ? 'Credits earned' : 'No credits earned'}</Text>
        <Text style={type.body} accessibilityLiveRegion="polite">
          {outcomeMessage(reward.lastOutcome, credits) || 'No ad is available right now.'}
        </Text>
        <HintActions
          inline={inline}
          secondary={{ label: 'Practice', onPress: onPractice }}
          primary={reward.lastOutcome?.kind === 'earned'
            ? { label: 'Back to hint', onPress: () => setView('hint') }
            : { label: 'Keep playing', onPress: onClose }}
        />
      </>
    );
  } else if (steps && step) {
    const index = Math.min(stepIndex, steps.length - 1);
    const last = index === steps.length - 1;
    content = (
      <>
        <View style={styles.titleRow}>
          <Text style={[type.heading, styles.title]} accessibilityRole="header">{techniqueDisplayName(step.technique)}</Text>
          {steps.length > 1 && (
            <Text style={styles.stepCount}>Step {index + 1} of {steps.length}</Text>
          )}
        </View>
        <Text style={type.body} accessibilityLiveRegion="polite">{step.explanation}</Text>
        <HintActions
          inline={inline}
          secondary={index > 0 ? { label: 'Back', onPress: () => setStepIndex(index - 1) } : { label: 'Close', onPress: onClose }}
          primary={last
            ? { label: `Place ${step.placement?.digit ?? ''}`, onPress: () => step.placement && onApply(step.placement.cell, step.placement.digit) }
            : { label: 'Next', onPress: () => setStepIndex(index + 1) }}
        />
      </>
    );
  } else if (offer.kind === 'available') {
    content = (
      <>
        <Text style={type.heading} accessibilityRole="header">Step-by-step hint</Text>
        <Text style={type.dim}>
          {offer.cost === 'free'
            ? 'Use your free hint to see the next logical move.'
            : `This hint costs 1 credit. You have ${credits}.`}
        </Text>
        {revealError && <Text style={styles.error}>{revealError}</Text>}
        <HintActions
          inline={inline}
          secondary={{ label: 'Close', onPress: onClose }}
          primary={{ label: offer.cost === 'free' ? 'Show hint' : 'Use 1 credit', onPress: reveal, disabled: revealing }}
        />
        {earnAction}
      </>
    );
  } else if (offer.kind === 'needCredits') {
    content = (
      <>
        <Text style={type.heading} accessibilityRole="header">No hint credits</Text>
        <Text style={type.dim}>You’ve used this puzzle’s free hint. Practice is free.</Text>
        <HintActions inline={inline}
          secondary={{ label: 'Practice', onPress: onPractice }}
          primary={{ label: 'Keep playing', onPress: onClose }}
        />
        {earnAction}
      </>
    );
  } else if (offer.kind === 'blocked') {
    const n = offer.wrongCells.length;
    content = (
      <>
        <Text style={type.heading} accessibilityRole="header">Fix {n === 1 ? 'an entry' : 'some entries'} first</Text>
        <Text style={type.dim}>
          {n === 1 ? 'One entry needs' : `${n} entries need`} a correction before a hint can help. Your hint is still available.
        </Text>
        <HintActions
          inline={inline}
          secondary={{ label: 'Show errors', onPress: () => onOverlay(overlayForCells(offer.wrongCells, MARK_TARGET)) }}
          primary={{ label: 'Clear incorrect', onPress: () => mutateSession(session.slot, clearIncorrect) }}
        />
        <Button label="Close" variant="ghost" onPress={onClose} style={styles.action} />
      </>
    );
  } else {
    content = (
      <>
        <Text style={type.heading} accessibilityRole="header">{offer.kind === 'complete' ? 'Puzzle complete' : 'No hint available'}</Text>
        <Text style={type.dim}>
          {offer.kind === 'complete'
            ? 'Every cell is filled in correctly.'
            : 'No next move was found from this position. You still have your hint.'}
        </Text>
        <HintActions
          inline={inline}
          secondary={{ label: 'Practice', onPress: onPractice }}
          primary={{ label: 'Keep playing', onPress: onClose }}
        />
      </>
    );
  }

  return <View style={styles.panel}>{content}</View>;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    backgroundImage: gradients.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderTopColor: colors.accentEdge,
    padding: spacing.md,
    gap: spacing.md,
  },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  title: { flexGrow: 1, flexShrink: 1 },
  stepCount: { ...type.label, color: colors.accent },
  actions: { gap: spacing.sm },
  inlineActions: { flexDirection: 'row' },
  action: { minHeight: TOUCH, paddingHorizontal: spacing.sm },
  primaryAction: { flex: 1.25 },
  secondaryAction: { flex: 1 },
  status: { ...type.dim, textAlign: 'center' },
  error: { ...type.dim, color: colors.warn },
});
