import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, StyleSheet, View } from 'react-native';

import { BrandTitle, WORDMARK, WORDMARK_ASPECT_RATIO } from './Brand';
import { colors, gradients, spacing } from './theme';

interface StartupSplashProps {
  onBrandReady: () => void;
  reducedMotion: boolean;
}

export function StartupSplash({ onBrandReady, reducedMotion }: StartupSplashProps) {
  const laidOut = useRef(false);
  const brandReady = useRef(false);
  const [imageFailed, setImageFailed] = useState(false);

  const markBrandReady = () => {
    brandReady.current = true;
    if (laidOut.current) onBrandReady();
  };

  return (
    <View
      style={styles.launch}
      accessible
      accessibilityLabel="Loading Sudoku Studio"
      accessibilityState={{ busy: true }}
      onLayout={() => {
        laidOut.current = true;
        if (brandReady.current) onBrandReady();
      }}>
      <View pointerEvents="none" style={styles.halo} />
      <View style={styles.brand}>
        {imageFailed ? (
          <View onLayout={markBrandReady}>
            <BrandTitle />
          </View>
        ) : (
          <Image
            source={WORDMARK}
            style={styles.wordmark}
            resizeMode="contain"
            fadeDuration={0}
            onLoad={markBrandReady}
            onError={() => setImageFailed(true)}
          />
        )}
        <View style={styles.loadingMark}>
          {reducedMotion ? <View style={styles.loadingDot} /> : <ActivityIndicator color={colors.accent} />}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  launch: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.bg,
    backgroundImage: gradients.screen,
  },
  halo: {
    position: 'absolute',
    width: '94%',
    maxWidth: 460,
    aspectRatio: 1,
    backgroundImage: 'radial-gradient(circle, #594022 0%, #30251B 33%, #30251B00 68%)',
  },
  brand: {
    width: Platform.OS === 'android' ? 172 : 240,
    maxWidth: '76%',
    aspectRatio: WORDMARK_ASPECT_RATIO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { width: '100%', height: '100%' },
  loadingMark: { position: 'absolute', top: '100%', marginTop: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  loadingDot: { height: 6, width: 6, borderRadius: 3, backgroundColor: colors.accent },
});
