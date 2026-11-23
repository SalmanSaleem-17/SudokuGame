/**
 * Backup files. The player saves a file wherever they choose and picks it again to
 * restore; the app itself never uploads anything.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { BackupData } from '../storage/repository';

/** Writes the backup to a temporary file and opens the system share sheet for it. */
export async function shareBackup(data: BackupData): Promise<void> {
  const stamp = new Date(data.exportedAt).toISOString().slice(0, 10);
  const file = new File(Paths.cache, `sudoku-vault-backup-${stamp}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save Sudoku Vault backup' });
}

/** Lets the player pick a backup file. Returns null if they cancel. */
export async function pickBackup(): Promise<unknown> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', 'application/octet-stream'] });
  if (picked.canceled) return null;
  const parsed: unknown = JSON.parse(await picked.result.text());
  return parsed;
}
