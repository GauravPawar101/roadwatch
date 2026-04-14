import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
    CompleteScreen,
    DevMenuScreen,
    DistrictSelectionScreen,
    OfflineDownloadScreen,
    PermissionsScreen,
    WelcomeScreen
} from './OnboardingScreens';

export type OnboardingStackParamList = {
  Welcome: undefined;
  Permissions: undefined;
  District: undefined;
  OfflineDownload: { districtId: string };
  Complete: undefined;
  DevMenu: undefined;
  Main: undefined;
};

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingNavigator() {
  return (
    <Stack.Navigator initialRouteName="Welcome" screenOptions={{ headerShown: true }}>
      <Stack.Screen name="Welcome" component={WelcomeScreen as any} />
      <Stack.Screen name="Permissions" component={PermissionsScreen as any} />
      <Stack.Screen name="District" component={DistrictSelectionScreen as any} options={{ title: 'Select district' }} />
      <Stack.Screen name="OfflineDownload" component={OfflineDownloadScreen as any} options={{ title: 'Offline download' }} />
      <Stack.Screen name="Complete" component={CompleteScreen as any} options={{ headerLeft: () => null }} />
      <Stack.Screen name="DevMenu" component={DevMenuScreen as any} options={{ title: 'Dev menu' }} />
    </Stack.Navigator>
  );
}
