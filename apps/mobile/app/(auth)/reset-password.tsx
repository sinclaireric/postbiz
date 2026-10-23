import { Text } from "react-native";
import { useRef, useState } from "react";
import type { TextInputInstance } from "react-native";

import { AuthShell } from "@/components/ui/auth-shell";
import { PasswordField } from "@/components/ui/field";
import { PrimaryButton } from "@/components/ui/kit";
import { showToast } from "@/components/ui/toast";
import { useAuthStore } from "@/store/auth-store";

export default function ResetPasswordScreen() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);
  const recovery = useAuthStore((s) => s.recovery);
  const confirmRef = useRef<TextInputInstance>(null);

  const submit = async () => {
    const next: { password?: string; confirm?: string } = {};
    if (!password || password.length < 8) next.password = "8 caractères minimum";
    if (!confirm) next.confirm = "Confirmez votre mot de passe";
    else if (password !== confirm) next.confirm = "Les mots de passe ne correspondent pas";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    const result = await useAuthStore.getState().updatePassword(password);
    setBusy(false);
    if (!result.ok) {
      setErrors({ password: result.error });
      return;
    }
    // La session ouverte par le lien devient la session normale : les routes protégées ouvrent l'application.
    showToast("Mot de passe modifié", "success");
  };

  return (
    <AuthShell
      title="Nouveau mot de passe"
      subtitle="Choisissez un mot de passe d’au moins 8 caractères."
      footer={recovery ? <PrimaryButton label="Enregistrer" onPress={submit} loading={busy} /> : undefined}
    >
      {recovery ? (
        <>
          <PasswordField
            label="Mot de passe"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setErrors((e) => ({ ...e, password: undefined }));
            }}
            placeholder="Nouveau mot de passe"
            error={!!errors.password}
            hint={errors.password}
            returnKeyType="next"
            onSubmitEditing={() => confirmRef.current?.focus()}
          />
          <PasswordField
            ref={confirmRef}
            label="Confirmer le mot de passe"
            value={confirm}
            onChangeText={(t) => {
              setConfirm(t);
              setErrors((e) => ({ ...e, confirm: undefined }));
            }}
            placeholder="Confirmez le mot de passe"
            error={!!errors.confirm}
            hint={errors.confirm}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </>
      ) : (
        <Text className="font-jakarta text-[15px] text-ink-soft">Ouvrez le lien reçu par e-mail sur cet appareil pour choisir un nouveau mot de passe.</Text>
      )}
    </AuthShell>
  );
}
