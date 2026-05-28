# Mobile Host Service

## Overview
React Native mobile application for citizens to submit road complaints, track status, and receive notifications. Features offline-first architecture with local SQLite storage and real-time synchronization.

## Architecture
- **Framework**: React Native 0.73
- **Navigation**: React Navigation v6
- **State Management**: Redux Toolkit + RTK Query
- **Local Storage**: SQLite with react-native-sqlite-storage
- **Maps**: react-native-maps with Google Maps/Apple Maps
- **Camera**: react-native-image-picker
- **Notifications**: Firebase Cloud Messaging (FCM)
- **Security**: react-native-keychain for credential storage

## Key Features
- Offline-first complaint submission
- Photo/video capture and upload
- Real-time complaint tracking
- Push notifications
- Local road catalog caching
- Secure authentication
- Multi-language support
- Accessibility compliance

## Core Components

### Authentication
- `LoginScreen.tsx` - Phone number input and OTP verification
- `OTPScreen.tsx` - OTP code entry
- `AuthProvider.tsx` - Authentication context and token management

### Complaint Management
- `ComplaintSubmissionScreen.tsx` - New complaint form
- `ComplaintListScreen.tsx` - User's complaint history
- `ComplaintDetailScreen.tsx` - Individual complaint tracking
- `MediaCaptureScreen.tsx` - Photo/video capture interface

### Navigation
- `TabNavigator.tsx` - Bottom tab navigation
- `StackNavigator.tsx` - Screen stack navigation
- `DrawerNavigator.tsx` - Side drawer menu

### Offline Support
- `OfflineProvider.tsx` - Network status management
- `SyncManager.tsx` - Data synchronization logic
- `LocalStorage.tsx` - SQLite database operations

## Key Functions

### Authentication Flow
```typescript
// Authentication service
class AuthService {
  async sendOTP(phoneNumber: string): Promise<void> {
    const response = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneNumber })
    });
    
    if (!response.ok) {
      throw new Error('Failed to send OTP');
    }
  }
  
  async verifyOTP(phoneNumber: string, code: string): Promise<AuthResult> {
    const response = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneNumber, code })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      await this.storeTokens(data.accessToken, data.refreshToken);
      return { success: true, user: data.user };
    }
    
    return { success: false, error: data.error };
  }
  
  private async storeTokens(accessToken: string, refreshToken: string): Promise<void> {
    await Keychain.setInternetCredentials(
      'roadwatch_tokens',
      'user',
      JSON.stringify({ accessToken, refreshToken })
    );
  }
}
```

### Complaint Submission
```typescript
// Offline-first complaint submission
class ComplaintService {
  async submitComplaint(complaint: ComplaintData): Promise<string> {
    const complaintId = generateOfflineId();
    
    // Store locally first
    await this.storeLocalComplaint({
      ...complaint,
      id: complaintId,
      status: 'PENDING_SYNC',
      createdAt: new Date().toISOString()
    });
    
    // Attempt immediate sync if online
    if (await NetInfo.fetch().then(state => state.isConnected)) {
      try {
        await this.syncComplaint(complaintId);
      } catch (error) {
        console.log('Sync failed, will retry later:', error);
      }
    }
    
    return complaintId;
  }
  
  private async syncComplaint(id: string): Promise<void> {
    const localComplaint = await this.getLocalComplaint(id);
    if (!localComplaint || localComplaint.status === 'SYNCED') return;
    
    const formData = new FormData();
    formData.append('district', localComplaint.district);
    formData.append('zone', localComplaint.zone);
    formData.append('description', localComplaint.description);
    formData.append('lat', localComplaint.lat.toString());
    formData.append('lng', localComplaint.lng.toString());
    
    // Add photos
    localComplaint.photos.forEach((photo, index) => {
      formData.append('photos', {
        uri: photo.uri,
        type: photo.type,
        name: photo.name
      } as any);
    });
    
    const response = await fetch('/api/citizen/complaints', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${await this.getAccessToken()}`,
        'Content-Type': 'multipart/form-data'
      },
      body: formData
    });
    
    if (response.ok) {
      const result = await response.json();
      await this.updateLocalComplaint(id, {
        status: 'SYNCED',
        serverId: result.id
      });
    }
  }
}
```

### Media Capture
```typescript
// Camera and media handling
class MediaService {
  async capturePhoto(): Promise<MediaResult> {
    const options: ImagePickerOptions = {
      mediaType: 'photo',
      quality: 0.8,
      maxWidth: 1920,
      maxHeight: 1080,
      includeBase64: false
    };
    
    return new Promise((resolve, reject) => {
      ImagePicker.launchCamera(options, (response) => {
        if (response.didCancel || response.errorMessage) {
          reject(new Error(response.errorMessage || 'Cancelled'));
          return;
        }
        
        if (response.assets && response.assets[0]) {
          const asset = response.assets[0];
          resolve({
            uri: asset.uri!,
            type: asset.type!,
            name: asset.fileName || `photo_${Date.now()}.jpg`,
            size: asset.fileSize || 0
          });
        }
      });
    });
  }
  
  async compressImage(uri: string): Promise<string> {
    const result = await ImageResizer.createResizedImage(
      uri,
      1920,
      1080,
      'JPEG',
      80,
      0,
      undefined,
      false,
      { mode: 'contain', onlyScaleDown: true }
    );
    
    return result.uri;
  }
}
```

### Local Storage (SQLite)
```typescript
// SQLite database operations
class LocalStorageService {
  private db: SQLiteDatabase | null = null;
  
  async initDatabase(): Promise<void> {
    this.db = await SQLite.openDatabase({
      name: 'roadwatch.db',
      location: 'default'
    });
    
    await this.createTables();
  }
  
  private async createTables(): Promise<void> {
    const queries = [
      `CREATE TABLE IF NOT EXISTS complaints (
        id TEXT PRIMARY KEY,
        server_id TEXT,
        district TEXT NOT NULL,
        zone TEXT NOT NULL,
        description TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT DEFAULT 'PENDING'
      )`,
      
      `CREATE TABLE IF NOT EXISTS complaint_photos (
        id TEXT PRIMARY KEY,
        complaint_id TEXT NOT NULL,
        uri TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        uploaded BOOLEAN DEFAULT 0,
        FOREIGN KEY (complaint_id) REFERENCES complaints (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS roads_cache (
        id TEXT PRIMARY KEY,
        district_id TEXT NOT NULL,
        name TEXT NOT NULL,
        road_type TEXT NOT NULL,
        geometry TEXT,
        cached_at TEXT NOT NULL
      )`
    ];
    
    for (const query of queries) {
      await this.db!.executeSql(query);
    }
  }
  
  async storeComplaint(complaint: LocalComplaint): Promise<void> {
    const query = `
      INSERT OR REPLACE INTO complaints 
      (id, district, zone, description, lat, lng, status, created_at, updated_at, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    await this.db!.executeSql(query, [
      complaint.id,
      complaint.district,
      complaint.zone,
      complaint.description,
      complaint.lat,
      complaint.lng,
      complaint.status,
      complaint.createdAt,
      complaint.updatedAt,
      complaint.syncStatus || 'PENDING'
    ]);
  }
}
```

## Data Models

### Complaint
```typescript
interface LocalComplaint {
  id: string;
  serverId?: string;
  district: string;
  zone: string;
  description: string;
  lat: number;
  lng: number;
  status: ComplaintStatus;
  createdAt: string;
  updatedAt: string;
  syncStatus: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  photos: MediaAsset[];
}

interface MediaAsset {
  id: string;
  uri: string;
  type: string;
  name: string;
  size: number;
  uploaded: boolean;
}
```

### User
```typescript
interface User {
  id: string;
  phone: string;
  role: 'CITIZEN';
  districts: string[];
  zones: string[];
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}
```

## State Management (Redux)

### Store Configuration
```typescript
// Redux store setup
const store = configureStore({
  reducer: {
    auth: authSlice.reducer,
    complaints: complaintsSlice.reducer,
    offline: offlineSlice.reducer,
    notifications: notificationsSlice.reducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER]
      }
    }).concat(rtkQueryApi.middleware)
});
```

### Auth Slice
```typescript
const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null as User | null,
    tokens: null as AuthTokens | null,
    isAuthenticated: false,
    loading: false
  },
  reducers: {
    setUser: (state, action) => {
      state.user = action.payload;
      state.isAuthenticated = true;
    },
    setTokens: (state, action) => {
      state.tokens = action.payload;
    },
    logout: (state) => {
      state.user = null;
      state.tokens = null;
      state.isAuthenticated = false;
    }
  }
});
```

## Offline Synchronization

### Sync Manager
```typescript
class SyncManager {
  private syncInterval: NodeJS.Timeout | null = null;
  
  startPeriodicSync(): void {
    this.syncInterval = setInterval(async () => {
      if (await this.isOnline()) {
        await this.syncPendingComplaints();
        await this.syncComplaintUpdates();
      }
    }, 30000); // Sync every 30 seconds when online
  }
  
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
  
  private async syncPendingComplaints(): Promise<void> {
    const pendingComplaints = await LocalStorage.getPendingComplaints();
    
    for (const complaint of pendingComplaints) {
      try {
        await ComplaintService.syncComplaint(complaint.id);
      } catch (error) {
        console.error(`Failed to sync complaint ${complaint.id}:`, error);
      }
    }
  }
  
  private async syncComplaintUpdates(): Promise<void> {
    const lastSyncTime = await AsyncStorage.getItem('lastSyncTime');
    const updates = await ApiService.getComplaintUpdates(lastSyncTime);
    
    for (const update of updates) {
      await LocalStorage.updateComplaintStatus(update.id, update.status);
      await NotificationService.showLocalNotification({
        title: 'Complaint Update',
        body: `Your complaint ${update.id} status changed to ${update.status}`
      });
    }
    
    await AsyncStorage.setItem('lastSyncTime', new Date().toISOString());
  }
}
```

## Push Notifications

### FCM Integration
```typescript
class NotificationService {
  async initialize(): Promise<void> {
    // Request permission
    const authStatus = await messaging().requestPermission();
    const enabled = authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
                   authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    
    if (enabled) {
      // Get FCM token
      const token = await messaging().getToken();
      await this.registerToken(token);
      
      // Listen for token refresh
      messaging().onTokenRefresh(this.registerToken);
      
      // Handle foreground messages
      messaging().onMessage(this.handleForegroundMessage);
      
      // Handle background messages
      messaging().setBackgroundMessageHandler(this.handleBackgroundMessage);
    }
  }
  
  private async registerToken(token: string): Promise<void> {
    try {
      await ApiService.registerFCMToken(token);
    } catch (error) {
      console.error('Failed to register FCM token:', error);
    }
  }
  
  private handleForegroundMessage = (message: FirebaseMessagingTypes.RemoteMessage) => {
    if (message.notification) {
      this.showLocalNotification({
        title: message.notification.title || 'RoadWatch',
        body: message.notification.body || '',
        data: message.data
      });
    }
  };
  
  private handleBackgroundMessage = async (message: FirebaseMessagingTypes.RemoteMessage) => {
    console.log('Background message:', message);
    
    // Update local data if needed
    if (message.data?.complaintId) {
      await this.syncComplaintUpdate(message.data.complaintId);
    }
  };
}
```

## Configuration

### Environment Configuration
```typescript
// Config based on build environment
const Config = {
  API_BASE_URL: __DEV__ 
    ? 'http://localhost:3100/api'
    : 'https://api.roadwatch.gov.in/api',
  
  WEBSOCKET_URL: __DEV__
    ? 'ws://localhost:3100'
    : 'wss://api.roadwatch.gov.in',
  
  GOOGLE_MAPS_API_KEY: Platform.select({
    ios: 'AIzaSyC...',
    android: 'AIzaSyD...'
  }),
  
  SENTRY_DSN: 'https://...',
  
  FCM_SENDER_ID: '123456789',
  
  DATABASE_NAME: 'roadwatch.db',
  DATABASE_VERSION: 1
};
```

### Build Configuration
```javascript
// metro.config.js
module.exports = {
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
  resolver: {
    assetExts: ['bin', 'txt', 'jpg', 'png', 'json', 'mp4', 'ttf'],
  },
};
```

## Performance Optimizations
- Image compression before upload
- Lazy loading of complaint history
- Virtual list for large datasets
- Background sync with exponential backoff
- Efficient SQLite queries with indexes
- Memory management for media assets
- Bundle size optimization with Metro

## Security Features
- Secure token storage with Keychain
- Certificate pinning for API calls
- Local database encryption
- Biometric authentication support
- App transport security (ATS)
- Code obfuscation in production builds

## Testing Strategy
- Unit tests with Jest
- Component tests with React Native Testing Library
- E2E tests with Detox
- Device testing on multiple screen sizes
- Performance testing with Flipper
- Accessibility testing with screen readers

## Platform-Specific Features

### iOS
- Face ID/Touch ID authentication
- iOS-specific push notification handling
- App Store Connect integration
- iOS accessibility features

### Android
- Fingerprint authentication
- Android-specific notification channels
- Google Play Console integration
- Android accessibility services

## Deployment
- Automated builds with Fastlane
- Code signing for both platforms
- Over-the-air updates with CodePush
- Crash reporting with Crashlytics
- Performance monitoring with Firebase Performance