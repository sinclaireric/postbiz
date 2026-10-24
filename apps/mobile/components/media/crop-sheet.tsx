import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, Text, useWindowDimensions, View } from "react-native";

import { Image } from "@/components/ui/image";
import { PrimaryButton, Sheet } from "@/components/ui/kit";
import { showToast } from "@/components/ui/toast";
import { haptic } from "@/lib/haptics";
import { coverLayout, INSTAGRAM_MAX_RATIO, INSTAGRAM_MIN_RATIO, nearestInstagramRatio } from "@/lib/image-fit";
import { cropMedia, type MediaItem } from "@/lib/media";

type Choice = { key: string; label: string; ratio: number | null };

const CHOICES: Choice[] = [
  { key: "auto", label: "Auto", ratio: null },
  { key: "portrait", label: "4:5", ratio: INSTAGRAM_MIN_RATIO },
  { key: "square", label: "1:1", ratio: 1 },
  { key: "wide", label: "1,91:1", ratio: INSTAGRAM_MAX_RATIO },
];

/**
 * Recadrage d'une image pour Instagram : le format accepté le plus proche est proposé (on coupe le moins possible), le doigt
 * déplace l'image dans le cadre pour choisir ce qui reste. Le résultat devient un nouveau média, l'original est conservé.
 */
export function CropSheet({ item, onClose, onDone }: { item: MediaItem | null; onClose: () => void; onDone: (original: MediaItem, cropped: MediaItem) => void }) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [choice, setChoice] = useState<Choice>(CHOICES[0]);
  const [focus, setFocus] = useState({ x: 0.5, y: 0.5 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (item) {
      setChoice(CHOICES[0]);
      setFocus({ x: 0.5, y: 0.5 });
    }
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const iw = item?.width ?? 0;
  const ih = item?.height ?? 0;
  const ratio = choice.ratio ?? (iw && ih ? nearestInstagramRatio(iw, ih) : 1);

  // Cadre : toute la largeur, ou moins si le format est très vertical (la feuille ne défile pas, le doigt sert à déplacer l'image).
  const layout = useMemo(() => {
    const maxH = Math.min(screenH * 0.44, 420);
    let fw = screenW - 32;
    let fh = fw / ratio;
    if (fh > maxH) {
      fh = maxH;
      fw = fh * ratio;
    }
    const img = iw && ih ? coverLayout(iw, ih, fw, fh, focus.x, focus.y) : null;
    return { fw, fh, img };
  }, [screenW, screenH, ratio, iw, ih, focus.x, focus.y]);

  const live = useRef({ layout, focus });
  live.current = { layout, focus };
  const start = useRef({ x: 0.5, y: 0.5 });
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        start.current = live.current.focus;
      },
      onPanResponderMove: (_, g) => {
        const img = live.current.layout.img;
        if (!img) return;
        // Faire glisser l'image vers la droite montre sa partie gauche : le point de vue recule.
        const x = img.overflowX > 0 ? Math.min(1, Math.max(0, start.current.x - g.dx / img.overflowX)) : 0.5;
        const y = img.overflowY > 0 ? Math.min(1, Math.max(0, start.current.y - g.dy / img.overflowY)) : 0.5;
        setFocus({ x, y });
      },
    }),
  ).current;

  const apply = async () => {
    if (!item || busy) return;
    setBusy(true);
    const result = await cropMedia(item, { ratio: choice.ratio ?? undefined, fx: focus.x, fy: focus.y });
    setBusy(false);
    if (!result.ok || !result.item) {
      showToast(result.ok ? "Le recadrage a échoué. Réessayez." : result.error, "error");
      return;
    }
    haptic.success();
    onDone(item, result.item);
  };

  const uri = item?.url ?? item?.thumbUrl ?? null;

  return (
    <Sheet visible={item !== null} onClose={busy ? () => {} : onClose} title="Recadrer pour Instagram">
      <Text className="mb-3 font-jakarta text-[12.5px] text-ink-soft">Glissez l’image pour choisir la partie à garder. Instagram accepte les formats entre 4:5 et 1,91:1.</Text>

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
        {CHOICES.map((c) => {
          const on = c.key === choice.key;
          return (
            <Pressable
              key={c.key}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                haptic.select();
                setChoice(c);
              }}
              style={{ height: 36, flex: 1, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: on ? "#C6F432" : "#EFEDE7" }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: "#141414" }}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ alignItems: "center", marginBottom: 16 }}>
        <View
          {...pan.panHandlers}
          style={{ width: layout.fw, height: layout.fh, borderRadius: 16, overflow: "hidden", backgroundColor: "#EFEDE7" }}
        >
          {uri && layout.img ? (
            <Image
              source={{ uri }}
              contentFit="fill"
              style={{ position: "absolute", width: layout.img.width, height: layout.img.height, left: layout.img.left, top: layout.img.top }}
              pointerEvents="none"
            />
          ) : null}
          {/* Tiers : repères pour cadrer */}
          {[1 / 3, 2 / 3].map((p) => (
            <View key={`v${p}`} pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: layout.fw * p, width: 1, backgroundColor: "rgba(255,255,255,0.45)" }} />
          ))}
          {[1 / 3, 2 / 3].map((p) => (
            <View key={`h${p}`} pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: layout.fh * p, height: 1, backgroundColor: "rgba(255,255,255,0.45)" }} />
          ))}
        </View>
      </View>

      <PrimaryButton label="Appliquer le recadrage" icon="crop-outline" onPress={apply} loading={busy} />
      <View style={{ height: 8 }} />
    </Sheet>
  );
}
