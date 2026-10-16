import { redirect } from 'next/navigation';

// Ancienne étape « nommer votre organisation » : l'organisation est maintenant créée automatiquement
// et l'onboarding s'ouvre par-dessus le calendrier (?onboarding=true), comme dans Postiz.
export default function OnboardingRedirect() {
  redirect('/app/calendrier?onboarding=true');
}
