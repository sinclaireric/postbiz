import { useColorScheme as useRNColorScheme } from 'react-native';

/** Jeu de couleurs clair/sombre ; « unspecified » (valeur possible côté React Native) est traité comme clair. */
export function useColorScheme(): 'light' | 'dark' {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light';
}
