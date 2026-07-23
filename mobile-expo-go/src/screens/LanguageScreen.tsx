import { StyleSheet, View } from "react-native";
import { Brand, Button } from "../components/Ui";
import { Text, useI18n } from "../i18n";
import { colors } from "../theme";

export function LanguageScreen() {
  const { setLanguage } = useI18n();
  return (
    <View style={styles.root}>
      <Brand />
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>WELCOME · HOŞ GELDİN</Text>
        <Text style={styles.title}>Choose your language.</Text>
        <Text style={styles.titleTurkish}>Dilini seç.</Text>
        <Text style={styles.description}>
          You can change this later in Settings. · Bu tercihi daha sonra Ayarlar bölümünden değiştirebilirsin.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button label="Türkçe" onPress={() => void setLanguage("tr")} tone="dark" />
        <Button label="English" onPress={() => void setLanguage("en")} tone="light" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.paper,
    flex: 1,
    justifyContent: "center",
    padding: 28,
  },
  copy: { marginBottom: 34, marginTop: 56 },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: "900", letterSpacing: 1.8 },
  title: { color: colors.ink, fontSize: 34, fontWeight: "900", letterSpacing: -1.5, lineHeight: 38, marginTop: 13 },
  titleTurkish: { color: colors.muted, fontSize: 29, fontWeight: "800", letterSpacing: -1, lineHeight: 34 },
  description: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 18 },
  actions: { gap: 10 },
});
