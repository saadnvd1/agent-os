import * as Linking from "expo-linking";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView, type WebViewProps } from "react-native-webview";
import { useTheme } from "~/lib/theme";
import { BRIDGE, navigation, reportedHeight } from "./sandbox";

interface Props {
  source: WebViewProps["source"];
  home: string;
  // Fills its container (full screen) instead of fitting the page's height.
  fill?: boolean;
  maxHeight?: number;
  onError?: (why: string) => void;
}

// Agent output in a WebView kept apart from the app: incognito (no cookies
// or storage shared), no file access, no navigation it didn't get a tap
// for, and only a clamped height crossing back.
export function SandboxWeb({
  source,
  home,
  fill,
  maxHeight = 520,
  onError,
}: Props) {
  const t = useTheme();
  const [height, setHeight] = useState(200);
  const [loading, setLoading] = useState(true);
  return (
    <View
      style={[fill ? styles.fill : { height }, { backgroundColor: t.codeWash }]}
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
        injectedJavaScriptBeforeContentLoaded={BRIDGE}
        scrollEnabled={!!fill}
        style={styles.web}
        onLoadEnd={() => setLoading(false)}
        onError={(e) => onError?.(e.nativeEvent.description)}
        onHttpError={(e) => onError?.(`HTTP ${e.nativeEvent.statusCode}`)}
        onMessage={(e) => {
          const raw = e.nativeEvent.data;
          if (raw.includes("mermaidError")) {
            onError?.(raw.slice(0, 300));
          }
          const h = reportedHeight(raw, maxHeight);
          if (h !== null && !fill) setHeight(h);
        }}
        onShouldStartLoadWithRequest={(req) => {
          const decision = navigation(req, home);
          if (decision === "external") Linking.openURL(req.url);
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
