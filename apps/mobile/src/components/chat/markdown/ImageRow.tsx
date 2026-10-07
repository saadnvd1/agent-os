import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { radius, space, useTheme } from "~/lib/theme";
import { openImages } from "~/lib/viewer";

// Images in a reply at their own aspect ratio, up to the column width;
// a tap opens them full screen, with every image in the reply to swipe.
export function ImageRow({ images, all }: { images: string[]; all: string[] }) {
  return (
    <View style={styles.row}>
      {images.map((uri, i) => (
        <InlineImage
          key={`${i}:${uri.slice(0, 64)}`}
          uri={uri}
          onPress={() => openImages(all, all.indexOf(uri))}
        />
      ))}
    </View>
  );
}

export function InlineImage({
  uri,
  onPress,
  size,
}: {
  uri: string;
  onPress: () => void;
  size?: number;
}) {
  const t = useTheme();
  const [ratio, setRatio] = useState(4 / 3);
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="Open image"
      onPress={onPress}
    >
      <Image
        source={{ uri }}
        onLoad={(e) =>
          e.source.width && setRatio(e.source.width / e.source.height)
        }
        style={[
          size
            ? { width: size, height: size }
            : { width: "100%", aspectRatio: ratio, maxHeight: 420 },
          styles.img,
          { backgroundColor: t.codeWash },
        ]}
        contentFit={size ? "cover" : "contain"}
        transition={150}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.sm },
  img: { borderRadius: radius.lg },
});
