# Authority Portal Service

## Overview
React-based web dashboard for authorities (Chief Engineers and Executive Engineers) to manage complaints, view analytics, and track performance metrics. Built with modern React patterns and real-time updates.

## Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Routing**: React Router v6
- **State Management**: React Context + Hooks
- **Maps**: Leaflet with React-Leaflet
- **Charts**: Recharts
- **Styling**: CSS Modules + Tailwind CSS
- **Real-time**: Server-Sent Events (SSE)

## Key Features
- Real-time complaint dashboard
- Interactive map visualization
- Performance analytics and KPIs
- Contractor management
- RTI request handling
- Multi-district/zone access control
- Responsive design for desktop and tablet

## Components Structure

### Core Components
- `App.tsx` - Main application component with routing
- `Dashboard.tsx` - Main dashboard with complaint overview
- `ComplaintList.tsx` - Paginated complaint listing
- `ComplaintDetail.tsx` - Individual complaint management
- `MapView.tsx` - Interactive map with complaint markers
- `Analytics.tsx` - Performance metrics and charts

### Layout Components
- `Header.tsx` - Navigation and user menu
- `Sidebar.tsx` - Navigation sidebar
- `Layout.tsx` - Main layout wrapper
- `LoadingSpinner.tsx` - Loading states
- `ErrorBoundary.tsx` - Error handling

### Form Components
- `ComplaintStatusForm.tsx` - Status update form
- `ContractorAssignmentForm.tsx` - Contractor assignment
- `EscalationForm.tsx` - Complaint escalation
- `FilterForm.tsx` - Complaint filtering

### Chart Components
- `ComplaintTrendChart.tsx` - Time-series complaint trends
- `StatusDistributionChart.tsx` - Status breakdown pie chart
- `PerformanceMetricsChart.tsx` - KPI dashboard
- `HotspotHeatmap.tsx` - Geographic hotspot visualization

## Key Functions

### Authentication & Authorization
```typescript
// Auth context for user management
const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  const login = async (token: string) => {
    // JWT token validation and user setup
  };
  
  const logout = () => {
    // Clear user session and redirect
  };
  
  return { user, login, logout, loading };
};
```

### Real-time Updates
```typescript
// SSE connection for live updates
const useRealTimeUpdates = () => {
  useEffect(() => {
    const eventSource = new EventSource('/api/events', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleComplaintUpdate(data);
    };
    
    return () => eventSource.close();
  }, []);
};
```

### Complaint Management
```typescript
// Complaint operations
const useComplaintOperations = () => {
  const updateStatus = async (id: string, status: ComplaintStatus, notes?: string) => {
    const response = await fetch(`/api/authority/complaints/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, notes })
    });
    return response.json();
  };
  
  const assignContractor = async (id: string, contractorId: string, expectedDays: number) => {
    const response = await fetch(`/api/authority/complaints/${id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractorId, expectedDays })
    });
    return response.json();
  };
  
  const escalateComplaint = async (id: string, reason: string) => {
    const response = await fetch(`/api/authority/complaints/${id}/escalate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    return response.json();
  };
  
  return { updateStatus, assignContractor, escalateComplaint };
};
```

### Map Integration
```typescript
// Leaflet map with complaint markers
const ComplaintMap: React.FC = () => {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [selectedComplaint, setSelectedComplaint] = useState<string | null>(null);
  
  const getMarkerColor = (status: ComplaintStatus) => {
    switch (status) {
      case 'PENDING': return 'red';
      case 'IN_PROGRESS': return 'yellow';
      case 'RESOLVED': return 'green';
      case 'REJECTED': return 'gray';
    }
  };
  
  return (
    <MapContainer center={[28.6139, 77.2090]} zoom={10}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {complaints.map(complaint => (
        <Marker
          key={complaint.id}
          position={[complaint.lat, complaint.lng]}
          icon={createIcon(getMarkerColor(complaint.status))}
          eventHandlers={{
            click: () => setSelectedComplaint(complaint.id)
          }}
        >
          <Popup>
            <ComplaintPopup complaint={complaint} />
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
};
```

### Analytics Dashboard
```typescript
// Performance metrics calculation
const useAnalytics = (timeRange: string) => {
  const [metrics, setMetrics] = useState<AnalyticsData | null>(null);
  
  useEffect(() => {
    const fetchAnalytics = async () => {
      const response = await fetch(`/api/authority/dashboard?range=${timeRange}`);
      const data = await response.json();
      setMetrics(data);
    };
    
    fetchAnalytics();
  }, [timeRange]);
  
  const calculateKPIs = (data: AnalyticsData) => {
    return {
      totalComplaints: data.complaints.length,
      resolvedRate: data.complaints.filter(c => c.status === 'RESOLVED').length / data.complaints.length,
      avgResolutionTime: calculateAverageResolutionTime(data.complaints),
      overdueComplaints: data.complaints.filter(c => isOverdue(c)).length,
      contractorPerformance: calculateContractorScores(data.assignments)
    };
  };
  
  return { metrics, calculateKPIs };
};
```

## Data Flow

### Complaint Management Flow
1. Authority views complaint list on dashboard
2. Clicks on complaint to view details
3. Updates status, assigns contractor, or escalates
4. Form submission triggers API call
5. Real-time update received via SSE
6. UI updates automatically without refresh
7. Analytics metrics recalculated

### Real-time Update Flow
1. SSE connection established on app load
2. Backend sends complaint updates via SSE
3. Frontend receives and parses events
4. State updated using React hooks
5. Components re-render with new data
6. Notifications shown for important updates

### Map Interaction Flow
1. Map loads with current complaint markers
2. User clicks on marker or area
3. Complaint details popup displayed
4. User can perform actions directly from map
5. Map updates in real-time as complaints change

## State Management

### Global State (Context)
```typescript
// App-wide state management
interface AppState {
  user: User | null;
  complaints: Complaint[];
  filters: ComplaintFilters;
  notifications: Notification[];
  loading: boolean;
}

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}>({} as any);

const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'SET_COMPLAINTS':
      return { ...state, complaints: action.payload };
    case 'UPDATE_COMPLAINT':
      return {
        ...state,
        complaints: state.complaints.map(c =>
          c.id === action.payload.id ? action.payload : c
        )
      };
    case 'ADD_NOTIFICATION':
      return {
        ...state,
        notifications: [...state.notifications, action.payload]
      };
    default:
      return state;
  }
};
```

### Local State (Hooks)
```typescript
// Component-level state for forms and UI
const ComplaintDetail: React.FC<{ id: string }> = ({ id }) => {
  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<ComplaintFormData>({});
  
  // Component logic here
};
```

## Routing Structure
```typescript
// React Router configuration
const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'complaints', element: <ComplaintList /> },
      { path: 'complaints/:id', element: <ComplaintDetail /> },
      { path: 'map', element: <MapView /> },
      { path: 'analytics', element: <Analytics /> },
      { path: 'contractors', element: <ContractorManagement /> },
      { path: 'rti', element: <RTIManagement /> },
      { path: 'profile', element: <Profile /> }
    ]
  },
  { path: '/login', element: <Login /> },
  { path: '/unauthorized', element: <Unauthorized /> }
]);
```

## Configuration

### Environment Variables
```typescript
// Vite environment configuration
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_MAP_TILE_URL: string;
  readonly VITE_WEBSOCKET_URL: string;
  readonly VITE_SENTRY_DSN: string;
}
```

### Build Configuration
```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          maps: ['leaflet', 'react-leaflet'],
          charts: ['recharts']
        }
      }
    }
  }
});
```

## Performance Optimizations
- React.memo for expensive components
- useMemo for complex calculations
- useCallback for event handlers
- Code splitting with React.lazy
- Virtual scrolling for large lists
- Debounced search and filters
- Image lazy loading
- Service worker for caching

## Security Features
- JWT token validation
- Role-based route protection
- XSS prevention via React's built-in escaping
- CSRF protection via SameSite cookies
- Content Security Policy headers
- Secure API communication over HTTPS

## Testing Strategy
- Unit tests with Jest and React Testing Library
- Integration tests for user workflows
- E2E tests with Playwright
- Visual regression tests
- Performance testing with Lighthouse
- Accessibility testing with axe-core

## Deployment
- Static build output via Vite
- CDN deployment for assets
- Environment-specific configuration
- Health check endpoints
- Error monitoring with Sentry
- Performance monitoring