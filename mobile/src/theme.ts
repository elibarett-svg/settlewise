import { useColorScheme } from 'react-native';

const palette = {
  light: {
    background: '#F5F7F6',
    surface: '#FFFFFF',
    surfaceAlt: '#EEF3F1',
    text: '#14211D',
    textMuted: '#5B6B66',
    border: '#DCE4E1',
    primary: '#0F766E',
    primaryText: '#FFFFFF',
    primarySoft: '#D7F0EC',
    danger: '#B42318',
    dangerSoft: '#FDE7E5',
    warning: '#B54708',
    warningSoft: '#FEF0DC',
    success: '#067647',
    successSoft: '#DCFAE6',
    info: '#1D4ED8',
    infoSoft: '#E0E9FF',
  },
  dark: {
    background: '#0E1513',
    surface: '#16201D',
    surfaceAlt: '#1D2A26',
    text: '#E8F0ED',
    textMuted: '#9AABA5',
    border: '#2A3833',
    primary: '#2DD4BF',
    primaryText: '#04201C',
    primarySoft: '#123A35',
    danger: '#F97066',
    dangerSoft: '#3D1714',
    warning: '#FDB022',
    warningSoft: '#3A2A0E',
    success: '#47CD89',
    successSoft: '#10301F',
    info: '#84ADFF',
    infoSoft: '#172447',
  },
};

export type Colors = typeof palette.light;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? palette.dark : palette.light;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}
