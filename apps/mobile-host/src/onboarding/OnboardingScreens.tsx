import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Button,
    PermissionsAndroid,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import {
    fetchCountries,
    fetchDistrictRoads,
    fetchDistricts,
    fetchOfflineManifest,
    fetchStates,
    type Country,
    type District,
    type Road,
    type State
} from './api';
import {
    cacheRoads,
    resetOnboarding,
    setCountryState,
    setDistrict,
    setOfflineDownloaded,
    setOnboardingDone
} from './storage';

export function WelcomeScreen({ navigation }: any) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Welcome to RoadWatch</Text>
      <Text style={styles.body}>
        First time setup: permissions, district selection, and optional offline download.
      </Text>
      <View style={styles.actions}>
        <Button title="Start setup" onPress={() => navigation.navigate('Permissions')} />
        <View style={styles.spacer} />
        <Button title="Dev menu" color="#666" onPress={() => navigation.navigate('DevMenu')} />
      </View>
    </View>
  );
}

export function PermissionsScreen({ navigation }: any) {
  const [locationGranted, setLocationGranted] = useState(false);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [notificationsGranted, setNotificationsGranted] = useState(false);

  async function requestAll() {
    if (Platform.OS !== 'android') {
      Alert.alert('iOS permissions', 'Wire iOS permission prompts via native Info.plist entries.');
      setLocationGranted(true);
      setCameraGranted(true);
      setNotificationsGranted(true);
      return;
    }

    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.CAMERA,
      // Android 13+
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS
    ]);

    const resultsByPermission = results as Record<string, string>;
    const fineLocation = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION!;
    const camera = PermissionsAndroid.PERMISSIONS.CAMERA!;

    setLocationGranted(resultsByPermission[fineLocation] === 'granted');
    setCameraGranted(resultsByPermission[camera] === 'granted');

    const postNot = (PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS as string | undefined;
    if (postNot) {
      setNotificationsGranted(resultsByPermission[postNot] === 'granted');
    } else {
      setNotificationsGranted(true);
    }
  }

  const canContinue = locationGranted && cameraGranted;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Permissions</Text>
      <Text style={styles.body}>We need GPS + Camera for complaint evidence. Notifications are recommended.</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Status</Text>
        <Text>Location: {locationGranted ? 'Granted' : 'Not granted'}</Text>
        <Text>Camera: {cameraGranted ? 'Granted' : 'Not granted'}</Text>
        <Text>Notifications: {notificationsGranted ? 'Granted' : 'Not granted'}</Text>
      </View>

      <View style={styles.actions}>
        <Button title="Request permissions" onPress={requestAll} />
        <View style={styles.spacer} />
        <Button
          title="Continue"
          onPress={() => navigation.navigate('District')}
          disabled={!canContinue}
        />
      </View>
    </ScrollView>
  );
}

export function DistrictSelectionScreen({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [countries, setCountries] = useState<Country[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);

  const [selectedCountry, setSelectedCountry] = useState<string>('IN');
  const [selectedState, setSelectedState] = useState<string>('DL');

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const cs = await fetchCountries();
        setCountries(cs);
      } catch (e: any) {
        Alert.alert('Failed to load countries', e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const ss = await fetchStates(selectedCountry);
        setStates(ss);
        // Default to first state if current selection is invalid
        const preferred = ss.find((s) => s.code === selectedState) ?? ss[0];
        if (preferred) setSelectedState(preferred.code);
      } catch (e: any) {
        Alert.alert('Failed to load states', e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCountry]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const ds = await fetchDistricts(selectedCountry, selectedState);
        setDistricts(ds);
        await setCountryState(selectedCountry, selectedState);
      } catch (e: any) {
        Alert.alert('Failed to load districts', e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedCountry, selectedState]);

  if (loading) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
        <Text style={styles.body}>Loading regions…</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Choose your district</Text>
      <Text style={styles.body}>This controls offline downloads and map caching.</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Country</Text>
        <View style={styles.rowWrap}>
          {countries.map((c) => (
            <Chip
              key={c.code}
              label={`${c.name} (${c.code})`}
              selected={c.code === selectedCountry}
              onPress={() => setSelectedCountry(c.code)}
            />
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>State</Text>
        <View style={styles.rowWrap}>
          {states.map((s) => (
            <Chip
              key={s.code}
              label={`${s.name} (${s.code})`}
              selected={s.code === selectedState}
              onPress={() => setSelectedState(s.code)}
            />
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>District</Text>
        {districts.map((d) => (
          <TouchableOpacity
            key={d.id}
            style={styles.listItem}
            onPress={async () => {
              await setDistrict(d.id);
              navigation.navigate('OfflineDownload', { districtId: d.id });
            }}
          >
            <Text style={styles.listItemTitle}>{d.name}</Text>
            <Text style={styles.muted}>{d.code}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

export function OfflineDownloadScreen({ navigation, route }: any) {
  const districtId: string = route?.params?.districtId;

  const [busy, setBusy] = useState(false);
  const [roads, setRoads] = useState<Road[]>([]);

  const help = useMemo(
    () =>
      `Recommended: download on Wi‑Fi. This step fetches a district manifest + road index and stores it locally.`,
    []
  );

  async function download() {
    try {
      setBusy(true);
      const manifest = await fetchOfflineManifest(districtId);
      const r = await fetchDistrictRoads(manifest.roadsUrl);
      setRoads(r);
      await cacheRoads(r);
      await setOfflineDownloaded(true);

      Alert.alert('Offline package ready', `Cached ${r.length} roads locally.`);
    } catch (e: any) {
      Alert.alert('Offline download failed', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Offline download</Text>
      <Text style={styles.body}>{help}</Text>

      <View style={styles.actions}>
        <Button title={busy ? 'Downloading…' : 'Download now'} onPress={download} disabled={busy} />
        <View style={styles.spacer} />
        <Button
          title="Finish"
          onPress={async () => {
            await setOnboardingDone();
            navigation.reset({ index: 0, routes: [{ name: 'Complete' }] });
          }}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Cached road index</Text>
        <Text style={styles.muted}>{roads.length} roads</Text>
      </View>
    </ScrollView>
  );
}

export function CompleteScreen({ navigation }: any) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Setup complete</Text>
      <Text style={styles.body}>You can now file complaints and work offline.</Text>
      <View style={styles.actions}>
        <Button title="Go to app" onPress={() => navigation.replace('Main')} />
      </View>
    </View>
  );
}

export function DevMenuScreen() {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Dev menu</Text>
      <Text style={styles.body}>Local-only helpers for development builds.</Text>
      <View style={styles.actions}>
        <Button
          title="Reset onboarding"
          color="#b00"
          onPress={async () => {
            await resetOnboarding();
            Alert.alert('Reset complete', 'Restart the app to see onboarding again.');
          }}
        />
      </View>
    </ScrollView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected ? styles.chipSelected : null]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 16, justifyContent: 'center', backgroundColor: '#F7FAFC' },
  title: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 8 },
  body: { fontSize: 14, color: '#4B5563', lineHeight: 20 },
  muted: { fontSize: 12, color: '#6B7280' },

  actions: { marginTop: 16 },
  spacer: { height: 10 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF', marginTop: 14 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#111827', marginBottom: 8 },
  listItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  listItemTitle: { fontSize: 16, fontWeight: '600' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 999,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#FFFFFF'
  },
  chipSelected: { backgroundColor: '#111827', borderColor: '#111827' },
  chipText: { fontSize: 12, color: '#222' },
  chipTextSelected: { color: '#fff' }
});
