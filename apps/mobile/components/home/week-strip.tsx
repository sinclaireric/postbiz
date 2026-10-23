import { addDays, addWeeks, format, isSameDay, isToday, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { useMemo, useRef } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";

/** Bande de la semaine (lundi → dimanche) : point sous les jours qui ont des publications, balayage pour changer de semaine. */
export function WeekStrip({
  selectedDate,
  onSelect,
  hasPosts,
}: {
  selectedDate: Date;
  onSelect: (d: Date) => void;
  hasPosts: (d: Date) => boolean;
}) {
  const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Les valeurs courantes sont lues via une ref : le PanResponder n'est créé qu'une fois.
  const latest = useRef({ selectedDate, onSelect });
  latest.current = { selectedDate, onSelect };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) < 40) return;
        latest.current.onSelect(addWeeks(latest.current.selectedDate, g.dx < 0 ? 1 : -1));
      },
    }),
  ).current;

  return (
    <View
      {...pan.panHandlers}
      className="mx-4 flex-row rounded-[28px] bg-card px-2 py-3"
      style={{ shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}
    >
      {days.map((d) => {
        const selected = isSameDay(d, selectedDate);
        return (
          <Pressable key={d.toISOString()} onPress={() => onSelect(d)} className="flex-1 items-center gap-2" accessibilityLabel={format(d, "EEEE d MMMM", { locale: fr })}>
            <Text className="font-jakarta text-[13px] font-semibold uppercase text-ink-soft">{format(d, "EEE", { locale: fr })}</Text>
            <View className={`h-[46px] w-[46px] items-center justify-center rounded-full ${selected ? "bg-brand" : ""}`}>
              <Text className={`font-jakarta text-[22px] ${selected ? "font-semibold text-ink" : isToday(d) ? "font-bold text-brand-ink" : "text-ink"}`}>{format(d, "d")}</Text>
            </View>
            <View className={`h-[6px] w-[6px] rounded-full ${hasPosts(d) ? "bg-brand-ink" : ""}`} />
          </Pressable>
        );
      })}
    </View>
  );
}
