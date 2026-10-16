import { Redirect } from "expo-router";

// Les statistiques n'ont pas encore de source de données dans Postbiz (aucune table analytics) : l'onglet est retiré de
// la navigation. Cette route ne fait que renvoyer vers le calendrier si elle est ouverte par un ancien lien.
export default function AnalyticsScreen() {
  return <Redirect href="/(tabs)" />;
}
