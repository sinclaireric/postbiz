import { Ionicons } from "@expo/vector-icons";
import { forwardRef, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View, type TextInputInstance, type TextInputProps } from "react-native";

type Props = { label: string; hint?: string; error?: boolean; right?: ReactNode } & TextInputProps;

/** Champ de saisie de la refonte : libellé au-dessus, bloc blanc arrondi, bordure foncée au focus. */
export const Field = forwardRef<TextInputInstance, Props>(function Field({ label, hint, error, right, onFocus, onBlur, ...input }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View className="gap-2">
      <Text className="font-jakarta text-[14px] font-semibold text-ink">{label}</Text>
      <View className={`h-[56px] flex-row items-center rounded-[16px] border bg-card px-4 ${error ? "border-text-critical" : focused ? "border-ink" : "border-line"}`}>
        <TextInput
          ref={ref}
          className="flex-1 font-jakarta text-[16px] text-ink"
          placeholderTextColor="#9A9890"
          selectionColor="#141414"
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...input}
        />
        {right}
      </View>
      {hint ? <Text className={`font-jakarta text-[12px] ${error ? "text-text-critical" : "text-ink-soft"}`}>{hint}</Text> : null}
    </View>
  );
});

/** Champ mot de passe avec bouton afficher / masquer. */
export const PasswordField = forwardRef<TextInputInstance, Omit<Props, "right" | "secureTextEntry">>(function PasswordField(props, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      ref={ref}
      secureTextEntry={!visible}
      textContentType="none"
      autoComplete="off"
      spellCheck={false}
      right={
        <Pressable hitSlop={10} onPress={() => setVisible((v) => !v)} accessibilityLabel={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}>
          <Ionicons name={visible ? "eye-outline" : "eye-off-outline"} size={22} color="#5E5E5A" />
        </Pressable>
      }
      {...props}
    />
  );
});
