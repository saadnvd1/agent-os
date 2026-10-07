import { router, Stack, useLocalSearchParams } from "expo-router";
import { Button } from "~/components/ui/Button";
import { artifactUrl } from "~/components/chat/web/ArtifactCard";
import { SandboxWeb } from "~/components/chat/web/SandboxWeb";
import { authHeaders } from "~/lib/api/client";
import { useActiveMachine } from "~/lib/machines/store";

// An artifact full screen, scrollable and zoomable.
export default function ArtifactScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const machine = useActiveMachine();
  if (!machine || !id) return null;
  const url = artifactUrl(machine, id);
  return (
    <>
      <Stack.Screen
        options={{
          title: title ?? "Artifact",
          headerRight: () => (
            <Button
              label="Done"
              variant="ghost"
              compact
              onPress={() => router.back()}
            />
          ),
        }}
      />
      <SandboxWeb
        source={{ uri: url, headers: authHeaders(machine) }}
        home={url}
        fill
      />
    </>
  );
}
