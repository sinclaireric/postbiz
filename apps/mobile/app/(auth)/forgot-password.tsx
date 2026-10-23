import { useRouter } from "expo-router";
import { useState } from "react";

import { AuthShell } from "@/components/ui/auth-shell";
import { Field } from "@/components/ui/field";
import { PrimaryButton } from "@/components/ui/kit";
import { useAuthStore } from "@/store/auth-store";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !email.includes("@")) {
      setError("Saisissez une adresse e-mail valide");
      return;
    }
    setBusy(true);
    const result = await useAuthStore.getState().sendPasswordReset(email);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push({ pathname: "/(auth)/check-email", params: { email, flow: "reset" } } as never);
  };

  return (
    <AuthShell
      title="Mot de passe oublié"
      subtitle="Indiquez votre adresse e-mail : nous vous envoyons un lien pour en choisir un nouveau."
      footer={<PrimaryButton label="Envoyer le lien" onPress={submit} loading={busy} disabled={!email.includes("@")} />}
    >
      <Field
        label="E-mail"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          setError(undefined);
        }}
        placeholder="vous@entreprise.fr"
        keyboardType="email-address"
        error={!!error}
        hint={error}
        returnKeyType="send"
        onSubmitEditing={submit}
      />
    </AuthShell>
  );
}
