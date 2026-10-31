export interface ViewerMedia {
  kind: "image" | "video";
  src: string;
  alt: string;
  width: number;
  height: number;
  poster?: string;
}

/** The dark variant when the theme is dark and one exists. */
export function pickSrc(
  media: { src: string; srcDark?: string },
  dark: boolean
): string {
  return dark && media.srcDark ? media.srcDark : media.src;
}

export const SWIPE_CLOSE_PX = 80;

/** A mostly-vertical downward drag past the threshold closes the viewer. */
export function isCloseSwipe(dx: number, dy: number): boolean {
  return dy >= SWIPE_CLOSE_PX && dy > Math.abs(dx) * 1.2;
}
