import { Tabs } from 'expo-router';

// La barre d'onglets native est masquée : la barre flottante du design est dessinée par chaque écran (components/ui/main-tab-navbar.tsx).
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
        sceneStyle: { backgroundColor: '#F8F7F4' },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Publier' }} />
      <Tabs.Screen name="agent" options={{ title: 'Agent' }} />
      <Tabs.Screen name="inbox" options={{ title: 'Messages' }} />
      <Tabs.Screen name="analytics" options={{ title: 'Insights' }} />
    </Tabs>
  );
}
