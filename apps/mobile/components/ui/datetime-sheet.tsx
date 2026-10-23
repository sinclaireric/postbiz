import { Ionicons } from "@expo/vector-icons";
import { addDays, addHours, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, set, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { PrimaryButton, Sheet } from "@/components/ui/kit";

function Stepper({ label, value, onChange, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; max: number; step?: number }) {
  const wrap = (v: number) => ((v % (max + 1)) + (max + 1)) % (max + 1);
  return (
    <View className="flex-1 items-center rounded-[18px] bg-card py-2">
      <Text className="font-jakarta text-[11px] font-semibold uppercase text-ink-muted">{label}</Text>
      <View className="flex-row items-center gap-3">
        <Pressable className="h-10 w-10 items-center justify-center" hitSlop={6} accessibilityLabel={`${label} moins`} onPress={() => onChange(wrap(value - step))}>
          <Ionicons name="remove" size={22} color="#141414" />
        </Pressable>
        <Text className="w-[44px] text-center font-jakarta text-[28px] font-semibold text-ink">{String(value).padStart(2, "0")}</Text>
        <Pressable className="h-10 w-10 items-center justify-center" hitSlop={6} accessibilityLabel={`${label} plus`} onPress={() => onChange(wrap(value + step))}>
          <Ionicons name="add" size={22} color="#141414" />
        </Pressable>
      </View>
    </View>
  );
}

/** Choix d'une date et d'une heure (24 h) : calendrier du mois, réglage de l'heure, raccourcis. */
export function DateTimeSheet({ visible, onClose, value, onSave, title = "Date et heure" }: { visible: boolean; onClose: () => void; value: Date; onSave: (d: Date) => void; title?: string }) {
  const [draft, setDraft] = useState(value);
  const [month, setMonth] = useState(startOfMonth(value));
  useEffect(() => {
    if (visible) {
      setDraft(value);
      setMonth(startOfMonth(value));
    }
  }, [visible, value]);

  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) }), [month]);
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const past = draft.getTime() < Date.now();

  const presets: { label: string; date: () => Date }[] = [
    { label: "Dans 1 h", date: () => set(addHours(new Date(), 1), { seconds: 0, milliseconds: 0 }) },
    { label: "Demain 9 h", date: () => set(addDays(new Date(), 1), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 }) },
    { label: "Demain 18 h", date: () => set(addDays(new Date(), 1), { hours: 18, minutes: 0, seconds: 0, milliseconds: 0 }) },
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="font-jakarta text-[17px] font-semibold capitalize text-ink">{format(month, "MMMM yyyy", { locale: fr })}</Text>
        <View className="flex-row">
          <Pressable className="h-10 w-10 items-center justify-center" onPress={() => setMonth(addMonths(month, -1))} accessibilityLabel="Mois précédent">
            <Ionicons name="chevron-back" size={22} color="#141414" />
          </Pressable>
          <Pressable className="h-10 w-10 items-center justify-center" onPress={() => setMonth(addMonths(month, 1))} accessibilityLabel="Mois suivant">
            <Ionicons name="chevron-forward" size={22} color="#141414" />
          </Pressable>
        </View>
      </View>
      <View className="flex-row">
        {weeks[0].map((d) => (
          <Text key={d.toISOString()} className="flex-1 text-center font-jakarta text-[12px] font-semibold uppercase text-ink-muted">
            {format(d, "EEE", { locale: fr })}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0].toISOString()} className="flex-row">
          {week.map((d) => {
            const selected = isSameDay(d, draft);
            const inMonth = isSameMonth(d, month);
            const before = d < startOfDay(new Date());
            return (
              <Pressable key={d.toISOString()} onPress={() => setDraft(set(d, { hours: draft.getHours(), minutes: draft.getMinutes(), seconds: 0, milliseconds: 0 }))} className="h-[46px] flex-1 items-center justify-center">
                <View className={`h-[40px] w-[40px] items-center justify-center rounded-full ${selected ? "bg-brand" : ""}`}>
                  <Text className={`font-jakarta text-[16px] ${!inMonth || before ? "text-ink-muted/50" : selected ? "font-semibold text-ink" : isToday(d) ? "font-bold text-brand-ink" : "text-ink"}`}>{format(d, "d")}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}

      <View className="mt-3 flex-row items-center gap-3">
        <Stepper label="Heures" value={draft.getHours()} max={23} onChange={(h) => setDraft(set(draft, { hours: h }))} />
        <Text className="font-jakarta text-[28px] font-semibold text-ink">:</Text>
        <Stepper label="Minutes" value={draft.getMinutes()} max={59} step={5} onChange={(m) => setDraft(set(draft, { minutes: m }))} />
      </View>

      <View className="mt-3 flex-row flex-wrap gap-2">
        {presets.map((p) => (
          <Pressable key={p.label} onPress={() => { const d = p.date(); setDraft(d); setMonth(startOfMonth(d)); }} className="h-10 items-center justify-center rounded-full bg-chip-bg px-4">
            <Text className="font-jakarta text-[14px] font-medium text-ink">{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {past ? <Text className="mt-3 font-jakarta text-[13px] text-text-critical">Cette date est dans le passé.</Text> : null}
      <View className="mt-4">
        <PrimaryButton label={`Choisir le ${format(draft, "d MMM 'à' HH:mm", { locale: fr })}`} onPress={() => onSave(draft)} />
      </View>
    </Sheet>
  );
}
