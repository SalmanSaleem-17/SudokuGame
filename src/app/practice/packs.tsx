import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PUZZLES } from '../../data/pool';
import { DIFFICULTY_NAMES } from '../../engine/grader';
import { parseGrid } from '../../engine/grid';
import type { PuzzleRecord } from '../../engine/pool';
import { techniqueDisplayName } from '../../game/drills';
import {
  TECHNIQUE_PACK_IDS, TECHNIQUE_PACKS, candidateNotes, isTechniquePackId, logicalFrame, puzzlesForPack, techniqueExample,
  type TechniquePackId,
} from '../../game/learning';
import { appStore, startTechnique } from '../../state/app';
import { useStore } from '../../state/store';
import { Board } from '../../ui/Board';
import { Button, Card, type IconName, Screen } from '../../ui/controls';
import { useBoardSize } from '../../ui/hooks';
import { colors, gradients, radius, spacing, type } from '../../ui/theme';
import { useCompletionHistory } from '../../ui/useCompletionHistory';

const icons: Record<TechniquePackId, IconName> = { pairs: 'copy-outline', triples: 'layers-outline', 'x-wing': 'scan-outline' };
const emptyErrors = new Set<number>();
const ignoreCell = () => {};

export default function TechniquePacksScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ pack?: string; example?: string }>();
  const active = useStore(appStore, (s) => s.sessions.technique);
  const history = useCompletionHistory();
  const [expanded, setExpanded] = useState(false);
  const pack = isTechniquePackId(params.pack) ? params.pack : active?.techniquePack ?? TECHNIQUE_PACK_IDS[0];
  const info = TECHNIQUE_PACKS[pack];
  const puzzles = useMemo(() => puzzlesForPack(PUZZLES, pack), [pack]);
  const done = useMemo(() => new Set((history ?? []).filter((c) => c.techniquePack === pack).map((c) => c.puzzleId)), [history, pack]);
  const solved = puzzles.filter((puzzle) => done.has(puzzle.id)).length;
  const recommended = puzzles.find((puzzle) => !done.has(puzzle.id)) ?? puzzles[0];
  const requestedExample = puzzles.find(({ id }) => id === params.example);
  const examplePuzzle = requestedExample ?? (expanded ? recommended : undefined);
  const recommendedActive = active?.puzzleId === recommended?.id && active?.techniquePack === pack;
  const resume = () => router.push({ pathname: '/game', params: { slot: 'technique' } });

  function start(puzzle: PuzzleRecord) {
    if (active?.completed) return;
    const play = () => {
      startTechnique(puzzle, pack);
      resume();
    };
    if (active) {
      Alert.alert('Replace practice puzzle?', 'The current practice puzzle will be replaced.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start puzzle', onPress: play },
      ]);
    } else play();
  }

  if (requestedExample) {
    return (
      <Screen title={`${info.title} example`}>
        <ScrollView contentContainerStyle={styles.content}>
          <TechniqueExample puzzle={requestedExample} pack={pack} />
          <Button
            label={active?.puzzleId === requestedExample.id ? 'Back to puzzle' : 'Technique packs'}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace({ pathname: '/practice/packs', params: { pack } });
            }}
          />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen title="Technique Packs">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.tabs}>
          {TECHNIQUE_PACK_IDS.map((id) => (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: id === pack }}
              onPress={() => {
                setExpanded(false);
                router.setParams({ pack: id });
              }}
              style={({ pressed }) => [styles.tab, id === pack && styles.activeTab, pressed && styles.pressed]}>
              <Text style={[styles.tabText, id === pack && styles.activeText]}>{TECHNIQUE_PACKS[id].title}</Text>
            </Pressable>
          ))}
        </View>

        <Card style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name={icons[pack]} size={26} color={colors.purple} />
          </View>
          <Text style={type.title} accessibilityRole="header">{info.title}</Text>
          <Text style={type.body}>{info.description}</Text>
          <Text style={styles.progress}>
            {history ? `${solved} of ${puzzles.length} puzzles completed` : `${puzzles.length} full puzzles`}
          </Text>
        </Card>

        {active && (
          <Button
            label={active.completed ? 'Save practice result' : 'Resume practice puzzle'}
            detail={active.techniquePack ? TECHNIQUE_PACKS[active.techniquePack].title : undefined}
            icon="play-outline"
            trailingIcon="chevron-forward"
            variant={recommendedActive || active.completed ? 'primary' : 'secondary'}
            onPress={resume}
          />
        )}

        {recommended && (
          <View style={styles.actions}>
            {!recommendedActive && !active?.completed && (
              <Button
                label={solved === puzzles.length ? 'Replay a puzzle' : 'Play next puzzle'}
                detail={DIFFICULTY_NAMES[recommended.difficulty]}
                variant="primary"
                icon="play"
                disabled={history === undefined}
                onPress={() => start(recommended)}
              />
            )}
            <Button label={expanded ? 'Hide example' : 'See worked example'} icon="bulb-outline" onPress={() => setExpanded((value) => !value)} />
          </View>
        )}

        {examplePuzzle && <TechniqueExample puzzle={examplePuzzle} pack={pack} />}
      </ScrollView>
    </Screen>
  );
}

function TechniqueExample({ puzzle, pack }: { puzzle: PuzzleRecord; pack: TechniquePackId }) {
  const boardSize = useBoardSize(260, spacing.lg);
  const example = useMemo(() => techniqueExample(puzzle, pack), [puzzle, pack]);
  const frame = useMemo(() => example && logicalFrame(example, example.steps.length - 1), [example]);
  const givens = useMemo(() => parseGrid(puzzle.givens), [puzzle.givens]);
  if (!frame) return <Text style={type.dim}>This example could not be loaded.</Text>;
  return (
    <View style={styles.example}>
      <Board
        size={boardSize}
        values={frame.values}
        givens={givens}
        notes={candidateNotes(frame.overlay)}
        marks={frame.overlay.marks}
        selected={null}
        highlightDigit={0}
        errors={emptyErrors}
        onCellPress={ignoreCell}
        disabled
      />
      <Card style={styles.explanation}>
        <Text style={type.heading} accessibilityRole="header">{techniqueDisplayName(frame.step.technique)}</Text>
        <Text style={type.body}>{frame.step.explanation}</Text>
        <Text style={type.dim}>Solid outlines mark the pattern. Dashed outlines mark cells where candidates can be removed.</Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 592, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tab: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, backgroundColor: colors.surface, borderColor: colors.line },
  activeTab: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  tabText: { ...type.body, color: colors.textDim, fontWeight: '700' },
  activeText: { color: colors.accent },
  pressed: { opacity: 0.7 },
  hero: { padding: spacing.lg, gap: spacing.sm, borderColor: colors.purple, backgroundImage: gradients.panel },
  heroIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.purpleSoft, marginBottom: spacing.xs },
  progress: { ...type.label, color: colors.purple, marginTop: spacing.xs },
  actions: { gap: spacing.sm },
  example: { gap: spacing.md, alignItems: 'center' },
  explanation: { alignSelf: 'stretch', padding: spacing.lg, gap: spacing.sm },
});
