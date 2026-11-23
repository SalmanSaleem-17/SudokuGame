import { Alert } from 'react-native';

export function confirmQuitGame(onConfirm: () => void, message = 'Your progress in this game will be lost.') {
  Alert.alert('Quit Game?', message, [
    { text: 'Keep Playing', style: 'cancel' },
    { text: 'Quit Game', style: 'destructive', onPress: onConfirm },
  ], { cancelable: true });
}
