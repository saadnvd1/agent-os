import * as Haptics from "expo-haptics";

// Fire and forget: a missing haptic engine is never an error.
export const haptic = {
  tap: () => Haptics.selectionAsync().catch(() => {}),
  press: () =>
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  send: () =>
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  success: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {}
    ),
  warn: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => {}
    ),
};
