// A file saved on this machine and attached to a message by reference: the
// message carries these, never the bytes.
export interface ChatFile {
  path: string;
  name: string;
  size: number;
  mediaType: string;
}
