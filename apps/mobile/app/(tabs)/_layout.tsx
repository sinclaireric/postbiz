import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { FloatingTabBar } from '@/components/ui/main-tab-navbar';

// La barre d'onglets native est masquée : la barre flottante (components/ui/main-tab-navbar.tsx) est montée ici, une seule fois,
// pour que ses animations (pastille qui glisse, bouton « + » qui apparaît sur Publier) survivent aux changements d'onglet.
export default function TabLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: '#F8F7F4' }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          sceneStyle: { backgroundColor: '#F8F7F4' },
          animation: 'fade',
        }}>
        <Tabs.Screen name="index" options={{ title: 'Publier' }} />
        <Tabs.Screen name="agent" options={{ title: 'Agent' }} />
        <Tabs.Screen name="inbox" options={{ title: 'Messages' }} />
        <Tabs.Screen name="analytics" options={{ title: 'Insights' }} />
      </Tabs>
      <FloatingTabBar />
    </View>
  );
}
