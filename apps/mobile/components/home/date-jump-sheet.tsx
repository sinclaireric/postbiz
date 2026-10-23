import { Ionicons } from "@expo/vector-icons";
import { addMonths, addYears, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Sheet } from "@/components/ui/kit";
import { haptic } from "@/lib/haptics";

/** « Aller à une date » : calendrier du mois avec un point sous les jours qui ont des publications, et raccourcis. */
export function DateJumpSheet({
  visible,
  onClose,
  selectedDate,
  onSelect,
  hasPosts,
}: {
  visible: boolean;
  onClose: () => void;
  selectedDate: Date;
  onSelect: (d: Date) => void;
  hasPosts: (d: Date) => boolean;
}) {
  const [month, setMonth] = useState(startOfMonth(selectedDate));
  useEffect(() => {
    if (visible) setMonth(startOfMonth(selectedDate));
  }, [visible, selectedDate]);

  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) }), [month]);
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const title = format(month, "MMMM yyyy", { locale: fr });

  const pick = (d: Date) => {
    haptic.select();
    onSelect(d);
    onClose();
  };
  const today = new Date();
  const shortcuts: { label: string; date: Date }[] = [
    { label: "−1 an", date: addYears(today, -1) },
    { label: "−6 mois", date: addMonths(today, -6) },
    { label: "Aujourd’hui", date: today },
    { label: "+6 mois", date: addMonths(today, 6) },
    { label: "+1 an", date: addYears(today, 1) },
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title="Aller à une date">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="font-jakarta text-[15px] font-semibold capitalize text-ink">{title}</Text>
        <View className="flex-row gap-1">
          <Pressable className="h-10 w-10 items-center justify-center" onPress={() => setMonth(addMonths(month, -1))} accessibilityLabel="Mois précédent">
            <Ionicons name="chevron-back" size={22} color="#141414" />
          </Pressable>
          <Pressable className="h-10 w-10 items-center justify-center" onPress={() => setMonth(addMonths(month, 1))} accessibilityLabel="Mois suivant">
            <Ionicons name="chevron-forward" size={22} color="#141414" />
          </Pressable>
        </View>
      </View>

      <View className="flex-row pb-1">
        {weeks[0].map((d) => (
          <Text key={d.toISOString()} className="flex-1 text-center font-jakarta text-[11px] font-semibold uppercase text-ink-muted">
            {format(d, "EEE", { locale: fr })}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0].toISOString()} className="flex-row">
          {week.map((d) => {
            const inMonth = isSameMonth(d, month);
            const selected = isSameDay(d, selectedDate);
            return (
              <Pressable key={d.toISOString()} onPress={() => pick(d)} className="h-[54px] flex-1 items-center justify-center">
                <View className={`h-[44px] w-[44px] items-center justify-center rounded-full ${selected ? "bg-brand" : ""}`}>
                  <Text className={`font-jakarta text-[15px] ${!inMonth ? "text-ink-muted/50" : selected ? "font-semibold text-ink" : isToday(d) ? "font-bold text-brand-ink" : "text-ink"}`}>{format(d, "d")}</Text>
                </View>
                <View className={`absolute bottom-[2px] h-[5px] w-[5px] rounded-full ${hasPosts(d) ? "bg-brand-ink" : ""}`} />
              </Pressable>
            );
          })}
        </View>
      ))}

      <View className="mt-4 flex-row flex-wrap gap-2">
        {shortcuts.map((s) => (
          <Pressable key={s.label} onPress={() => pick(s.date)} className="h-11 items-center justify-center rounded-full bg-chip-bg px-4">
            <Text className="font-jakarta text-[13.5px] font-medium text-ink">{s.label}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}
