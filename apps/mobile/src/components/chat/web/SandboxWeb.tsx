import * as Linking from "expo-linking";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { WebView, type WebViewProps } from "react-native-webview";
import { useTheme } from "~/lib/theme";
import {
  BRIDGE,
  MAX_MESSAGE,
  MESSAGE_GAP_MS,
  navigation,
  reportedHeight,
  TAP_WINDOW_MS,
} from "./sandbox";

interface Props {
  source: WebViewProps["source"];
  home: string;
  // Script injected before the page loads (mermaid), outside its CSP.
  prelude?: string;
  // Fills its container (full screen) instead of fitting the page's height.
  fill?: boolean;
  maxHeight?: number;
  onError?: () => void;
}

// Agent output in a WebView kept apart from the app: incognito (no cookies
// or storage shared), no file access, no navigation it didn't get a real tap
// for, and only small, rate-limited height reports crossing back.
export function SandboxWeb({
  source,
  home,
  prelude,
  fill,
  maxHeight = 520,
  onError,
}: Props) {
  const t = useTheme();
  const [height, setHeight] = useState(200);
  const [loading, setLoading] = useState(true);
  const touched = useRef(0);
  const last = useRef(0);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => void (timer.current && clearTimeout(timer.current)),
    []
  );

  const handle = (raw: string) => {
    if (raw.includes("mermaidError")) onError?.();
    const h = reportedHeight(raw, maxHeight);
    if (h !== null && !fill) setHeight(h);
  };

  return (
    <View
      style={[fill ? styles.fill : { height }, { backgroundColor: t.codeWash }]}
      onTouchStart={() => (touched.current = Date.now())}
    >
      <WebView
        source={source}
        originWhitelist={["*"]}
        incognito
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowsLinkPreview={false}
        allowsInlineMediaPlayback={false}
        mediaPlaybackRequiresUserAction
        setSupportMultipleWindows={false}
        injectedJavaScriptBeforeContentLoaded={
          prelude ? `${prelude}\n;${BRIDGE}` : BRIDGE
        }
        scrollEnabled={!!fill}
        style={styles.web}
        onLoadEnd={() => setLoading(false)}
        onError={() => onError?.()}
        onHttpError={() => onError?.()}
        onMessage={(e) => {
          const raw = e.nativeEvent.data;
          if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
          // At most one a tick; the latest wins.
          const wait = MESSAGE_GAP_MS - (Date.now() - last.current);
          if (wait <= 0) {
            last.current = Date.now();
            handle(raw);
            return;
          }
          pending.current = raw;
          timer.current ??= setTimeout(() => {
            timer.current = null;
            last.current = Date.now();
            if (pending.current) handle(pending.current);
            pending.current = null;
          }, wait);
        }}
        onShouldStartLoadWithRequest={(req) => {
          const decision = navigation(req, home);
          if (
            decision === "external" &&
            Date.now() - touched.current < TAP_WINDOW_MS
          ) {
            touched.current = 0;
            const host = (() => {
              try {
                return new URL(req.url).host;
              } catch {
                return req.url;
              }
            })();
            Alert.alert("Open this link?", host, [
              { text: "Cancel", style: "cancel" },
              { text: "Open", onPress: () => Linking.openURL(req.url) },
            ]);
          }
          return decision === "load";
        }}
      />
      {loading ? (
        <ActivityIndicator style={StyleSheet.absoluteFill} color={t.muted} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  web: { backgroundColor: "transparent" },
});
