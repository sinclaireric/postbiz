import { Link } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function ModalScreen() {
  return (
    <ThemedView className="flex-1 items-center justify-center p-5">
      <ThemedText type="title">Fenêtre modale</ThemedText>
      <Link href={"/(auth)" as any} dismissTo className="mt-4 py-4">
        <ThemedText type="link">Retour à l’accueil</ThemedText>
      </Link>
    </ThemedView>
  );
}
