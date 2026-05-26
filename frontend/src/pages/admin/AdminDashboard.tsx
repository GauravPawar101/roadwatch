import { motion } from 'framer-motion';
import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useAdminContractors, useAdminRegions, useAdminRoads, useAdminUsers } from '../../hooks/useAdmin';

type TabType = 'users' | 'contractors' | 'regions' | 'roads';

export default function AdminDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('users');

  // Check if user has admin permissions
  if (user?.role !== 'CE' && user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="page-radial-bg min-h-screen text-on-surface flex items-center justify-center">
        <div className="text-center glass-panel rounded-2xl p-8">
          <div className="w-16 h-16 bg-error-container rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-error text-[32px]">block</span>
          </div>
          <h1 className="text-2xl font-bold text-on-surface mb-2">Access Denied</h1>
          <p className="text-on-surface-variant">You don't have permission to access the admin panel.</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'users' as TabType, label: 'Users', icon: 'people' },
    { id: 'contractors' as TabType, label: 'Contractors', icon: 'engineering' },
    { id: 'regions' as TabType, label: 'Regions', icon: 'map' },
    { id: 'roads' as TabType, label: 'Roads', icon: 'route' }
  ];

  return (
    <div className="page-radial-bg min-h-screen text-on-surface">
      <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-secondary-container/60 to-transparent pointer-events-none" />

      {/* Header */}
      <div className="relative glass-panel rounded-none border-x-0 border-t-0">
        <div className="container-max">
          <div className="py-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-on-surface">Admin Dashboard</h1>
                <p className="text-on-surface-variant mt-1">Manage users, contractors, regions, and roads</p>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary-container rounded-full border border-outline-variant">
                <span className="material-symbols-outlined text-secondary text-[20px]">admin_panel_settings</span>
                <span className="text-sm font-medium text-on-secondary-container">{user.role} Access</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="relative glass-panel rounded-none border-x-0 border-t-0">
        <div className="container-max">
          <nav className="flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-secondary text-secondary'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface hover:border-outline-variant'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="container-max py-8">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'contractors' && <ContractorsTab />}
          {activeTab === 'regions' && <RegionsTab />}
          {activeTab === 'roads' && <RoadsTab />}
        </motion.div>
      </div>
    </div>
  );
}

function UsersTab() {
  const { users, loading, error, createUser } = useAdminUsers();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUser, setNewUser] = useState({
    email: '',
    phone: '',
    username: '',
    role: 'CITIZEN' as const,
    districts: [] as string[],
    zones: [] as string[]
  });

  const handleCreateUser = async () => {
    const success = await createUser(newUser);
    if (success) {
      setShowCreateModal(false);
      setNewUser({
        email: '',
        phone: '',
        username: '',
        role: 'CITIZEN',
        districts: [],
        zones: []
      });
    }
  };

  return (
      <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-on-surface">User Management</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-secondary text-white rounded-lg hover:bg-primary transition-colors flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          Create User
        </button>
      </div>

      {error && (
        <div className="bg-error-container border border-error/20 rounded-lg p-4 text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-secondary mx-auto"></div>
          <p className="text-on-surface-variant mt-2">Loading users...</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="min-w-full divide-y divide-outline-variant">
            <thead className="bg-surface-container-low">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase tracking-wider">Districts</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="bg-surface-container-lowest divide-y divide-outline-variant">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-surface-container-low">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-on-surface">{user.username || user.email}</div>
                      <div className="text-sm text-on-surface-variant">{user.phone}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      user.role === 'CE' ? 'bg-secondary-container text-on-secondary-container' :
                      user.role === 'EE' ? 'bg-secondary-container text-on-secondary-container' :
                      user.role === 'CONTRACTOR' ? 'bg-tertiary-container text-on-tertiary-container' :
                      'bg-surface-container-low text-on-surface'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-on-surface-variant">
                    {user.districts?.join(', ') || 'None'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      user.fabricVerified ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-secondary-container text-on-secondary-container'
                    }`}>
                      {user.fabricVerified ? 'Verified' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-on-surface-variant">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel rounded-2xl p-6 w-full max-w-md mx-4"
          >
            <h3 className="text-lg font-semibold text-on-surface mb-4">Create New User</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Email</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Phone</label>
                <input
                  type="tel"
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Username</label>
                <input
                  type="text"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as any })}
                  className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                >
                  <option value="CITIZEN">Citizen</option>
                  <option value="CE">Chief Engineer</option>
                  <option value="EE">Executive Engineer</option>
                  <option value="CONTRACTOR">Contractor</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleCreateUser}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Create User
                </button>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function ContractorsTab() {
  const { contractors, loading, error, createContractor } = useAdminContractors();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newContractor, setNewContractor] = useState({
    name: '',
    contactInfo: '',
    metadata: {}
  });

  const handleCreateContractor = async () => {
    const success = await createContractor(newContractor);
    if (success) {
      setShowCreateModal(false);
      setNewContractor({ name: '', contactInfo: '', metadata: {} });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-col lg:flex-row lg:items-center">
        <div>
          <h2 className="text-2xl font-bold text-on-surface">Contractor Management</h2>
          <p className="text-on-surface-variant mt-1">Register delivery partners and keep their contact profile in one place.</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-secondary text-white rounded-lg hover:bg-primary transition-colors flex items-center gap-2 shadow-sm"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          Add Contractor
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <InfoCard icon="engineering" title="Partner records" description="Track contact details, work history, and onboarding status." />
        <InfoCard icon="handshake" title="Assignment ready" description="Use contractor records when assigning roads and escalation tasks." />
        <InfoCard icon="shield" title="Identity-first" description="Keep every contractor tied to a verified contact profile." />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
          <div>
            <h3 className="text-lg font-semibold text-on-surface">Registered contractors</h3>
            <p className="text-sm text-on-surface-variant">Current roster from the admin service.</p>
          </div>
          <span className="text-sm font-medium text-on-surface-variant">{loading ? 'Refreshing...' : `${contractors.length} records`}</span>
        </div>
        {contractors.length === 0 ? (
          <div className="p-8 text-center">
            <span className="material-symbols-outlined text-on-surface-variant text-[64px] mb-4">engineering</span>
            <h3 className="text-lg font-medium text-on-surface mb-2">No Contractors Yet</h3>
            <p className="text-on-surface-variant mb-4">Start by adding your first contractor to the system.</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-secondary text-white rounded-lg hover:bg-primary transition-colors"
            >
              Add First Contractor
            </button>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {contractors.map((contractor) => (
              <div key={contractor.id} className="p-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-medium text-on-surface">{contractor.name}</div>
                  <div className="text-sm text-on-surface-variant">{contractor.contactInfo}</div>
                </div>
                <div className="text-sm text-on-surface-variant">Created {new Date(contractor.createdAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Contractor Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel rounded-2xl p-6 w-full max-w-md mx-4"
          >
            <h3 className="text-lg font-semibold text-on-surface mb-4">Add New Contractor</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Company Name</label>
                <input
                  type="text"
                  value={newContractor.name}
                  onChange={(e) => setNewContractor({ ...newContractor, name: e.target.value })}
                  className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1">Contact Information</label>
                <textarea
                  value={newContractor.contactInfo}
                  onChange={(e) => setNewContractor({ ...newContractor, contactInfo: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                  placeholder="Phone, email, address..."
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleCreateContractor}
                  className="flex-1 px-4 py-2 bg-secondary text-white rounded-lg hover:bg-primary transition-colors"
                >
                  Add Contractor
                </button>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-outline-variant text-on-surface-variant rounded-lg hover:bg-surface-container-low transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function RegionsTab() {
  const { createCountry, createState, createDistrict, error } = useAdminRegions();
  const [activeRegionTab, setActiveRegionTab] = useState<'countries' | 'states' | 'districts'>('countries');
  const [countryName, setCountryName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [stateName, setStateName] = useState('');
  const [stateCountryId, setStateCountryId] = useState('');
  const [districtName, setDistrictName] = useState('');
  const [districtStateId, setDistrictStateId] = useState('');
  const [countrySaving, setCountrySaving] = useState(false);
  const [stateSaving, setStateSaving] = useState(false);
  const [districtSaving, setDistrictSaving] = useState(false);

  const handleCreateCountry = async () => {
    if (!countryName.trim()) return;
    setCountrySaving(true);
    const success = await createCountry({
      name: countryName.trim(),
      metadata: countryCode.trim() ? { code: countryCode.trim().toUpperCase() } : undefined
    });
    setCountrySaving(false);
    if (success) {
      setCountryName('');
      setCountryCode('');
    }
  };

  const handleCreateState = async () => {
    if (!stateName.trim() || !stateCountryId.trim()) return;
    setStateSaving(true);
    const success = await createState({
      name: stateName.trim(),
      countryId: stateCountryId.trim(),
      metadata: { source: 'admin-dashboard' }
    });
    setStateSaving(false);
    if (success) {
      setStateName('');
      setStateCountryId('');
    }
  };

  const handleCreateDistrict = async () => {
    if (!districtName.trim() || !districtStateId.trim()) return;
    setDistrictSaving(true);
    const success = await createDistrict({
      name: districtName.trim(),
      stateId: districtStateId.trim(),
      metadata: { source: 'admin-dashboard' }
    });
    setDistrictSaving(false);
    if (success) {
      setDistrictName('');
      setDistrictStateId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-col lg:flex-row lg:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Region Management</h2>
          <p className="text-gray-600 mt-1">Create the hierarchy that drives jurisdiction, reporting, and road allocation.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="material-symbols-outlined text-[18px]">database</span>
          Admin writes directly to region endpoints
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <InfoCard icon="public" title="Countries" description="Top-level jurisdiction containers for a national rollout." />
        <InfoCard icon="map" title="States" description="State records link a country to operational and reporting structure." />
        <InfoCard icon="location_city" title="Districts" description="Districts become the operational layer for roads and assignments." />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {/* Region Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {[
            { id: 'countries' as const, label: 'Countries' },
            { id: 'states' as const, label: 'States' },
            { id: 'districts' as const, label: 'Districts' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveRegionTab(tab.id)}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeRegionTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="glass-panel rounded-2xl p-6 space-y-5">
          {activeRegionTab === 'countries' && (
            <>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Create a country</h3>
                <p className="text-sm text-gray-500">Add the top-level region that all state records will reference.</p>
              </div>
              <div className="space-y-4">
                <Field label="Country name" value={countryName} onChange={setCountryName} placeholder="India" />
                <Field label="Country code" value={countryCode} onChange={setCountryCode} placeholder="IN" />
                <button
                  onClick={handleCreateCountry}
                  disabled={countrySaving || !countryName.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-white rounded-lg hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">add_location_alt</span>
                  {countrySaving ? 'Saving...' : 'Create country'}
                </button>
              </div>
            </>
          )}

          {activeRegionTab === 'states' && (
            <>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Create a state</h3>
                <p className="text-sm text-gray-500">Link the state to its parent country before adding districts.</p>
              </div>
              <div className="space-y-4">
                <Field label="State name" value={stateName} onChange={setStateName} placeholder="Maharashtra" />
                <Field label="Country ID" value={stateCountryId} onChange={setStateCountryId} placeholder="country_123" />
                <button
                  onClick={handleCreateState}
                  disabled={stateSaving || !stateName.trim() || !stateCountryId.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-white rounded-lg hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">add_location_alt</span>
                  {stateSaving ? 'Saving...' : 'Create state'}
                </button>
              </div>
            </>
          )}

          {activeRegionTab === 'districts' && (
            <>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Create a district</h3>
                <p className="text-sm text-gray-500">Districts are the operational unit used for road assignments and authority views.</p>
              </div>
              <div className="space-y-4">
                <Field label="District name" value={districtName} onChange={setDistrictName} placeholder="Pune Urban" />
                <Field label="State ID" value={districtStateId} onChange={setDistrictStateId} placeholder="state_123" />
                <button
                  onClick={handleCreateDistrict}
                  disabled={districtSaving || !districtName.trim() || !districtStateId.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">add_location_alt</span>
                  {districtSaving ? 'Saving...' : 'Create district'}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="glass-panel border border-outline-variant text-on-surface rounded-2xl p-6 shadow-lg">
          <div className="flex items-center gap-2 text-secondary mb-3">
            <span className="material-symbols-outlined text-[18px]">insights</span>
            Admin flow
          </div>
          <h3 className="text-xl font-semibold mb-2">Build the hierarchy first</h3>
          <p className="text-sm text-on-surface-variant mb-5">
            Countries sit at the top, states inherit reporting scope, and districts unlock road management and contractor assignment.
          </p>
          <div className="space-y-3 text-sm">
            <StepItem title="1. Create country" description="Use the Countries tab to define the jurisdiction container." />
            <StepItem title="2. Add states" description="Attach each state to a country so rollups stay consistent." />
            <StepItem title="3. Add districts" description="Districts power road allocation and operational reporting." />
          </div>
        </div>
      </div>
    </div>
  );
}

function RoadsTab() {
  const { bulkUpsertRoads, createRoadAssignment, error } = useAdminRoads();
  const [bulkDistrictId, setBulkDistrictId] = useState('');
  const [roadsJson, setRoadsJson] = useState('[\n  {"name": "NH-44", "roadType": "highway"},\n  {"name": "Ring Road", "roadType": "arterial"}\n]');
  const [roadId, setRoadId] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [roadSaving, setRoadSaving] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);

  const handleBulkUpsert = async () => {
    if (!bulkDistrictId.trim()) return;

    let parsedRoads: unknown;
    try {
      parsedRoads = JSON.parse(roadsJson);
      if (!Array.isArray(parsedRoads)) {
        throw new Error('Road payload must be an array');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Invalid road JSON');
      return;
    }

    setRoadSaving(true);
    await bulkUpsertRoads(bulkDistrictId.trim(), parsedRoads as any[]);
    setRoadSaving(false);
  };

  const handleAssignRoad = async () => {
    if (!roadId.trim() || !contractorId.trim()) return;
    setAssignmentSaving(true);
    await createRoadAssignment(roadId.trim(), { contractorId: contractorId.trim(), metadata: { source: 'admin-dashboard' } });
    setAssignmentSaving(false);
    setRoadId('');
    setContractorId('');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-col lg:flex-row lg:items-center">
        <div>
          <h2 className="text-2xl font-bold text-on-surface">Road Management</h2>
          <p className="text-on-surface-variant mt-1">Bulk load roads into a district and assign active work to contractors.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-on-surface-variant">
          <span className="material-symbols-outlined text-[18px]">route</span>
          Supports bulk upsert and assignment
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <InfoCard icon="route" title="Road inventory" description="Keep a district-level register of roads and road types." />
        <InfoCard icon="assignment_ind" title="Contractor allocation" description="Assign a road to a contractor with metadata for tracking." />
        <InfoCard icon="map" title="District scope" description="Every road operation stays tied to a district ID." />
      </div>

      {error && (
        <div className="bg-error-container/20 border border-error/20 rounded-lg p-4 text-error">
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="glass-panel border border-outline-variant rounded-2xl p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-on-surface">Bulk upsert roads</h3>
            <p className="text-sm text-on-surface-variant">Paste an array of road objects and push them into a district in one shot.</p>
          </div>
          <Field label="District ID" value={bulkDistrictId} onChange={setBulkDistrictId} placeholder="district_123" />
          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1">Road payload</label>
              <textarea
              value={roadsJson}
              onChange={(e) => setRoadsJson(e.target.value)}
              rows={10}
              className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary font-mono text-on-surface"
            />
          </div>
          <button
            onClick={handleBulkUpsert}
            disabled={roadSaving || !bulkDistrictId.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-white rounded-lg hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">upload</span>
            {roadSaving ? 'Saving...' : 'Upsert roads'}
          </button>
        </div>

        <div className="space-y-6">
          <div className="glass-panel border border-outline-variant rounded-2xl p-6 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-on-surface">Assign a road</h3>
              <p className="text-sm text-on-surface-variant">Connect an existing road to a contractor for execution and follow-up.</p>
            </div>
            <Field label="Road ID" value={roadId} onChange={setRoadId} placeholder="road_123" />
            <Field label="Contractor ID" value={contractorId} onChange={setContractorId} placeholder="contractor_123" />
            <button
              onClick={handleAssignRoad}
              disabled={assignmentSaving || !roadId.trim() || !contractorId.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-white rounded-lg hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
              {assignmentSaving ? 'Saving...' : 'Create assignment'}
            </button>
          </div>

          <div className="glass-panel border border-outline-variant rounded-2xl p-6 shadow-lg">
            <div className="flex items-center gap-2 text-secondary mb-3">
              <span className="material-symbols-outlined text-[18px]">info</span>
              Example payload
            </div>
            <pre className="text-xs text-on-surface-variant overflow-auto leading-6 whitespace-pre-wrap">{`[
  { "name": "NH-44", "roadType": "highway" },
  { "name": "Ring Road", "roadType": "arterial" }
]`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="glass-panel rounded-2xl border border-outline-variant p-4 flex gap-3">
      <div className="h-11 w-11 rounded-xl bg-secondary-container text-secondary flex items-center justify-center flex-shrink-0">
        <span className="material-symbols-outlined text-[22px]">{icon}</span>
      </div>
      <div>
        <div className="font-semibold text-on-surface">{title}</div>
        <p className="text-sm text-on-surface-variant mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
        <div>
      <label className="block text-sm font-medium text-on-surface-variant mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 focus:outline-none focus:ring-2 focus:ring-secondary text-on-surface"
      />
    </div>
  );
}

function StepItem({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 h-8 w-8 rounded-full bg-secondary-container flex items-center justify-center text-secondary font-semibold text-xs">
        •
      </div>
      <div>
        <div className="font-medium text-on-surface">{title}</div>
        <p className="text-on-surface-variant text-sm mt-0.5">{description}</p>
      </div>
    </div>
  );
}