import { proxy } from "valtio";

export interface FileOpenRequest {
  path: string;
  line: number;
  timestamp: number;
}

export const fileOpenStore = proxy<{
  request: FileOpenRequest | null;
}>({
  request: null,
});

export const fileOpenActions = {
  requestOpen: (path: string, line: number) => {
    fileOpenStore.request = {
      path,
      line,
      timestamp: Date.now(),
    };
  },
  clearRequest: () => {
    fileOpenStore.request = null;
  },
};
