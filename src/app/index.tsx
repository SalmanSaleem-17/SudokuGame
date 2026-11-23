import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { dateKeyOf } from '../game/daily';
import { LEVEL_COUNT } from '../game/levels';
import { DAILY_GIFT_CREDITS } from '../game/rewards';
import { listPlayNowSaves } from '../game/savedGames';
import { appStore, isDailyGiftReady, watchAdForDailyGift } from '../state/app';
import { useStore } from '../state/store';
import { promptForAd } from '../ui/adPrompt';
import { WORDMARK, WORDMARK_ASPECT_RATIO } from '../ui/Brand';
import { Button, IconButton, Screen, type IconName } from '../ui/controls';
import { useScreenFocused } from '../ui/hooks';
import { Motion } from '../ui/Motion';
import { colors, gradients, radius, spacing, TOUCH, type, useReducedMotion } from '../ui/theme';

const MORE_MODES: { label: string; icon: IconName; tint: string; href: Href }[] = [
  { label: 'Weekly Challenge', icon: 'medal-outline', tint: colors.purple, href: '/weekly' },
  { label: 'Mini Sudoku', icon: 'apps-outline', tint: colors.good, href: { pathname: '/alternate', params: { mode: 'mini' } } },
  { label: 'Sudoku Variants', icon: 'shapes-outline', tint: colors.blue, href: { pathname: '/alternate', params: { mode: 'variants' } } },
  { label: 'Challenge a Friend', icon: 'people-outline', tint: colors.accent, href: '/challenge' },
  { label: 'Practice', icon: 'school-outline', tint: colors.blue, href: '/practice' },
];

export default function HomeScreen() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const classic = useStore(appStore, (s) => s.sessions.classic);
  const mini = useStore(appStore, (s) => s.miniClassic);
  const daily = useStore(appStore, (s) => s.sessions.daily);
  const dailyCompleted = useStore(appStore, (s) => s.dailyCompleted);
  const credits = useStore(appStore, (s) => s.credits);
  const levelStars = useStore(appStore, (s) => s.levelStars);
  const levelsCleared = Object.values(levelStars).reduce((sum, stars) => sum + stars.filter((earned) => earned > 0).length, 0);
  const levelsTotal = Object.keys(levelStars).length * LEVEL_COUNT;
  const [moreOpen, setMoreOpen] = useState(false);
  useScreenFocused();
  const today = dateKeyOf(new Date());

  const dailyDetail = dailyCompleted.includes(today) ? 'Completed today'
    : daily?.dateKey === today && !daily.completed ? 'In progress'
    : "Today's challenge";
  const savedCount = listPlayNowSaves(classic, mini).length;
  const giftDay = useStore(appStore, (s) => s.giftDay);
  const canRequestAds = useStore(appStore, (s) => s.ads.canRequestAds);
  const giftReady = canRequestAds && isDailyGiftReady(giftDay);
  // The ad starts only if the player chooses it in this prompt.
  const offerGift = () => promptForAd({
    title: 'Daily gift',
    message: `Watch one ad to get ${DAILY_GIFT_CREDITS} hint credits. You can do this once a day.`,
    watch: watchAdForDailyGift,
    earned: `${DAILY_GIFT_CREDITS} hint credits added. A new gift is ready tomorrow.`,
    lost: 'no credits were added',
  });

  return (
    <Screen
      back={false}
      right={
        <View style={styles.shortcuts}>
          <IconButton icon="help-circle-outline" color={colors.good} label="How to Play" onPress={() => router.push('/how-to-play')} />
          <IconButton icon="bar-chart-outline" color={colors.blue} label="Statistics" onPress={() => router.push('/statistics')} />
          <IconButton icon="trophy-outline" color={colors.accent} label="Achievements" onPress={() => router.push('/achievements')} />
          <IconButton icon="settings-sharp" label="Settings" onPress={() => router.push('/settings')} />
        </View>
      }>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Motion reduced={reducedMotion} style={styles.hero}>
          <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.watermark}>
            {['1', '', '7', '', '9', '', '6', '', '3'].map((digit, index) => (
              <View key={index} style={styles.watermarkCell}>
                <Text allowFontScaling={false} style={styles.watermarkDigit}>{digit}</Text>
              </View>
            ))}
          </View>
          <View style={styles.wordmark}>
            <Image source={WORDMARK} style={styles.wordmarkImage} resizeMode="contain" accessible accessibilityRole="header" accessibilityLabel="Sudoku Vault" />
          </View>
          <View style={styles.tagline}>
            <View style={styles.taglineRule} />
            <Text style={styles.taglineText}>Think • Solve • Win</Text>
            <View style={styles.taglineRule} />
          </View>
        </Motion>

        <View style={styles.playActions}>
          <Button
            label="Play Now"
            accessibilityHint="Choose a difficulty and rules for a new game"
            variant="primary"
            icon="play"
            trailingIcon="chevron-forward"
            large
            style={styles.play}
            onPress={() => router.push('/new-game')}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Saved Games, ${savedCount} ${savedCount === 1 ? 'puzzle' : 'puzzles'}`}
            onPress={() => router.push('/saved-games')}
            style={({ pressed }) => [styles.savedGames, pressed && styles.linkPressed]}>
            <Ionicons name="bookmark-outline" size={18} color={colors.accent} />
            <Text style={styles.savedLabel}>Saved Games</Text>
            {savedCount > 0 && <Text style={styles.savedCount}>{savedCount}</Text>}
            <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
          </Pressable>
        </View>

        <View style={styles.menu}>
          <HomeLink label="Levels" detail={`${levelsCleared} of ${levelsTotal} cleared`} icon="trending-up-outline" tint={colors.accent} onPress={() => router.push('/levels')} />
          <HomeLink label="Daily Puzzle" detail={dailyDetail} icon="calendar-outline" tint={colors.accent} onPress={() => router.push('/daily')} />
          <HomeLink label="Speed Round" detail="1–10 minutes" icon="flash-outline" tint={colors.accent} onPress={() => router.push('/speed-round')} />
          <HomeLink label="Your Puzzle" detail="Enter one to solve" icon="create-outline" tint={colors.accent} onPress={() => router.push('/custom')} />
        </View>

        <View style={styles.more}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More ways to play"
            accessibilityState={{ expanded: moreOpen }}
            onPress={() => setMoreOpen((open) => !open)}
            style={({ pressed }) => [styles.modeRow, pressed && styles.linkPressed]}>
            <Ionicons name="layers-outline" size={21} color={colors.accent} />
            <Text style={[styles.modeLabel, styles.moreLabel]}>More ways to play</Text>
            <Ionicons name={moreOpen ? 'chevron-up' : 'chevron-down'} color={colors.textFaint} size={17} />
          </Pressable>
          {moreOpen && MORE_MODES.map(({ label, icon, tint, href }) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => router.push(href)}
              style={({ pressed }) => [styles.modeRow, styles.modeBorder, pressed && styles.linkPressed]}>
              <Ionicons name={icon} size={21} color={tint} />
              <Text style={styles.modeLabel}>{label}</Text>
              <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
            </Pressable>
          ))}
        </View>

        <View style={styles.footer}>
          <View style={styles.footerItem}>
            <Ionicons name="cloud-offline-outline" size={16} color={colors.textFaint} />
            <Text style={styles.footerText}>Works offline</Text>
          </View>
          {giftReady && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Daily gift"
              accessibilityHint={`Offers one optional ad for ${DAILY_GIFT_CREDITS} hint credits`}
              hitSlop={12}
              onPress={offerGift}
              style={({ pressed }) => [styles.footerItem, pressed && styles.linkPressed]}>
              <Ionicons name="gift-outline" size={16} color={colors.accent} />
              <Text style={[styles.footerText, styles.giftText]}>Daily gift</Text>
            </Pressable>
          )}
          <View style={styles.footerItem}>
            <Ionicons name="bulb-outline" size={16} color={colors.accent} />
            <Text style={styles.footerText}>{credits} hint {credits === 1 ? 'credit' : 'credits'}</Text>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

function HomeLink({ label, detail, icon, tint, onPress }: {
  label: string;
  detail?: string;
  icon: IconName;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}>
      <Ionicons name={icon} color={tint} size={25} />
      <View style={styles.linkCopy}>
        <Text style={styles.linkLabel}>{label}</Text>
        {detail && <Text style={styles.linkDetail}>{detail}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shortcuts: { flexDirection: 'row', gap: spacing.xs },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  hero: { alignItems: 'center', gap: spacing.xs },
  watermark: {
    position: 'absolute',
    top: -18,
    width: '100%',
    maxWidth: 340,
    aspectRatio: 1.65,
    flexDirection: 'row',
    flexWrap: 'wrap',
    opacity: 0.28,
    transform: [{ rotate: '-10deg' }],
  },
  watermarkCell: {
    width: '33.333%',
    height: '33.333%',
    borderWidth: 0.75,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watermarkDigit: { color: colors.lineStrong, fontSize: 40, fontWeight: '900' },
  wordmark: { width: '100%', maxWidth: 380, aspectRatio: WORDMARK_ASPECT_RATIO },
  wordmarkImage: { width: '100%', height: '100%' },
  tagline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  taglineText: { ...type.body, color: colors.textDim, letterSpacing: 1.45, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  taglineRule: { height: 1, width: 32, backgroundColor: colors.lineStrong },
  playActions: { gap: spacing.sm },
  play: { width: '94%', alignSelf: 'center', boxShadow: '0 5px 20px rgba(255, 178, 33, 0.28)' },
  savedGames: {
    minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    maxWidth: '100%',
  },
  savedLabel: { ...type.label, flexShrink: 1, color: colors.text },
  savedCount: {
    color: colors.accent, backgroundColor: colors.accentSoft, borderRadius: radius.sm,
    minWidth: 22, paddingHorizontal: spacing.xs, textAlign: 'center', fontSize: 12, fontWeight: '700',
  },
  menu: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  link: {
    flexBasis: '46%',
    flexGrow: 1,
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    backgroundImage: gradients.panel,
  },
  linkPressed: { opacity: 0.82 },
  linkCopy: { flex: 1 },
  linkLabel: { ...type.body, fontSize: 14, lineHeight: 18, fontWeight: '700' },
  linkDetail: { ...type.dim, fontSize: 12, lineHeight: 16 },
  more: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  modeRow: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  modeBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  modeLabel: { ...type.body, flex: 1, fontSize: 14 },
  moreLabel: { fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  footerText: { ...type.dim, fontSize: 12, lineHeight: 18 },
  giftText: { color: colors.accent, fontWeight: '700' },
});
