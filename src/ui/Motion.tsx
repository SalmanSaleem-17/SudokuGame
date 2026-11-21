import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

interface MotionProps {
  children?: ReactNode;
  reduced: boolean;
  variant?: 'rise' | 'pop';
  style?: StyleProp<ViewStyle>;
}

export function Motion({ children, reduced, variant = 'rise', style }: MotionProps) {
  const [progress] = useState(() => new Animated.Value(reduced ? 1 : 0));

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: variant === 'pop' ? 175 : 290,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced, variant]);

  const offset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: variant === 'pop' ? [0.8, 1] : [12, 0],
  });

  return (
    <Animated.View style={[style, !reduced && {
      opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
      transform: variant === 'pop' ? [{ scale: offset }] : [{ translateY: offset }],
    }]}>
      {children}
    </Animated.View>
  );
}
