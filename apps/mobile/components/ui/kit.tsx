import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Reanimated, { FadeInDown, FadeInUp, useAnimatedStyle, useSharedValue, withSpring, withTiming, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptic } from "@/lib/haptics";

// Petite boîte à outils de la refonte : mêmes formes partout (pilules, cartes blanches sur fond chaud, vert fluo).

type IconName = keyof typeof Ionicons.glyphMap;

/** Effet « ressort » à l'appui : le bouton se réduit un instant puis rebondit. À poser sur un Pressable (handlers) et sur sa vue (style). */
export function usePressScale(to = 0.95) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    style,
    handlers: {
      onPressIn: () => {
        scale.value = withTiming(to, { duration: 80 });
      },
      onPressOut: () => {
        scale.value = withSpring(1, { damping: 9, stiffness: 260 });
      },
    },
  };
}

/** Apparition douce d'un bloc à l'affichage : il monte en fondu, avec un léger décalage selon son rang (`index`). */
export function Appear({ children, index = 0, from = "down", style }: { children: ReactNode; index?: number; from?: "down" | "up"; style?: StyleProp<ViewStyle> }) {
  const base = from === "up" ? FadeInUp : FadeInDown;
  return (
    <Reanimated.View entering={base.duration(380).delay(Math.min(index, 10) * 55)} style={style}>
      {children}
    </Reanimated.View>
  );
}

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
  const press = usePressScale(0.9);
  return (
    <Reanimated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          haptic.tap();
          onPress?.();
        }}
        {...press.handlers}
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
    </Reanimated.View>
  );
}

/** Pilule blanche (sélecteur de canal, de mois, filtres). */
export function Pill({ children, onPress, style, active = false }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; active?: boolean }) {
  const press = usePressScale(0.95);
  return (
    <Reanimated.View style={press.style}>
      <Pressable
        onPress={() => {
          haptic.select();
          onPress?.();
        }}
        {...press.handlers}
        className={`h-[46px] flex-row items-center gap-2 rounded-full px-4 ${active ? "bg-brand" : "bg-card"}`}
        style={[{ shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }, style]}
      >
        {children}
      </Pressable>
    </Reanimated.View>
  );
}

export function PrimaryButton({ label, onPress, disabled, loading, icon }: { label: string; onPress?: () => void; disabled?: boolean; loading?: boolean; icon?: IconName }) {
  const off = disabled || loading;
  const press = usePressScale(0.97);
  return (
    <Reanimated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        disabled={off}
        onPress={() => {
          haptic.tap();
          onPress?.();
        }}
        {...press.handlers}
        className={`h-[52px] flex-row items-center justify-center gap-2 rounded-full px-6 ${off ? "bg-chip-bg" : "bg-brand"}`}
      >
        {loading ? <ActivityIndicator color={INK} /> : icon ? <Ionicons name={icon} size={18} color={off ? "#9A9890" : INK} /> : null}
        <Text className={`font-jakarta text-[14.5px] font-semibold ${off ? "text-ink-muted" : "text-ink"}`}>{label}</Text>
      </Pressable>
    </Reanimated.View>
  );
}

export function OutlineButton({ label, onPress, disabled, danger }: { label: string; onPress?: () => void; disabled?: boolean; danger?: boolean }) {
  const press = usePressScale(0.97);
  return (
    <Reanimated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => {
          haptic.tap();
          onPress?.();
        }}
        {...press.handlers}
        className="h-[52px] items-center justify-center rounded-full border border-[#C9C7C0] px-6"
        style={{ opacity: disabled ? 0.5 : 1 }}
      >
        <Text className={`font-jakarta text-[14.5px] font-semibold ${danger ? "text-text-critical" : "text-ink"}`}>{label}</Text>
      </Pressable>
    </Reanimated.View>
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
      <Reanimated.View entering={ZoomIn.springify().damping(11)}>
        <View className="h-[88px] w-[88px] items-center justify-center rounded-full bg-brand-soft">
          <Ionicons name={icon} size={38} color="#2F4A00" />
        </View>
      </Reanimated.View>
      <Text className="mt-6 text-center font-jakarta text-[17px] font-semibold text-ink">{title}</Text>
      {text ? <Text className="mt-2 text-center font-jakarta text-[14.5px] leading-[21px] text-ink-soft">{text}</Text> : null}
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

/** Contrôle segmenté flottant (états des publications, commentaires / messages) : la pastille de l'élément actif glisse. */
export function SegmentedPill<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const [layouts, setLayouts] = useState<Record<string, { x: number; w: number }>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);

  useEffect(() => {
    const l = layouts[value];
    if (!l) return;
    if (w.value === 0) {
      // Première mesure : on se place sans animer.
      x.value = l.x;
      w.value = l.w;
    } else {
      x.value = withSpring(l.x, { damping: 18, stiffness: 220 });
      w.value = withSpring(l.w, { damping: 18, stiffness: 220 });
    }
  }, [value, layouts, x, w]);

  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], width: w.value }));

  return (
    <View
      className="flex-row rounded-full bg-card p-[5px]"
      style={{ shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 4 }}
    >
      <Reanimated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 5, bottom: 5, borderRadius: 999, backgroundColor: "#EFEDE7" }, indicator]} />
      {items.map((it) => {
        const on = it.id === value;
        return (
          <Pressable
            key={it.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (it.id !== value) haptic.select();
              onChange(it.id);
            }}
            onLayout={(e) => {
              const { x: lx, width } = e.nativeEvent.layout;
              setLayouts((cur) => (cur[it.id]?.x === lx && cur[it.id]?.w === width ? cur : { ...cur, [it.id]: { x: lx, w: width } }));
            }}
            className="h-[40px] flex-row items-center justify-center gap-1 rounded-full px-3"
            style={{ flexGrow: 1, flexShrink: 1 }}
          >
            <Text numberOfLines={1} className={`shrink font-jakarta text-[12.5px] ${on ? "font-semibold text-ink" : "font-medium text-ink-muted"}`}>
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

/**
 * Feuille qui monte du bas : fond assombri, balayage vers le bas pour fermer, clavier pris en compte.
 * Construite sur le Modal de React Native (pas de dépendance externe : react-native-modal ne suit plus React 19).
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  right,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  const { bottom } = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const translate = useRef(new Animated.Value(height)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(translate, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(translate, { toValue: height, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Balayage vers le bas sur l'en-tête de la feuille.
  const latest = useRef({ onClose });
  latest.current = { onClose };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translate.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 110 || g.vy > 0.9) latest.current.onClose();
        else Animated.spring(translate, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    }),
  ).current;

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000", opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] }) }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Fermer" />
        </Animated.View>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end" }} pointerEvents="box-none">
          <Animated.View
            style={{
              transform: [{ translateY: translate }],
              maxHeight: "92%",
              backgroundColor: "#F8F7F4",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingHorizontal: 16,
              paddingTop: 16,
              paddingBottom: bottom + 12,
            }}
          >
            <View {...pan.panHandlers} className="mb-3 h-[44px] flex-row items-center justify-between">
              <IconCircle icon="close" label="Fermer" onPress={onClose} size={44} />
              {title ? <Text className="flex-1 text-center font-jakarta text-[16px] font-semibold text-ink">{title}</Text> : <View className="flex-1" />}
              <View style={{ minWidth: 44, alignItems: "flex-end" }}>{right}</View>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bounces={false}>
              {children}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
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
      <Text numberOfLines={1} className="flex-1 text-center font-jakarta text-[16px] font-semibold text-ink">
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
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      accessibilityRole={onPress ? "button" : undefined}
      className={`min-h-[58px] flex-row items-center gap-4 px-5 py-3 ${last ? "" : "border-b border-line"}`}
    >
      {icon ? <Ionicons name={icon} size={22} color={danger ? "#D92D20" : "#141414"} /> : null}
      <Text className={`flex-1 font-jakarta text-[14.5px] ${danger ? "text-text-critical" : "text-ink"}`}>{label}</Text>
      {value ? (
        <Text numberOfLines={1} className="max-w-[48%] font-jakarta text-[13.5px] text-ink-soft">
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
        {message ? <Text className="font-jakarta text-[13.5px] leading-[19.5px] text-ink-soft">{message}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (danger) haptic.warning();
            else haptic.tap();
            onConfirm();
          }}
          className={`h-[52px] items-center justify-center rounded-full ${danger ? "bg-[#D92D20]" : "bg-brand"}`}
        >
          <Text className={`font-jakarta text-[14.5px] font-semibold ${danger ? "text-white" : "text-ink"}`}>{confirmLabel}</Text>
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
          onPress={() => {
            haptic.select();
            it.onPress();
          }}
          hitSlop={4}
          className={`h-[38px] w-[38px] items-center justify-center rounded-full ${it.active ? "bg-brand" : ""}`}
        >
          <Ionicons name={it.icon} size={21} color={INK} />
        </Pressable>
      ))}
    </View>
  );
}
