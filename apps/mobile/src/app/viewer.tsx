import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "~/components/ui/Icon";
import { Text } from "~/components/ui/Text";
import { haptic } from "~/lib/haptics";
import { shareImage } from "~/lib/share-image";
import { HIT, space } from "~/lib/theme";
import { useViewer } from "~/lib/viewer";

// Full-screen images: swipe between them, pinch to zoom, Share or Save.
export default function ViewerScreen() {
  const { images, index } = useViewer();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [at, setAt] = useState(index);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    haptic.tap();
    await shareImage(images[at]).catch(() => haptic.warn());
    setBusy(false);
  };

  return (
    <View style={styles.fill}>
      <FlatList
        horizontal
        pagingEnabled
        data={images}
        initialScrollIndex={index}
        getItemLayout={(_, i) => ({
          length: width,
          offset: width * i,
          index: i,
        })}
        keyExtractor={(uri, i) => `${i}:${uri.slice(0, 64)}`}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) =>
          setAt(Math.round(e.nativeEvent.contentOffset.x / width))
        }
        renderItem={({ item }) => (
          <ScrollView
            style={{ width, height }}
            contentContainerStyle={styles.center}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Image
              source={{ uri: item }}
              style={{ width, height }}
              contentFit="contain"
            />
          </ScrollView>
        )}
      />
      <View style={[styles.bar, { top: insets.top + space.xs }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          style={styles.btn}
        >
          <Icon name="xmark" size={18} color="#fff" weight="semibold" />
        </Pressable>
        {images.length > 1 ? (
          <Text style={styles.count}>
            {at + 1} of {images.length}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share or save"
          disabled={busy}
          onPress={share}
          style={styles.btn}
        >
          <Icon
            name="square.and.arrow.up"
            size={18}
            color="#fff"
            weight="semibold"
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#000" },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  bar: {
    position: "absolute",
    left: space.md,
    right: space.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  btn: {
    width: HIT,
    height: HIT,
    borderRadius: HIT / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  count: { color: "#fff", fontSize: 13, fontWeight: "600" },
});
