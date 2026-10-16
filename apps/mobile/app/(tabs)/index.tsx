import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AddPostSheet } from "@/components/calendar/add-post-sheet";
import { CalendarGrid } from "@/components/calendar/calendar-grid";
import { DatePill } from "@/components/calendar/date-pill";
import { DaySwiper } from "@/components/calendar/day-swiper";
import { DateTimePickerSheet } from "@/components/calendar/datetime-picker-sheet";
import { DragOverlay } from "@/components/calendar/drag-overlay";
import { MonthSelector } from "@/components/calendar/month-selector";
import { PostDetailSheet } from "@/components/calendar/post-detail-sheet";
import { TimelineView, type TimelineViewHandle } from "@/components/calendar/timeline-view";
import { AnimatedDropdown } from "@/components/ui/animated-dropdown";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MainTabNavbar } from "@/components/ui/main-tab-navbar";
import { NotificationBellButton } from "@/components/ui/notification-bell-button";
import { showToast } from "@/components/ui/toast";
import { TimelineDragProvider } from "@/contexts/timeline-drag-context";
import { usePostsStore } from "@/store/posts-store";
import type { ScheduledPost } from "@/types";
import {
  addMonths,
  subMonths,
  formatMonthName,
  generateTimeSlots,
  getCalendarDays,
  getPostsForDate,
  groupPostsByDate,
  set,
} from "@/utils/calendar";


export default function CalendarScreen() {
  const router = useRouter();

  // --- Global state ---
  const posts = usePostsStore((state) => state.posts);
  const storeDuplicatePost = usePostsStore((state) => state.duplicatePost);
  const storeDeletePost = usePostsStore((state) => state.deletePost);
  const storeReschedulePost = usePostsStore((state) => state.reschedulePost);

  // Fixed reference date — each carousel page computes its date from this
  const initialDate = useRef(new Date(new Date().setHours(0, 0, 0, 0))).current;

  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });
  const [currentMonth, setCurrentMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [monthSelectorOpen, setMonthSelectorOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<ScheduledPost | null>(null);
  const [selectedHour, setSelectedHour] = useState(9);
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledPost | null>(null);
  const [dateTimeTarget, setDateTimeTarget] = useState<Date | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);

  // --- Refs ---
  const timelineRef = useRef<TimelineViewHandle>(null);

  // --- Navigate to date/time after create/edit ---
  const navigateToDate = usePostsStore((state) => state.navigateToDate);
  const setNavigateToDate = usePostsStore((state) => state.setNavigateToDate);

  useEffect(() => {
    if (!navigateToDate) return;
    const date = new Date(navigateToDate);
    setNavigateToDate(null);

    // Update calendar to that date
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    setSelectedDate(dayStart);
    setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setMonthSelectorOpen(false);

    // Scroll timeline to the post's hour after a short delay to let the list update
    const hour = date.getHours();
    setTimeout(() => {
      timelineRef.current?.scrollToHour(hour);
    }, 400);
  }, [navigateToDate, setNavigateToDate]);

  // --- Sheet visibility ---
  const [postDetailVisible, setPostDetailVisible] = useState(false);
  const [addPostVisible, setAddPostVisible] = useState(false);
  const [dateTimeVisible, setDateTimeVisible] = useState(false);

  // --- Derived ---
  // Stable reference — only refreshes when selectedDate changes, not every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const referenceNow = useMemo(() => new Date(), [selectedDate]);

  const postsMap = useMemo(() => groupPostsByDate(posts), [posts]);
  const calendarDays = useMemo(
    () => getCalendarDays(currentMonth, selectedDate, postsMap),
    [currentMonth, selectedDate, postsMap],
  );
  const timeSlots = useMemo(() => generateTimeSlots(0, 23), []);

  const handleDayPress = useCallback((date: Date) => {
    setSelectedDate(date);
    setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setMonthSelectorOpen(false);
  }, []);

  const changeDate = useCallback((direction: number) => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + direction);
      next.setHours(0, 0, 0, 0);
      setCurrentMonth(new Date(next.getFullYear(), next.getMonth(), 1));
      return next;
    });
    timelineRef.current?.scrollToTop();
  }, []);

  // Day swiping is handled by DaySwiper component

  const handleNextMonth = useCallback(() => {
    setCurrentMonth((prev) => addMonths(prev, 1));
  }, []);

  const handlePrevMonth = useCallback(() => {
    setCurrentMonth((prev) => subMonths(prev, 1));
  }, []);

  const handlePostPress = useCallback((post: ScheduledPost) => {
    setSelectedPost(post);
    setPostDetailVisible(true);
  }, []);

  const handleSlotPress = useCallback((hour: number) => {
    setSelectedHour(hour);
    setSelectedMinute(0);
    setAddPostVisible(true);
  }, []);

  // Stable render function — only changes when posts change.
  // Each page computes its own date from initialDate + dayOffset (absolute, not relative).
  const renderDayPage = useCallback(
    (dayOffset: number) => {
      const date = new Date(initialDate);
      date.setDate(date.getDate() + dayOffset);
      date.setHours(0, 0, 0, 0);
      const pagePosts = getPostsForDate(posts, date);

      // Check if this page is the currently selected date
      const isCurrentPage =
        date.getDate() === selectedDate.getDate() &&
        date.getMonth() === selectedDate.getMonth() &&
        date.getFullYear() === selectedDate.getFullYear();

      return (
        <View className="flex-1 bg-background-primary">
          <DatePill selectedDate={date} />
          <View className="flex-1 px-4">
            <TimelineView
              timeSlots={timeSlots}
              posts={pagePosts}
              selectedDate={date}
              referenceNow={referenceNow}
              selectedPostId={isCurrentPage ? selectedPost?.id ?? null : null}
              selectedSlotHour={isCurrentPage && addPostVisible ? selectedHour : null}
              onSlotPress={handleSlotPress}
              onPostPress={handlePostPress}
            />
          </View>
        </View>
      );
    },
    [posts, initialDate, timeSlots, referenceNow, handleSlotPress, handlePostPress, selectedDate, selectedPost, addPostVisible, selectedHour],
  );


  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setPostDetailVisible(false);
    const result = await storeDeletePost(target.id);
    showToast(result.ok ? "Publication supprimée" : result.error, result.ok ? "success" : "error");
  }, [deleteTarget, storeDeletePost]);

  const handleDateTimeSave = useCallback(
    (newDate: Date) => {
      const fromPostDetail = !!editingPostId;
      if (editingPostId) {
        void storeReschedulePost(editingPostId, newDate.toISOString()).then((result) =>
          showToast(result.ok ? "Date et heure modifiées" : result.error, result.ok ? "success" : "error"),
        );
      } else {
        // Opened from Add Post sheet — update date/hour so the sheet below reflects it
        setSelectedDate(new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate()));
        setSelectedHour(newDate.getHours());
        setSelectedMinute(newDate.getMinutes());
      }
      setDateTimeVisible(false);
      setEditingPostId(null);
      // Reopen the parent sheet after date picker closes
      setTimeout(() => {
        if (fromPostDetail) {
          setPostDetailVisible(true);
        } else {
          setAddPostVisible(true);
        }
      }, 350);
    },
    [editingPostId, storeReschedulePost],
  );

  const handleCreatePost = useCallback(
    (dateTime: Date) => {
      setAddPostVisible(false);
      // Delay navigation so the AddPostSheet modal fully dismisses before
      // the create-post screen (containedTransparentModal) presents on iOS.
      setTimeout(() => {
        router.push({
          pathname: "/create-post",
          params: { dateTime: dateTime.toISOString() },
        } as any);
      }, 350);
    },
    [router],
  );

  const handlePostDrop = useCallback(
    (postId: string, newHour: number) => {
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      const newDate = set(new Date(post.scheduledAt), {
        hours: newHour,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      });
      void storeReschedulePost(postId, newDate.toISOString()).then((result) =>
        showToast(result.ok ? "Publication déplacée" : result.error, result.ok ? "success" : "error"),
      );
    },
    [posts, storeReschedulePost],
  );

  return (
    <SafeAreaView className="flex-1 bg-background-primary" edges={["top"]}>
      <TimelineDragProvider onDrop={handlePostDrop}>
      <StatusBar style="light" />

      <View className="h-[60px] flex-row items-center justify-between px-4">
        <MonthSelector
          currentMonth={currentMonth}
          isOpen={monthSelectorOpen}
          onToggle={() => setMonthSelectorOpen((o) => !o)}
        />
        <NotificationBellButton />
      </View>

      <DaySwiper
        onChangeDate={changeDate}
        enabled={!monthSelectorOpen}
        renderPage={renderDayPage}
      />

      <MainTabNavbar activeTab="calendar" />

      {/* Bottom Sheets */}
      <PostDetailSheet
        isVisible={postDetailVisible}
        post={selectedPost}
        onClose={() => {
          setPostDetailVisible(false);
          setSelectedPost(null);
        }}
        onEdit={(post) => {
          setPostDetailVisible(false);
          setTimeout(() => {
            router.push({
              pathname: "/create-post",
              params: {
                postId: post.id,
                mode: "edit",
                dateTime: post.scheduledAt,
                content: post.content,
                imageUri: post.imageUri ?? "",
                network: post.network,
                channelId: post.channelId,
              },
            } as any);
          }, 350);
        }}
        onDuplicate={(post) => {
          setPostDetailVisible(false);
          // La copie est enregistrée comme brouillon, puis ouverte pour être relue avant d'être programmée.
          void storeDuplicatePost(post.id).then((result) => {
            if (!result.ok || !result.id) {
              showToast(result.ok ? "Copie impossible" : result.error, "error");
              return;
            }
            const newId = result.id;
            setTimeout(() => {
              router.push({
                pathname: "/create-post",
                params: {
                  postId: newId,
                  mode: "edit",
                  dateTime: post.scheduledAt,
                  content: post.content,
                  imageUri: post.imageUri ?? "",
                  network: post.network,
                  channelId: post.channelId,
                },
              } as any);
            }, 350);
          });
        }}
        onDelete={(post) => {
          setPostDetailVisible(false);
          setTimeout(() => setDeleteTarget(post), 350);
        }}
        onChangeDateTime={(post) => {
          setPostDetailVisible(false);
          setEditingPostId(post.id);
          setDateTimeTarget(new Date(post.scheduledAt));
          setTimeout(() => setDateTimeVisible(true), 500);
        }}
      />

      <AddPostSheet
        isVisible={addPostVisible}
        selectedDate={selectedDate}
        selectedHour={selectedHour}
        selectedMinute={selectedMinute}
        onClose={() => setAddPostVisible(false)}
        onCreatePost={handleCreatePost}
        onChangeDateTime={() => {
          setAddPostVisible(false);
          setDateTimeTarget(
            set(selectedDate, {
              hours: selectedHour,
              minutes: selectedMinute,
              seconds: 0,
            }),
          );
          setTimeout(() => setDateTimeVisible(true), 500);
        }}
      />

      {dateTimeTarget && (
        <DateTimePickerSheet
          isVisible={dateTimeVisible}
          initialDate={dateTimeTarget}
          onSave={handleDateTimeSave}
          onClose={() => {
            const fromPostDetail = !!editingPostId;
            setDateTimeVisible(false);
            setEditingPostId(null);
            setTimeout(() => {
              setDateTimeTarget(null);
              // Reopen the parent sheet
              if (fromPostDetail) {
                setPostDetailVisible(true);
              } else {
                setAddPostVisible(true);
              }
            }, 350);
          }}
        />
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Êtes-vous sûr ?"
        message="Voulez-vous vraiment supprimer cette publication ?"
        confirmLabel="Oui, supprimer"
        cancelLabel="Non, annuler"
        confirmDestructive
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteTarget(null);
          setTimeout(() => setPostDetailVisible(true), 350);
        }}
      />

      <DragOverlay />
      </TimelineDragProvider>

      {/* Calendar overlay — rendered last so it's on top on iOS without z-index */}
      <AnimatedDropdown
        visible={monthSelectorOpen}
        onClose={() => setMonthSelectorOpen(false)}
        anchor="top-left"
        style={{ position: "absolute", left: 16, right: 16, top: Platform.OS === "ios" ? 115 : 70, elevation: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12 }}
      >
        <View className="rounded-[8px] bg-main-sections-2 p-4">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="font-jakarta text-h4 font-semibold text-text-primary">
              {formatMonthName(currentMonth)}, {currentMonth.getFullYear()}
            </Text>
            <View className="flex-row gap-2">
              <Pressable
                onPress={handlePrevMonth}
                className="h-8 w-8 items-center justify-center"
              >
                <Ionicons name="chevron-back" size={18} className="text-icon-primary" />
              </Pressable>
              <Pressable
                onPress={handleNextMonth}
                className="h-8 w-8 items-center justify-center"
              >
                <Ionicons name="chevron-forward" size={18} className="text-icon-primary" />
              </Pressable>
            </View>
          </View>

          <CalendarGrid days={calendarDays} onDayPress={handleDayPress} />
        </View>
      </AnimatedDropdown>
    </SafeAreaView>
  );
}
