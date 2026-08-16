import { StatusBar } from 'expo-status-bar';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { RiskLevel } from '@careloop/shared';

const EMERGENCY_PHONE = 'tel:112';

function BigButton({
  label,
  color,
  onPress,
}: {
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.button, { backgroundColor: color }, pressed && styles.buttonPressed]}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>CareLoop</Text>
      <Text style={styles.subtitle}>Kepatuhan obat &amp; bantuan darurat</Text>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Obat berikutnya</Text>
        <Text style={styles.sectionValue}>Metformin 08:00</Text>
      </View>

      <BigButton
        label="💊 Sudah Minum"
        color="#16A34A"
        onPress={() => console.log('confirm taken')}
      />

      <BigButton
        label="📞 Panggil 112 (one-tap, bukan auto-dial)"
        color="#DC2626"
        onPress={() => Linking.openURL(EMERGENCY_PHONE)}
      />

      <Text style={styles.note}>
        shared import berfungsi: RiskLevel.HIGH = {RiskLevel.HIGH}
      </Text>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAF9',
    padding: 24,
    justifyContent: 'center',
    gap: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1C1917',
  },
  subtitle: {
    fontSize: 18,
    color: '#57534E',
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  sectionLabel: {
    fontSize: 16,
    color: '#57534E',
  },
  sectionValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1C1917',
  },
  button: {
    minHeight: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  note: {
    fontSize: 14,
    color: '#78716C',
    textAlign: 'center',
  },
});
