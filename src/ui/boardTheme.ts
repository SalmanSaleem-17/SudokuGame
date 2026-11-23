import type { BoardTheme } from '../game/settings';
import { appStore } from '../state/app';
import { useStore } from '../state/store';

export const BOARD_PALETTES = {
  charcoal: {
    frame: '#E3E4E3', line: '#666461', cell: '#141414', alternate: '#191919',
    peer: '#302D28', match: '#1A2C48', selected: '#F3C752', selection: '#FFF0A7',
    selectedText: '#21190D', selectedError: '#61152B', text: '#F5F3EF', entry: '#CDCFD3',
    matchText: '#B9D9FF', notes: '#BEB9B0', error: '#FF9BA9', errorCell: '#421F28',
    hintCell: '#322C44', hint: '#D0B8FA',
  },
  light: {
    frame: '#343548', line: '#858393', cell: '#FFFDFA', alternate: '#F2EEE8',
    peer: '#EEE3CB', match: '#D2E7FF', selected: '#FFD469', selection: '#8A5200',
    selectedText: '#21190D', selectedError: '#7F1632', text: '#262434', entry: '#164D80',
    matchText: '#153C71', notes: '#645548', error: '#862744', errorCell: '#FBE2E7',
    hintCell: '#ECE2FA', hint: '#623E91',
  },
  contrast: {
    frame: '#FFFFFF', line: '#A6A6A6', cell: '#000000', alternate: '#101010',
    peer: '#343434', match: '#002852', selected: '#FFE500', selection: '#161600',
    selectedText: '#000000', selectedError: '#82001B', text: '#FFFFFF', entry: '#92E9FF',
    matchText: '#B4F2FF', notes: '#EEEEEE', error: '#FFB4C1', errorCell: '#420015',
    hintCell: '#301746', hint: '#F5CAFF',
  },
} satisfies Record<BoardTheme, Record<string, string>>;

export type BoardPalette = (typeof BOARD_PALETTES)[BoardTheme];

export const BOARD_THEME_NAMES: Record<BoardTheme, string> = {
  charcoal: 'Charcoal & gold',
  light: 'Light',
  contrast: 'High contrast',
};

export function useBoardPalette(): BoardPalette {
  return BOARD_PALETTES[useStore(appStore, (s) => s.settings.boardTheme)];
}
