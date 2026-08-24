import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ResumableUpload, { type MediaCaptureResult } from '../components/ResumableUpload'
import { useAuth } from '../contexts/AuthContext'
import { captureGeoPosition, formatCoords } from '../lib/geoCapture'
import { enqueueAction, saveRecord } from '../lib/offlineStore'
import { resolveRoadContext } from '../lib/roadContext'

const damageTypes = [
  { id: 'Potholes & Roads', label: 'Pothole Cluster / Surface Damage', desc: 'Severe deep cracks, asphalt disintegration, or tire hazards.' },
  { id: 'Street Lighting', label: 'Street Light Outage', desc: 'Invisible dark spots, non-functional street lamp posts, or faded blinkers.' },
  { id: 'Water & Sewage', label: 'Drainage & Flooding', desc: 'Standing water pools, clogged storm drains, or marshy shoulders.' },
  { id: 'Waste Management', label: 'Waste Management / Debris', desc: 'Illegal dumping piles, road debris obstructions, or uncollected garbage.' },
  { id: 'Signage', label: 'Missing / Faded Signage', desc: 'Invisible lane lines, broken cat-eyes, or missing warning signs.' }
]

export default function ComplaintWizard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isAuthenticated, loading } = useAuth()
  const roadContext = resolveRoadContext({ roadId: id || 'r1' })
  
  const [step, setStep] = useState(1)
  const [complaintId] = useState(() => `GRI-${Math.floor(10000 + Math.random() * 90000)}`)
  const [title, setTitle] = useState('')
  const [damageType, setDamageType] = useState('Potholes & Roads')
  const [severity, setSeverity] = useState(3)
  const [description, setDescription] = useState('')
  const [mediaAsset, setMediaAsset] = useState<MediaCaptureResult | null>(null)
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(true)
  const [status, setStatus] = useState<'draft' | 'submitting' | 'submitted' | 'queued'>('draft')

  useEffect(() => {
    let mounted = true
    captureGeoPosition().then((capture) => {
      if (!mounted) return
      setLocation({ lat: capture.lat, lng: capture.lng })
      setLocating(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  // Auth loading state
  if (loading) {
    return (
      <div className="page-radial-bg min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1960a3]" />
      </div>
    )
  }

  // Not authenticated state
  if (!isAuthenticated) {
    const next = encodeURIComponent(`/road/${id}/report`)
    return (
      <div className="page-radial-bg min-h-screen text-on-surface flex items-center justify-center p-6 relative overflow-hidden font-sans">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full rounded-[16px] border border-outline-variant bg-surface-container-lowest p-8 shadow-xl text-center flex flex-col items-center gap-6"
        >
            <div className="w-16 h-16 rounded-full bg-error-container/10 border border-error/20 flex items-center justify-center text-error">
            <span className="material-symbols-outlined text-[32px]">lock</span>
          </div>
          <div>
            <h1 className="text-[24px] font-bold text-primary mb-2">Authentication Required</h1>
            <p className="text-on-surface-variant text-[14px] leading-[20px]">
              You must be signed in as a registered citizen to file grievances. Register your feedback to track updates dynamically.
            </p>
          </div>
          <div className="w-full flex flex-col gap-3">
            <Link to={`/auth/citizen/login?next=${next}`} className="w-full">
              <button className="w-full py-3 rounded-[10px] bg-primary hover:bg-secondary font-bold text-white shadow-sm transition-all active:scale-95 text-[14px]">
                Sign In Now
              </button>
            </Link>
            <Link to={`/road/${id}`} className="w-full">
              <button className="w-full py-3 rounded-[10px] border border-outline-variant hover:bg-surface-container-low font-semibold text-on-surface-variant transition-colors text-[14px]">
                Back to Road Profile
              </button>
            </Link>
          </div>
        </motion.div>
      </div>
    )
  }

  async function submit() {
    setStatus('submitting')
    const pin = location ?? { lat: 28.6139, lng: 77.209 }
    const capturedLat = mediaAsset?.capturedLat ?? pin.lat
    const capturedLng = mediaAsset?.capturedLng ?? pin.lng
    const capturedAt = mediaAsset?.capturedAt ?? new Date().toISOString()
    const offlineQueued = Boolean(mediaAsset?.offline || mediaAsset?.localMediaId)

    const payload = {
      id: complaintId,
      roadId: id || 'r1',
      roadName: roadContext.roadName,
      roadType: roadContext.roadType,
      title: title || `${damageType} issue on Segment ${id || 'r1'}`,
      damageType,
      severity,
      description,
      status: 'Under Review',
      createdAt: new Date().toISOString(),
      slaDeadline: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
      routedTo: roadContext.officerLabel,
      assignedAuthority: roadContext.officerLabel,
      assignedContractor: roadContext.contractorProfileName,
      location: pin,
      capturedLat,
      capturedLng,
      capturedAt,
      offlineQueued,
      localMediaId: mediaAsset?.localMediaId,
      media: mediaAsset,
      slaRemaining: severity >= 4 ? '24h remaining' : severity === 3 ? '48h remaining' : '14-day SLA',
      financeSnapshot: roadContext.finance,
    }

    const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100'
    const token = localStorage.getItem('roadwatch_token')

    if (navigator.onLine && token && !offlineQueued) {
      try {
        const res = await fetch(`${apiBase}/citizen/complaints`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            roadId: payload.roadId,
            description: payload.description,
            lat: pin.lat,
            lng: pin.lng,
            capturedLat,
            capturedLng,
            capturedAt,
            imageCid: mediaAsset?.ipfs,
            imageSha256: mediaAsset?.sha,
            uploadId: mediaAsset?.uploadId,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          await saveRecord('complaints', complaintId, { ...payload, server: { ok: true, resp: data } })
          setStatus('submitted')
          return
        }
      } catch (err) {
        console.warn('Immediate complaint submit failed, queuing for later sync', err)
      }
    }

    await saveRecord('complaints', complaintId, payload)
    await enqueueAction('submit-complaint', payload)
    setStatus('queued')
  }

  async function onMediaComplete(result: MediaCaptureResult) {
    setMediaAsset(result)
    if (result.capturedLat != null && result.capturedLng != null) {
      setLocation({ lat: result.capturedLat, lng: result.capturedLng })
    }
    await saveRecord('complaint_uploads', complaintId, {
      complaintId,
      roadId: id || 'r1',
      roadName: roadContext.roadName,
      ...result,
      completedAt: new Date().toISOString(),
    })
  }

  // Submitted / queued success state
  if (status === 'submitted' || status === 'queued') {
    return (
      <div className="page-radial-bg min-h-screen text-on-surface flex items-center justify-center p-6 font-sans">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full rounded-[16px] border border-outline-variant bg-surface-container-lowest p-8 shadow-xl text-center flex flex-col items-center gap-6"
        >
          <div className="w-16 h-16 rounded-full bg-[#005231]/10 border border-[#005231]/20 flex items-center justify-center text-[#005231]">
            <span className="material-symbols-outlined text-[32px] animate-bounce">verified_user</span>
          </div>
          <div>
            <span className="px-3 py-1 rounded-[8px] bg-tertiary-fixed text-on-tertiary-fixed text-[12px] font-semibold uppercase tracking-wider mb-3 inline-block">
              {status === 'queued' ? 'Saved Offline First' : 'Submitted'}
            </span>
            <h1 className="text-[24px] font-bold text-primary tracking-tight mb-2">Grievance Logged</h1>
            <p className="text-on-surface-variant text-[14px] leading-[20px]">
              {status === 'queued'
                ? 'Your report and geotagged photo are stored on this device. They will sync automatically when you have network connectivity.'
                : 'Your structural grievance has been submitted to local authorities.'}
            </p>
          </div>
          <div className="w-full flex flex-col gap-3">
            <Link to={`/complaints/${complaintId}`} className="w-full">
              <button className="w-full py-3 rounded-[10px] bg-primary hover:bg-secondary font-bold text-white shadow-sm transition-all active:scale-95 text-[14px]">
                Open Live Timeline
              </button>
            </Link>
            <Link to="/complaints" className="w-full">
              <button className="w-full py-3 rounded-[10px] border border-outline-variant hover:bg-surface-container-low font-semibold text-on-surface-variant transition-colors text-[14px]">
                Back to All Complaints
              </button>
            </Link>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="page-radial-bg min-h-screen text-on-surface font-sans pb-20 pt-10">
      <main className="max-w-[1280px] mx-auto w-full px-4 md:px-16">
        
        {/* Header Section */}
        <div className="mb-10">
          <h1 className="text-[30px] font-bold text-primary leading-[38px] mb-2">Submit a New Grievance</h1>
          <p className="text-[16px] leading-[24px] text-on-surface-variant max-w-2xl">
            Your report facilitates institutional accountability. Provide accurate details to ensure rapid response and transparency.
          </p>
        </div>

        <section className="glass-panel rounded-xl p-6 mb-10">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div className="max-w-2xl">
              <h2 className="text-[20px] font-bold text-primary mb-2">1. Add a photo first</h2>
              <p className="text-[14px] text-on-surface-variant leading-[20px]">
                Select your evidence photo now. The upload continues in the background while you move through the rest of the complaint details.
              </p>
            </div>
            <div className="w-full lg:max-w-md">
              <ResumableUpload onComplete={onMediaComplete} metadata={{ type: 'citizen_complaint', roadId: id || 'r1' }} />
            </div>
          </div>
          {mediaAsset && (
            <div className="mt-5 flex items-center justify-between p-3 bg-surface-container-low border border-outline-variant border-l-4 border-l-secondary rounded-[10px]">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded bg-secondary-container overflow-hidden border border-outline-variant flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-secondary">image</span>
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-bold text-on-surface truncate max-w-[240px]">
                    {mediaAsset.filename}
                  </p>
                  <p className="text-[12px] text-on-surface-variant">Upload complete. Details can continue below.</p>
                </div>
              </div>
              <button
                onClick={() => setMediaAsset(null)}
                className="text-[#43474e] hover:text-[#ba1a1a] transition-colors p-1"
              >
                <span className="material-symbols-outlined text-[20px]">delete</span>
              </button>
            </div>
          )}
        </section>

        {/* Stepper Component */}
        <div className="glass-panel border-outline-variant rounded-xl p-6 mb-10 shadow-sm overflow-x-auto">
          <div className="flex items-center justify-between min-w-[600px] px-8">
            {/* Step 1 Category */}
            <div className="flex flex-col items-center gap-2 cursor-pointer" onClick={() => setStep(1)}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
                step > 1 
                  ? 'bg-amber-100 text-amber-900' 
                  : step === 1 
                    ? 'bg-secondary text-white shadow' 
                    : 'bg-surface-container-low text-on-surface-variant'
              }`}>
                {step > 1 ? <span className="material-symbols-outlined text-[20px]">check</span> : '1'}
              </div>
              <span className={`text-[14px] font-medium ${step === 1 ? 'text-[#002045] font-bold' : 'text-[#43474e]'}`}>Category</span>
            </div>

            <div className="h-0.5 flex-grow bg-[#c4c6cf] mx-4" />

            {/* Step 2 Details & Location */}
            <div className="flex flex-col items-center gap-2 cursor-pointer" onClick={() => { if (step >= 1) setStep(2) }}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
                step > 2 
                  ? 'bg-amber-100 text-amber-900' 
                  : step === 2 
                    ? 'bg-secondary text-white shadow' 
                    : 'bg-surface-container-low text-on-surface-variant'
              }`}>
                {step > 2 ? <span className="material-symbols-outlined text-[20px]">check</span> : '2'}
              </div>
              <span className={`text-[14px] font-medium ${step === 2 ? 'text-[#002045] font-bold' : 'text-[#43474e]'}`}>Location & Details</span>
            </div>

            <div className="h-0.5 flex-grow bg-[#c4c6cf] mx-4" />

            {/* Step 3 Impact & Submit */}
            <div className="flex flex-col items-center gap-2 cursor-pointer" onClick={() => { if (step >= 2) setStep(3) }}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
                step === 3 
                  ? 'bg-secondary text-white shadow' 
                  : 'bg-surface-container-low text-on-surface-variant'
              }`}>
                3
              </div>
              <span className={`text-[14px] font-medium ${step === 3 ? 'text-[#002045] font-bold' : 'text-[#43474e]'}`}>Impact & Submit</span>
            </div>
          </div>
        </div>

        {/* Wizard Forms with Dynamic Step Transitions */}
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="glass-panel border-outline-variant rounded-xl p-8 shadow-sm"
            >
              <h2 className="text-[20px] font-bold text-[#002045] mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-[#1960a3]">category</span>
                Pick Damage Category
              </h2>
              <p className="text-[#43474e] text-[14px] leading-[20px] mb-8">
                Selecting the correct category speeds up matching algorithms to route complaints to the appropriate expert contractor teams.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {damageTypes.map((t) => {
                  const isSelected = damageType === t.id
                  return (
                    <div
                      key={t.id}
                      onClick={() => setDamageType(t.id)}
                      className={`p-6 rounded-xl border-2 cursor-pointer flex flex-col gap-2 transition-all ${
                        isSelected
                          ? 'bg-surface-container-low border-secondary shadow-sm'
                          : 'glass-panel hover:border-secondary'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-[#002045] text-[16px]">{t.label}</span>
                        {isSelected && (
                          <span className="material-symbols-outlined text-[#1960a3] text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                            check_circle
                          </span>
                        )}
                      </div>
                      <span className="text-[#43474e] text-[13px] leading-[18px]">{t.desc}</span>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              {/* Left Form Panel */}
              <div className="lg:col-span-8 space-y-8">
                
                {/* Location Picker Visual */}
                <section className="glass-panel border-outline-variant rounded-xl overflow-hidden shadow-sm">
                  <div className="p-6 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
                    <div>
                      <h2 className="text-[20px] font-bold text-[#002045]">Pin Location</h2>
                      <p className="text-[14px] text-[#43474e]">Mark the exact site of the infrastructure failure on the map.</p>
                    </div>
                    <div className="flex gap-2">
                      <button className="p-2 border border-[#c4c6cf] bg-white rounded-lg hover:bg-[#eff4ff] transition-colors text-[#002045] flex items-center">
                        <span className="material-symbols-outlined text-[20px]">my_location</span>
                      </button>
                      <button className="p-2 border border-[#c4c6cf] bg-white rounded-lg hover:bg-[#eff4ff] transition-colors text-[#002045] flex items-center">
                        <span className="material-symbols-outlined text-[20px]">search</span>
                      </button>
                    </div>
                  </div>
                  <div className="aspect-video w-full bg-[#e5eeff] relative">
                    <img
                      alt="Location Map Picker"
                      className="w-full h-full object-cover"
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuCP45D52mPUblQrBYPOdH0ZSFi7yODF38YruEfF2mNxboUwJ0LEuqhv9l0dgjaZwZMww08a6YKvNGL428--IpGkbpsdbpIdIjH6tnsbdOwNwUzGxpzXQoMjEuC1aRYtBkEy0jQRQyImpQsJIP1kbv0Z4xVmmdCaC2KeX6o4ZTxnIRNV3KWd1bMHbJeiOvb3WobMSm18c0PtHCyLVkNiUBksLTiMNnXGSM4KvvqU5BXIFDmts-LlenXma_KYO0f0zMJ-8-zPNk652qo"
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-12 h-12 bg-[#1960a3]/10 rounded-full border-2 border-[#1960a3] flex items-center justify-center">
                        <span className="material-symbols-outlined text-[#1960a3] text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                          location_on
                        </span>
                      </div>
                    </div>
                    <div className="absolute bottom-4 right-4 bg-white/90 border border-[#c4c6cf] px-3 py-1 rounded text-[13px] font-medium text-[#0b1c30]">
                      {locating
                        ? 'Locating…'
                        : `${formatCoords(location?.lat ?? 0, location?.lng ?? 0)} (Road Segment: ${id || 'r1'})`}
                    </div>
                  </div>
                </section>

                {/* Details Form Card */}
                <section className="glass-panel border-outline-variant rounded-xl p-6 shadow-sm">
                  <h2 className="text-[20px] font-bold text-[#002045] mb-6">Issue Details</h2>
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[14px] text-[#0b1c30] font-semibold">Issue Title</label>
                        <input
                          type="text"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          className="w-full bg-[#eff4ff] border border-[#c4c6cf] rounded-lg px-4 py-2.5 text-[#0b1c30] focus:ring-2 focus:ring-[#1960a3]/20 focus:border-[#1960a3] transition-all outline-none"
                          placeholder="e.g., Severe Pothole near Main St."
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[14px] text-[#0b1c30] font-semibold">Road Category</label>
                        <select
                          value={damageType}
                          onChange={(e) => setDamageType(e.target.value)}
                          className="w-full bg-[#eff4ff] border border-[#c4c6cf] rounded-lg px-4 py-2.5 text-[#0b1c30] focus:ring-2 focus:ring-[#1960a3]/20 focus:border-[#1960a3] transition-all outline-none cursor-pointer"
                        >
                          {damageTypes.map((t) => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[14px] text-[#0b1c30] font-semibold">Detailed Description</label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full bg-[#eff4ff] border border-[#c4c6cf] rounded-lg px-4 py-2.5 text-[#0b1c30] focus:ring-2 focus:ring-[#1960a3]/20 focus:border-[#1960a3] transition-all outline-none resize-none"
                        placeholder="Describe the severity, depth, pedestrian hazard, and precise nature of the issue..."
                        rows={4}
                      />
                    </div>
                  </div>
                </section>
              </div>

              {/* Right Sidebar Evidence Summary */}
              <div className="lg:col-span-4 space-y-8">
                <section className="glass-panel border-outline-variant rounded-xl p-6 shadow-sm sticky top-24">
                  <h2 className="text-[20px] font-bold text-[#002045] mb-2">Evidence Timeline</h2>
                  <p className="text-[14px] text-[#43474e] mb-6">Your upload is tracked separately from the form, so it can continue in the background while you type.</p>

                  <div className="space-y-3">
                    <div className="p-4 rounded-xl bg-[#eff4ff] border border-[#d3e4fe]">
                      <div className="text-[11px] uppercase tracking-widest text-[#74777f] font-bold">Current upload state</div>
                      <div className="mt-2 text-[14px] font-semibold text-[#002045]">
                        {mediaAsset
                          ? mediaAsset.offline
                            ? 'Photo cached on device (geotagged)'
                            : 'Photo captured and queued for submission'
                          : 'Waiting for the first photo'}
                      </div>
                      {mediaAsset?.capturedAt && (
                        <div className="mt-1 text-[12px] text-[#43474e]">
                          {formatCoords(mediaAsset.capturedLat, mediaAsset.capturedLng)} ·{' '}
                          {new Date(mediaAsset.capturedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                    {mediaAsset && (
                      <div className="flex items-center justify-between p-3 bg-[#eff4ff] border border-[#c4c6cf] border-l-4 border-l-[#1960a3] rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded bg-[#d3e4fe] overflow-hidden border border-[#c4c6cf] flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-[#1960a3]">image</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[14px] font-bold text-[#0b1c30] truncate max-w-[140px]">
                              {mediaAsset.filename}
                            </p>
                            <p className="text-[12px] text-[#43474e]">Hashed & Signed</p>
                          </div>
                        </div>
                        <button
                          onClick={() => setMediaAsset(null)}
                          className="text-[#43474e] hover:text-[#ba1a1a] transition-colors p-1"
                        >
                          <span className="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                      </div>
                    )}
                    <div className="mt-2 p-4 bg-[#eff4ff] border border-[#d3e4fe] rounded-lg flex items-start gap-3">
                      <span className="material-symbols-outlined text-[#1960a3] text-[20px]">verified_user</span>
                      <p className="text-[13px] text-[#002045] font-medium leading-relaxed">
                        All uploads are cryptographically hashed to ensure evidentiary integrity, preventing any tampering during review pipelines.
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="glass-panel border-outline-variant rounded-xl p-8 shadow-sm max-w-2xl mx-auto"
            >
              <h2 className="text-[20px] font-bold text-[#002045] mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-[#ba1a1a]">warning</span>
                Set Severity & Impact
              </h2>
              <p className="text-[#43474e] text-[14px] leading-[20px] mb-8">
                Evaluate risk severity levels. Higher severity levels push the grievance up the authority SLA priority queue for emergency routing.
              </p>

              {/* Slider selector */}
              <div className="flex flex-col gap-6 py-4 items-center">
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={severity}
                  onChange={(e) => setSeverity(Number(e.target.value))}
                  className="w-full h-2 bg-[#eff4ff] rounded-lg appearance-none cursor-pointer accent-[#1960a3]"
                />
                <div className="w-full flex justify-between items-center text-[12px] font-bold text-[#74777f] uppercase tracking-wider">
                  <span>Low Threat</span>
                  <span className="px-5 py-2.5 rounded-xl bg-[#eff4ff] border border-[#d3e4fe] text-[#1960a3] text-[20px] font-black">
                    {severity} / 5
                  </span>
                  <span>Critical Risk</span>
                </div>
              </div>

              {/* Dynamic Severity Info Badge */}
              <div className="p-4 bg-[#eff4ff] border border-[#d3e4fe] rounded-xl flex gap-3.5 items-start mt-6 mb-8 text-[14px] leading-[20px]">
                <span className="material-symbols-outlined text-[#1960a3] mt-0.5">info</span>
                <p className="text-[#43474e]">
                  {severity <= 2
                    ? 'Minor defect with low safety threat. Usually handled within the 14-day SLA queue.'
                    : severity === 3
                    ? 'Moderate defect. Noticeable vibration or damage chance for fast-moving vehicles. SLA target: 7 days.'
                    : 'Severe structural failure. Very high potential for vehicle damage or cyclist crashes. Pushed to emergency 24-hour repair cycles.'}
                </p>
              </div>

              {/* Confirmation Grid Summary */}
              <div className="border border-[#c4c6cf] rounded-xl overflow-hidden p-6 bg-[#eff4ff]/30 text-[14px] space-y-4">
                <h3 className="font-bold text-[#002045] text-[16px] mb-2 border-b border-[#c4c6cf] pb-2">Final Summary</h3>
                <div className="flex justify-between items-center">
                  <span className="text-[#74777f]">Road ID / Segment</span>
                  <span className="font-semibold text-[#002045]">{id || 'r1'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#74777f]">Issue Title</span>
                  <span className="font-semibold text-[#002045]">{title || 'Untitled Grievance'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#74777f]">Category</span>
                  <span className="font-semibold text-[#002045]">{damageType}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#74777f]">Severity Index</span>
                  <span className="font-bold text-[#1960a3]">{severity} / 5</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#74777f]">Hashed Evidence</span>
                  <span className="font-mono text-[12px] text-[#1960a3]">
                    {mediaAsset?.ipfs ? `ipfs://${mediaAsset.ipfs.substring(0, 16)}...` : 'No file attached'}
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer Action Bar */}
        <div className="mt-16 pt-8 border-t border-[#c4c6cf] flex justify-between items-center">
          <button
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            className="px-6 py-3 text-[#43474e] font-semibold hover:text-[#002045] transition-colors flex items-center gap-2 disabled:opacity-30 text-[14px]"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Previous Step
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="bg-[#002045] text-white px-8 py-3 rounded-lg font-bold hover:bg-[#1960a3] transition-all active:scale-95 flex items-center gap-2 text-[14px] shadow-sm"
            >
              Next Step
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={status === 'submitting'}
              className="bg-[#005231] text-white px-10 py-4 rounded-xl font-bold hover:bg-[#003f25] transition-all active:scale-95 flex items-center gap-2 text-[16px] shadow-sm disabled:opacity-40"
            >
              {status === 'submitting' ? (
                <>Encrypting local payload...</>
              ) : (
                <>
                  Review and Submit
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </>
              )}
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
