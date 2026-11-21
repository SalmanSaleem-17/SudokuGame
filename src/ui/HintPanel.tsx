import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { CREDITS_PER_REWARD, RewardOutcome } from '../ads/rewardController';
import { TECHNIQUE_NAMES } from '../engine/techniques';
import { evaluateHint } from '../game/hintAccess';
import { EMPTY_OVERLAY, MARK_TARGET, Overlay, overlayForCells, overlayForHintStep } from '../game/overlay';
import { Session, clearIncorrect } from '../game/session';
import { appStore, clearRewardOutcome, mutateSession, revealHint, watchRewardedAd } from '../state/app';
import { useStore } from '../state/store';
import { Button } from './controls';
import { colors, radius, spacing, type } from './theme';

interface HintPanelProps {
  session: Session;
  onOverlay: (overlay: Overlay) => void;
  onApply: (cell: number, digit: number) => void;
  onClose: () => void;
  onPractice: () => void;
}

type View_ = 'hint' | 'earnConfirm' | 'earnStatus';

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
export function HintPanel({ session, onOverlay, onApply, onClose, onPractice }: HintPanelProps) {
  const credits = useStore(appStore, (s) => s.credits);
  const ads = useStore(appStore, (s) => s.ads);
  const adsSimulated = useStore(appStore, (s) => s.adsSimulated);
  const reward = useStore(appStore, (s) => s.reward);
  const [view, setView] = useState<View_>('hint');
  const [stepIndex, setStepIndex] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

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
      onPress={() => {
        clearRewardOutcome();
        setView('earnConfirm');
      }}
    />
  ) : (
    <Text style={styles.status}>Hint credits can&apos;t be earned right now because ads are unavailable.</Text>
  );

  let content;
  if (view === 'earnConfirm') {
    content = (
      <>
        <Text style={type.heading}>Watch one ad to earn {CREDITS_PER_REWARD} hint credits</Text>
        <Text style={type.dim}>
          Credits stay on this device, never expire and work offline. Your puzzle and timer are paused while the ad plays.
          {adsSimulated ? ' This is a simulated test ad (development build).' : ''}
        </Text>
        <View style={styles.actions}>
          <Button label="Not now" onPress={() => setView('hint')} style={styles.flex} />
          <Button label="Watch ad" variant="primary" icon="play" onPress={watch} disabled={adBusy} style={styles.flex} />
        </View>
      </>
    );
  } else if (view === 'earnStatus') {
    content = adBusy ? (
      <>
        <Text style={type.heading}>{reward.phase === 'loading' ? 'Loading ad…' : 'Ad playing…'}</Text>
        <Text style={type.dim}>Your puzzle is paused and will be exactly as you left it.</Text>
      </>
    ) : (
      <>
        <Text style={type.heading}>{reward.lastOutcome?.kind === 'earned' ? 'Credits earned' : 'No credits earned'}</Text>
        <Text style={type.body} accessibilityLiveRegion="polite">
          {outcomeMessage(reward.lastOutcome, credits) || 'No ad is available right now.'}
        </Text>
        <View style={styles.actions}>
          <Button label="Practice" onPress={onPractice} style={styles.flex} />
          {reward.lastOutcome?.kind === 'earned' ? (
            <Button label="Back to hint" variant="primary" onPress={() => setView('hint')} style={styles.flex} />
          ) : (
            <Button label="Continue playing" variant="primary" onPress={onClose} style={styles.flex} />
          )}
        </View>
      </>
    );
  } else if (steps && step) {
    const index = Math.min(stepIndex, steps.length - 1);
    const last = index === steps.length - 1;
    content = (
      <>
        <View style={styles.titleRow}>
          <Text style={[type.heading, styles.flex]}>{TECHNIQUE_NAMES[step.technique]}</Text>
          {steps.length > 1 && (
            <Text style={type.label}>
              STEP {index + 1} OF {steps.length}
            </Text>
          )}
        </View>
        <ScrollView style={styles.scroll}>
          <Text style={type.body} accessibilityLiveRegion="polite">
            {step.explanation}
          </Text>
        </ScrollView>
        <View style={styles.actions}>
          {index > 0 ? (
            <Button label="Back" onPress={() => setStepIndex(index - 1)} style={styles.flex} />
          ) : (
            <Button label="Close" onPress={onClose} style={styles.flex} />
          )}
          {last ? (
            <Button
              label={`Place ${step.placement?.digit ?? ''}`}
              variant="primary"
              onPress={() => step.placement && onApply(step.placement.cell, step.placement.digit)}
              style={styles.flex}
            />
          ) : (
            <Button label="Next" variant="primary" onPress={() => setStepIndex(index + 1)} style={styles.flex} />
          )}
        </View>
      </>
    );
  } else if (offer.kind === 'available') {
    content = (
      <>
        <Text style={type.heading}>Step-by-step hint</Text>
        <Text style={type.dim}>
          {offer.cost === 'free'
            ? 'Each puzzle includes one free hint. It explains the next logical move before you place anything.'
            : `Your free hint for this puzzle is used. This hint costs 1 credit. You have ${credits}.`}
        </Text>
        {revealError && <Text style={styles.error}>{revealError}</Text>}
        <View style={styles.actions}>
          <Button label="Close" onPress={onClose} style={styles.flex} />
          <Button
            label={offer.cost === 'free' ? 'Show free hint' : 'Use 1 credit'}
            variant="primary"
            icon="bulb-outline"
            onPress={reveal}
            disabled={revealing}
            style={styles.flex}
          />
        </View>
        {earnAction}
      </>
    );
  } else if (offer.kind === 'needCredits') {
    content = (
      <>
        <Text style={type.heading}>No hint credits</Text>
        <Text style={type.dim}>
          Your free hint for this puzzle is used and you have no credits. You can keep solving, or brush up in Practice,
          which is always free.
        </Text>
        <View style={styles.actions}>
          <Button label="Practice" onPress={onPractice} style={styles.flex} />
          <Button label="Continue playing" variant="primary" onPress={onClose} style={styles.flex} />
        </View>
        {earnAction}
      </>
    );
  } else if (offer.kind === 'blocked') {
    const n = offer.wrongCells.length;
    content = (
      <>
        <Text style={type.heading}>Fix {n === 1 ? 'an entry' : 'some entries'} first</Text>
        <Text style={type.dim}>
          {n === 1 ? 'One entry does' : `${n} entries do`} not match the solution, so no logical next step exists yet. Undo
          recent moves, or clear the incorrect {n === 1 ? 'entry' : 'entries'} below. No hint has been used.
        </Text>
        <View style={styles.actions}>
          <Button label="Show me" onPress={() => onOverlay(overlayForCells(offer.wrongCells, MARK_TARGET))} style={styles.flex} />
          <Button
            label="Clear incorrect"
            variant="primary"
            onPress={() => mutateSession(session.slot, clearIncorrect)}
            style={styles.flex}
          />
        </View>
        <Button label="Close" variant="ghost" onPress={onClose} />
      </>
    );
  } else {
    content = (
      <>
        <Text style={type.heading}>{offer.kind === 'complete' ? 'Puzzle complete' : 'No hint available'}</Text>
        <Text style={type.dim}>
          {offer.kind === 'complete'
            ? 'Every cell is filled in correctly.'
            : 'None of the supported techniques finds a next step from this position. No hint has been used.'}
        </Text>
        <View style={styles.actions}>
          <Button label="Practice" onPress={onPractice} style={styles.flex} />
          <Button label="Continue playing" variant="primary" onPress={onClose} style={styles.flex} />
        </View>
      </>
    );
  }

  return <View style={styles.panel}>{content}</View>;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  scroll: { maxHeight: 132 },
  actions: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  status: { ...type.dim, textAlign: 'center' },
  error: { ...type.dim, color: colors.warn },
});
