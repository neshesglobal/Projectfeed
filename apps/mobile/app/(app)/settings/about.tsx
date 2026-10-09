import Constants from "expo-constants";
import { View } from "react-native";
import { API_URL } from "../../../src/api/client";
import { Header, Screen, Text } from "../../../src/components/ui";
import { space } from "../../../src/theme";

export default function About() {
  return (
    <Screen>
      <Header title="About" />
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text>Projectfeed {Constants.expoConfig?.version ?? ""}</Text>
        <Text muted size="sm">
          Operated by Neshes Global Ltd (England & Wales).
        </Text>
        <Text muted size="sm">
          Server: {API_URL}
        </Text>
      </View>
    </Screen>
  );
}
