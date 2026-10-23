import { useCallback, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, useWindowDimensions, View, type ViewInstance } from "react-native";

export type Anchor = { x: number; y: number; width: number; height: number };

/** Mesure un élément à l'écran pour y accrocher une bulle : `ref` à poser sur la vue, `open()` pour afficher. */
export function useAnchor() {
  const ref = useRef<ViewInstance>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const open = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  }, []);
  const close = useCallback(() => setAnchor(null), []);
  return { ref, anchor, open, close };
}

/** Bulle blanche ancrée sous un élément (menu du compte, actions d'une carte, sélecteur de canal). */
export function Popover({
  anchor,
  onClose,
  children,
  width = 280,
  align = "right",
  matchAnchorWidth = false,
}: {
  anchor: Anchor | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: "left" | "right";
  matchAnchorWidth?: boolean;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  if (!anchor) return null;
  const w = matchAnchorWidth ? Math.max(anchor.width, width) : width;
  const rawLeft = align === "right" ? anchor.x + anchor.width - w : anchor.x;
  const left = Math.min(Math.max(12, rawLeft), screenW - w - 12);
  // Sous l'élément si la place le permet, sinon au-dessus.
  const below = anchor.y + anchor.height + 8;
  const placeAbove = below > screenH * 0.62 && anchor.y > screenH * 0.4;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Fermer">
        <View
          onStartShouldSetResponder={() => true}
          style={[
            {
              position: "absolute",
              left,
              width: w,
              backgroundColor: "#FFFFFF",
              borderRadius: 22,
              borderWidth: 1,
              borderColor: "#E7E5DF",
              shadowColor: "#000",
              shadowOpacity: 0.16,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 8 },
              elevation: 12,
              overflow: "hidden",
            },
            placeAbove ? { bottom: screenH - anchor.y + 8 } : { top: below },
          ]}
        >
          {children}
        </View>
      </Pressable>
    </Modal>
  );
}
