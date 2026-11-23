import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { techniqueDisplayName } from '../game/drills';
import { TECHNIQUE_PACKS, logicalFrame, nextGuidePath } from '../game/learning';
import { EMPTY_OVERLAY, MARK_TARGET, type Overlay, overlayForCells } from '../game/overlay';
import { type Session, clearIncorrect, incorrectCells } from '../game/session';
import { mutateSession } from '../state/app';
import { Button, Card } from './controls';
import { colors, spacing, type } from './theme';

interface Props {
  session: Session;
  onOverlay: (overlay: Overlay) => void;
  onApply: (cell: number, digit: number) => void;
  onClose: () => void;
  onExample: () => void;
}

export function TechniqueGuide({ session, onOverlay, onApply, onClose, onExample }: Props) {
  const [index, setIndex] = useState(0);
  const { values, solution, techniquePack } = session;
  const path = useMemo(() => nextGuidePath(values, solution), [values, solution]);
  const shownIndex = path ? Math.min(index, path.steps.length - 1) : 0;
  const frame = useMemo(() => path ? logicalFrame(path, shownIndex) : null, [path, shownIndex]);
  const wrong = useMemo(() => frame ? [] : incorrectCells(session), [frame, session]);

  useEffect(() => {
    onOverlay(frame?.overlay ?? (wrong.length ? overlayForCells(wrong, MARK_TARGET) : EMPTY_OVERLAY));
  }, [frame, onOverlay, wrong]);

  if (!frame || !path) {
    return (
      <Card style={styles.panel}>
        <Text style={type.heading} accessibilityRole="header">{wrong.length ? 'Fix your entries' : 'Try a different approach'}</Text>
        <Text style={type.dim}>
          {wrong.length ? 'Clear the marked entries to continue the guide.' : 'See a worked example of the technique using this puzzle.'}
        </Text>
        <Button
          label={wrong.length ? 'Clear incorrect entries' : 'See technique example'}
          variant="primary"
          onPress={wrong.length ? () => {
            setIndex(0);
            mutateSession(session.slot, clearIncorrect);
          } : onExample}
        />
        <Button label="Back to puzzle" variant="ghost" onPress={onClose} />
      </Card>
    );
  }

  const { step } = frame;
  const placement = step.placement;
  const isFocus = techniquePack && TECHNIQUE_PACKS[techniquePack].techniques.includes(step.technique);

  return (
    <Card style={styles.panel}>
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">{techniqueDisplayName(step.technique)}</Text>
        {path.steps.length > 1 && <Text style={styles.step}>{shownIndex + 1} / {path.steps.length}</Text>}
      </View>
      {isFocus && <Text style={styles.step}>Pack technique</Text>}
      <Text style={type.body} accessibilityLiveRegion="polite">{step.explanation}</Text>
      <Button
        label={placement ? `Place ${placement.digit}` : 'Next step'}
        variant="primary"
        onPress={placement ? () => onApply(placement.cell, placement.digit) : () => setIndex(shownIndex + 1)}
      />
      <Button
        label={shownIndex > 0 ? 'Previous step' : 'Back to puzzle'}
        variant="ghost"
        onPress={shownIndex > 0 ? () => setIndex(shownIndex - 1) : onClose}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  panel: { padding: spacing.md, gap: spacing.sm, borderColor: colors.accentEdge },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  title: { ...type.heading, flexGrow: 1, flexShrink: 1 },
  step: { ...type.label, color: colors.accent },
});
