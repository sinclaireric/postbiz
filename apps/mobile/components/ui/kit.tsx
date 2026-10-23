import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Modal from "react-native-modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Petite boîte à outils de la refonte : mêmes formes partout (pilules, cartes blanches sur fond chaud, vert fluo).

type IconName = keyof typeof Ionicons.glyphMap;

export const INK = "#141414";
export const BRAND = "#C6F432";

export function IconCircle({
  icon,
  onPress,
  size = 44,
  label,
  active = false,
  badge,
  tint = INK,
}: {
  icon: IconName;
  onPress?: () => void;
  size?: number;
  label: string;
  active?: boolean;
  badge?: number;
  tint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      className={`items-center justify-center rounded-full ${active ? "bg-brand" : "bg-card"}`}
      style={{ width: size, height: size, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
    >
      <Ionicons name={icon} size={size * 0.48} color={tint} />
      {badge && badge > 0 ? (
        <View className="absolute right-0 top-0 min-w-[18px] items-center rounded-full bg-ink px-1">
          <Text className="font-jakarta text-[10px] font-bold text-white">{badge > 99 ? "99+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Pilule blanche (sélecteur de canal, de mois, filtres). */
export function Pill({ children, onPress, style, active = false }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      className={`h-[46px] flex-row items-center gap-2 rounded-full px-4 ${active ? "bg-brand" : "bg-card"}`}
      style={[{ shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }, style]}
    >
      {children}
    </Pressable>
  );
}

export function PrimaryButton({ label, onPress, disabled, loading, icon }: { label: string; onPress?: () => void; disabled?: boolean; loading?: boolean; icon?: IconName }) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      onPress={onPress}
      className={`h-[56px] flex-row items-center justify-center gap-2 rounded-full px-6 ${off ? "bg-chip-bg" : "bg-brand"}`}
    >
      {loading ? <ActivityIndicator color={INK} /> : icon ? <Ionicons name={icon} size={18} color={off ? "#9A9890" : INK} /> : null}
      <Text className={`font-jakarta text-[16px] font-semibold ${off ? "text-ink-muted" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}

export function OutlineButton({ label, onPress, disabled, danger }: { label: string; onPress?: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className="h-[56px] items-center justify-center rounded-full border border-[#C9C7C0] px-6"
    >
      <Text className={`font-jakarta text-[16px] font-semibold ${danger ? "text-text-critical" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  primary,
  secondary,
}: {
  icon: IconName;
  title: string;
  text?: string;
  primary?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  return (
    <View className="items-center px-8 pt-16">
      <View className="h-[88px] w-[88px] items-center justify-center rounded-full bg-brand-soft">
        <Ionicons name={icon} size={38} color="#2F4A00" />
      </View>
      <Text className="mt-6 text-center font-jakarta text-[20px] font-semibold text-ink">{title}</Text>
      {text ? <Text className="mt-2 text-center font-jakarta text-[16px] leading-[24px] text-ink-soft">{text}</Text> : null}
      {primary ? (
        <View className="mt-7 w-full max-w-[340px]">
          <PrimaryButton label={primary.label} onPress={primary.onPress} />
        </View>
      ) : null}
      {secondary ? (
        <View className="mt-3 w-full max-w-[340px]">
          <OutlineButton label={secondary.label} onPress={secondary.onPress} />
        </View>
      ) : null}
    </View>
  );
}

/** Contrôle segmenté flottant (états des publications, commentaires / messages). */
export function SegmentedPill<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <View
      className="flex-row rounded-full bg-card p-[5px]"
      style={{ shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 4 }}
    >
      {items.map((it) => {
        const on = it.id === value;
        return (
          <Pressable
            key={it.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(it.id)}
            className={`h-[40px] flex-row items-center justify-center gap-1 rounded-full px-3 ${on ? "bg-chip-bg" : ""}`}
            style={{ flexGrow: 1, flexShrink: 1 }}
          >
            <Text numberOfLines={1} className={`shrink font-jakarta text-[13.5px] ${on ? "font-semibold text-ink" : "font-medium text-ink-muted"}`}>
              {it.label}
            </Text>
            {it.count ? (
              <View className="min-w-[18px] items-center rounded-full bg-brand px-1">
                <Text className="font-jakarta text-[10px] font-bold text-ink">{it.count > 99 ? "99+" : it.count}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Feuille qui monte du bas (react-native-modal : pas de dépendance aux gestes de bottom-sheet). */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  right,
  full = false,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  right?: ReactNode;
  full?: boolean;
}) {
  const { top, bottom } = useSafeAreaInsets();
  return (
    <Modal
      isVisible={visible}
      onBackdropPress={onClose}
      onBackButtonPress={onClose}
      onSwipeComplete={onClose}
      swipeDirection="down"
      propagateSwipe
      style={{ margin: 0, justifyContent: "flex-end" }}
      backdropOpacity={0.35}
      animationIn="slideInUp"
      animationOut="slideOutDown"
      useNativeDriverForBackdrop
      avoidKeyboard
    >
      <View className="rounded-t-[28px] bg-canvas px-4 pt-4" style={{ paddingBottom: bottom + 12, maxHeight: "92%", height: full ? `${100 - Math.round((top / 900) * 100)}%` : undefined }}>
        <View className="mb-3 h-[44px] flex-row items-center justify-between">
          <IconCircle icon="close" label="Fermer" onPress={onClose} size={44} />
          {title ? <Text className="flex-1 text-center font-jakarta text-[18px] font-semibold text-ink">{title}</Text> : <View className="flex-1" />}
          <View style={{ minWidth: 44, alignItems: "flex-end" }}>{right}</View>
        </View>
        {children}
      </View>
    </Modal>
  );
}

/** Carte blanche arrondie. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View className="rounded-[22px] border border-line bg-card" style={style}>
      {children}
    </View>
  );
}

/** En-tête des écrans poussés : retour rond, titre, action à droite. */
export function PageHeader({ title, onBack, right, close = false }: { title: string; onBack: () => void; right?: ReactNode; close?: boolean }) {
  return (
    <View className="h-[64px] flex-row items-center justify-between gap-3 px-4">
      <IconCircle icon={close ? "close" : "chevron-back"} label={close ? "Fermer" : "Retour"} onPress={onBack} size={44} />
      <Text numberOfLines={1} className="flex-1 text-center font-jakarta text-[18px] font-semibold text-ink">
        {title}
      </Text>
      <View style={{ minWidth: 44, alignItems: "flex-end" }}>{right}</View>
    </View>
  );
}

/** Ligne d'une liste groupée (réglages) : icône, libellé, valeur, chevron. */
export function Row({
  icon,
  label,
  value,
  onPress,
  danger = false,
  last = false,
  chevron = true,
}: {
  icon?: IconName;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
  chevron?: boolean;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      className={`min-h-[58px] flex-row items-center gap-4 px-5 py-3 ${last ? "" : "border-b border-line"}`}
    >
      {icon ? <Ionicons name={icon} size={22} color={danger ? "#D92D20" : "#141414"} /> : null}
      <Text className={`flex-1 font-jakarta text-[16px] ${danger ? "text-text-critical" : "text-ink"}`}>{label}</Text>
      {value ? (
        <Text numberOfLines={1} className="max-w-[48%] font-jakarta text-[15px] text-ink-soft">
          {value}
        </Text>
      ) : null}
      {onPress && chevron ? <Ionicons name="chevron-forward" size={18} color="#9A9890" /> : null}
    </Pressable>
  );
}

/** Confirmation (suppression, etc.) : feuille avec un bouton principal et « Annuler ». */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = "Annuler",
  danger = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onCancel} title={title}>
      <View className="gap-3 pb-2">
        {message ? <Text className="font-jakarta text-[15px] leading-[22px] text-ink-soft">{message}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={onConfirm}
          className={`h-[56px] items-center justify-center rounded-full ${danger ? "bg-[#D92D20]" : "bg-brand"}`}
        >
          <Text className={`font-jakarta text-[16px] font-semibold ${danger ? "text-white" : "text-ink"}`}>{confirmLabel}</Text>
        </Pressable>
        <OutlineButton label={cancelLabel} onPress={onCancel} />
      </View>
    </Sheet>
  );
}

/** Plusieurs actions icône dans une seule pilule blanche (recherche, filtre, tout résoudre). */
export function IconPill({ items }: { items: { icon: IconName; label: string; onPress: () => void; active?: boolean }[] }) {
  return (
    <View
      className="h-[46px] flex-row items-center rounded-full bg-card px-1"
      style={{ shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
    >
      {items.map((it) => (
        <Pressable
          key={it.label}
          accessibilityRole="button"
          accessibilityLabel={it.label}
          onPress={it.onPress}
          hitSlop={4}
          className={`h-[38px] w-[38px] items-center justify-center rounded-full ${it.active ? "bg-brand" : ""}`}
        >
          <Ionicons name={it.icon} size={21} color={INK} />
        </Pressable>
      ))}
    </View>
  );
}
