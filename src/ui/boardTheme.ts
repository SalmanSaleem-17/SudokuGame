import type { BoardTheme } from '../game/settings';
import { appStore } from '../state/app';
import { useStore } from '../state/store';

/**
 * Board colours per theme. Every theme keeps given digits, player entries, matches,
 * errors and hints distinguishable from each other and readable on their cell colour.
 */
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
  midnight: {
    frame: '#C9D6F2', line: '#4C5878', cell: '#0F1524', alternate: '#141B2E',
    peer: '#1F2A45', match: '#1D3A66', selected: '#7FB2FF', selection: '#D8E8FF',
    selectedText: '#081226', selectedError: '#7A1230', text: '#EEF3FF', entry: '#9CC4FF',
    matchText: '#C4DEFF', notes: '#A9B5D1', error: '#FF9BB0', errorCell: '#3F1C2A',
    hintCell: '#2C2550', hint: '#CDB8FF',
  },
  forest: {
    frame: '#D3E3D2', line: '#4F6352', cell: '#0F1712', alternate: '#141E17',
    peer: '#243326', match: '#1E4A3A', selected: '#8FDCA4', selection: '#DFF7E4',
    selectedText: '#0A1F11', selectedError: '#7A1230', text: '#EFF6EE', entry: '#A9E3B8',
    matchText: '#C6F1D0', notes: '#AEBFAE', error: '#FF9FAE', errorCell: '#3F1D25',
    hintCell: '#2B2A48', hint: '#CFC0FF',
  },
  ocean: {
    frame: '#CBE6EA', line: '#48666C', cell: '#0C1719', alternate: '#111F22',
    peer: '#1C3338', match: '#17475A', selected: '#6FD6E3', selection: '#D6F6FA',
    selectedText: '#06191D', selectedError: '#7A1230', text: '#ECF7F8', entry: '#9EE3EC',
    matchText: '#C2F0F5', notes: '#A6BFC3', error: '#FFA1AE', errorCell: '#3E1E26',
    hintCell: '#2A2A4C', hint: '#CCC0FF',
  },
  lavender: {
    frame: '#DDD6F3', line: '#5B5578', cell: '#141221', alternate: '#19172A',
    peer: '#272341', match: '#1E3558', selected: '#C4B0FF', selection: '#EEE7FF',
    selectedText: '#160F33', selectedError: '#7A1230', text: '#F3F0FF', entry: '#CDBDFF',
    matchText: '#BDDCFF', notes: '#B5AFCF', error: '#FF9FB0', errorCell: '#401C2B',
    hintCell: '#3A2F1C', hint: '#FFD98A',
  },
  rose: {
    frame: '#F0D5DD', line: '#6E5560', cell: '#191116', alternate: '#1F151B',
    peer: '#33222C', match: '#3D2A52', selected: '#FF9EBB', selection: '#FFE1EA',
    selectedText: '#2A0A16', selectedError: '#6B0A2A', text: '#FBEFF2', entry: '#FFC0D2',
    matchText: '#E3CCFF', notes: '#C9B1BA', error: '#FFC27A', errorCell: '#40301A',
    hintCell: '#22304A', hint: '#A9D4FF',
  },
  sunset: {
    frame: '#F3D9C4', line: '#6D5646', cell: '#19120E', alternate: '#1F1712',
    peer: '#33251B', match: '#1F3350', selected: '#FFA868', selection: '#FFE6D0',
    selectedText: '#2A1204', selectedError: '#6B0A2A', text: '#FCF1E8', entry: '#FFC79A',
    matchText: '#BBD8FF', notes: '#C9B5A5', error: '#FF9DB4', errorCell: '#421C2A',
    hintCell: '#2E2A4C', hint: '#CDC0FF',
  },
  slate: {
    frame: '#D5DAE0', line: '#59606A', cell: '#16191D', alternate: '#1B1F24',
    peer: '#2A3038', match: '#1F3A55', selected: '#B8C7D9', selection: '#F0F5FA',
    selectedText: '#10161D', selectedError: '#7A1230', text: '#F2F4F7', entry: '#A9CCF0',
    matchText: '#C3E0FF', notes: '#AEB5BF', error: '#FF9EAC', errorCell: '#3F1E26',
    hintCell: '#2E2A4A', hint: '#CFC2FF',
  },
  sand: {
    frame: '#4A3F2F', line: '#A3947C', cell: '#FBF5E9', alternate: '#F3EAD8',
    peer: '#EBDDBF', match: '#D5E6F7', selected: '#F2B84B', selection: '#6B4300',
    selectedText: '#231703', selectedError: '#7F1632', text: '#2E2618', entry: '#1F5A8A',
    matchText: '#17406F', notes: '#6A5B45', error: '#8A2440', errorCell: '#F8DFE3',
    hintCell: '#E9E0F7', hint: '#5F3F8F',
  },
  mint: {
    frame: '#27433A', line: '#86A398', cell: '#F7FCF9', alternate: '#EAF5EF',
    peer: '#D5EBDF', match: '#D3E6FA', selected: '#7ED6A5', selection: '#0F4A2C',
    selectedText: '#06261A', selectedError: '#7F1632', text: '#1C2B25', entry: '#1B5E86',
    matchText: '#153F70', notes: '#4F6359', error: '#8A2440', errorCell: '#FADFE4',
    hintCell: '#EAE2F9', hint: '#5E3E90',
  },
} satisfies Record<BoardTheme, Record<string, string>>;

export type BoardPalette = (typeof BOARD_PALETTES)[BoardTheme];

export const BOARD_THEME_NAMES: Record<BoardTheme, string> = {
  charcoal: 'Charcoal & gold',
  light: 'Light',
  contrast: 'High contrast',
  midnight: 'Midnight',
  forest: 'Forest',
  ocean: 'Ocean',
  lavender: 'Lavender',
  rose: 'Rose',
  sunset: 'Sunset',
  slate: 'Slate',
  sand: 'Sand',
  mint: 'Mint',
};

export function useBoardPalette(): BoardPalette {
  return BOARD_PALETTES[useStore(appStore, (s) => s.settings.boardTheme)];
}
