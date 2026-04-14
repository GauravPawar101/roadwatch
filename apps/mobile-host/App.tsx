import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

// Monorepo Dependency Injections dynamically imported via Workspace Symlinks rigidly
import { DependencyProvider } from '@roadwatch/config/src/DIContainer';
import { indiaProductionConfig } from '@roadwatch/config/src/env/india-production';

// Explicitly isolated reactive feature arrays mapped natively!
import { ChatScreen } from '@roadwatch/feature-agent';
import { ComplaintScreen as ComplaintWizard } from '@roadwatch/feature-complaint';
import { MapScreen } from '@roadwatch/feature-map';

import { OnboardingNavigator } from './src/onboarding/OnboardingNavigator';
import { getOnboardingState } from './src/onboarding/storage';

import type { IAgentMemoryStore } from '@roadwatch/core/src/interfaces/storage/StorageInterfaces';
import { EncryptedAgentMemoryStore } from '@roadwatch/storage-sqlite';

// Standard execution matrices strongly mapping logical UI properties natively.
type RootStackParamList = {
  Onboarding: undefined;
  Map: undefined;
  Complaint: undefined;
  AgentChat: undefined;
};

// Isolates algorithmic stacks inherently cleanly safely
const Stack = createNativeStackNavigator<RootStackParamList>();

const MapScreenRoute = () => <MapScreen />;

/**
 * Top-Level Monorepo Host Anchor structurally mapped seamlessly uniting bounded architectural contexts globally!
 */
export default function App() {
  const [booting, setBooting] = useState(true);
  const [onboarded, setOnboarded] = useState(false);
  const [agentMemoryStore, setAgentMemoryStore] = useState<IAgentMemoryStore | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const state = await getOnboardingState();
        setOnboarded(state.done);

        // Best-effort: initialize encrypted cross-session agent memory.
        // If this fails (e.g., remote debugging mode), the app still runs but memory persistence is disabled.
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { open } = require('react-native-quick-sqlite');
          const conn = open({ name: 'roadwatch.db' });

          const db = {
            executeSql: async (sql: string, params: any[]) => {
              const res = await conn.executeAsync(sql, params);
              return { rows: { _array: res.rows?._array ?? [] } };
            }
          };

          const store = new EncryptedAgentMemoryStore({ db });
          await store.initialize();
          await store.prune({ maxRecords: 2000, maxBytes: 2 * 1024 * 1024 });
          setAgentMemoryStore(store);
        } catch (e) {
          console.warn('[AgentMemory] Disabled:', e);
        }
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  if (booting) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    // Top-Level Execution Anchor physically locking native logic securely into memory cleanly.
    <DependencyProvider config={indiaProductionConfig}>
      
      {/* Universal Physical Routing Boundaries explicitly defining application behavior. */}
      <NavigationContainer>
        <Stack.Navigator 
            initialRouteName={onboarded ? 'Map' : 'Onboarding'}
            screenOptions={{
              headerShown: true, // Retain hardware stack navigation structures properly
              headerTintColor: '#00D1FF',
              headerStyle: { backgroundColor: '#121212' },
              headerShadowVisible: false
            }}
        >
          <Stack.Screen
              name="Onboarding"
              component={OnboardingNavigator as any}
              options={{ headerShown: false }}
          />
          <Stack.Screen 
              name="Map" 
              component={MapScreenRoute}
              options={{ title: 'Global Operations Map' }} 
          />
          <Stack.Screen 
              name="Complaint" 
              component={ComplaintWizard} 
              options={{ title: 'Execute Verification locally' }} 
          />
          <Stack.Screen 
              name="AgentChat" 
              options={{ title: 'Hybrid Tactical Agent Engine' }}
          >
            {() => <ChatScreen memoryStore={agentMemoryStore ?? undefined} userId="anon" />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
      
    </DependencyProvider>
  );
}
