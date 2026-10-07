// What the full-screen image viewer shows: a set of images and where to
// start. Opening it pushes the /viewer route.
import { router } from "expo-router";
import { createStore } from "~/lib/store";

export interface Viewer {
  images: string[];
  index: number;
}

const store = createStore<Viewer>({ images: [], index: 0 });
export const useViewer = store.use;

export function openImages(images: string[], index = 0): void {
  if (!images.length) return;
  store.set({ images, index: Math.max(0, Math.min(index, images.length - 1)) });
  router.push("/viewer");
}

export const openImage = (uri: string) => openImages([uri]);
