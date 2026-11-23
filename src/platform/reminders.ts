/**
 * The optional Daily Puzzle reminder: one local notification a day, scheduled on the
 * device. Nothing is sent to a server and no push token is requested.
 *
 * The notifications module is loaded lazily so the game still runs where it is missing.
 */
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

const CHANNEL = 'daily-puzzle';
let loaded: NotificationsModule | null | undefined;

function notifications(): NotificationsModule | null {
  if (loaded === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require('expo-notifications') as NotificationsModule;
      loaded.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
        }),
      });
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

/** Asks for permission to show notifications. Returns false when the player declines. */
export async function requestReminderPermission(): Promise<boolean> {
  const api = notifications();
  if (!api) return false;
  try {
    const current = await api.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await api.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Makes the scheduled reminder match the settings: one daily notification, or none. */
export async function syncReminder(enabled: boolean, hour: number): Promise<void> {
  const api = notifications();
  if (!api) return;
  try {
    await api.cancelAllScheduledNotificationsAsync();
    if (!enabled || !(await api.getPermissionsAsync()).granted) return;
    if (Platform.OS === 'android') {
      await api.setNotificationChannelAsync(CHANNEL, {
        name: 'Daily Puzzle reminder',
        importance: api.AndroidImportance.DEFAULT,
      });
    }
    await api.scheduleNotificationAsync({
      content: { title: 'Sudoku Vault', body: 'Today’s Daily Puzzle is ready.' },
      trigger: { type: api.SchedulableTriggerInputTypes.DAILY, hour, minute: 0, channelId: CHANNEL },
    });
  } catch {
    // A reminder is a convenience; the game never depends on it.
  }
}
