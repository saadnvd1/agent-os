// One frame of a screen or window the user picks, as a PNG file. Desktop
// browsers only: phones have no getDisplayMedia.

export const canCaptureScreen = (): boolean =>
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
  !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export async function captureScreenFrame(): Promise<File | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  } catch (error) {
    // Cancelled in the browser's picker.
    if (error instanceof DOMException && error.name === "NotAllowedError")
      return null;
    throw error;
  }
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // The first frame can arrive blank: wait for one with a size.
    await new Promise<void>((resolve) => {
      const ready = () =>
        video.videoWidth > 0 ? resolve() : requestAnimationFrame(ready);
      ready();
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    video.srcObject = null;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return new File([blob], `screen-${stamp}.png`, { type: "image/png" });
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
