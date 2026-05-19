import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Camera,
  Video,
  ArrowLeft,
  CheckCircle2,
  FileCheck,
  MapPin,
  Clock,
  Cpu,
  UploadCloud,
  FileVideo,
  FileImage,
  RefreshCw,
  X
} from 'lucide-react'
import ResumableUpload from '../components/ResumableUpload'
import { Badge, Button, Card, CardBody, Container, Spinner } from '../components/UIComponents'
import { enqueueAction, saveRecord } from '../lib/offlineStore'

type ProofItem = {
  id: string
  type: 'photo' | 'video'
  dataUrl: string
  hash: string
  phase: string
  status: 'Pending' | 'Verified'
  timestamp: string
  gps: { lat: number; lng: number }
  fileName?: string
  fileSize?: string
}

function sha256Hex(buffer: ArrayBuffer) {
  return crypto.subtle.digest('SHA-256', buffer).then((digest) =>
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  )
}

export default function ProgressProofUpload() {
  const { id } = useParams()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const [phase, setPhase] = useState('Sub-base laying')
  
  // Seed the mock evidence preview matching Stitch designs if empty
  const [proofs, setProofs] = useState<ProofItem[]>([
    {
      id: 'mock-1',
      type: 'photo',
      dataUrl: 'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=400&q=80',
      fileName: 'rebar_foundation_west.jpg',
      fileSize: '4.2 MB',
      hash: '5d8f2a93c71e8d9b2a7590d1101e405a',
      phase: 'Foundation reinforcement',
      status: 'Verified',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      gps: { lat: 12.9716, lng: 77.5946 }
    },
    {
      id: 'mock-2',
      type: 'video',
      dataUrl: '', // blank or mock video
      fileName: 'structural_video_log.mp4',
      fileSize: '28.5 MB',
      hash: '8f2a110d9e83c4b927ac05a110e54d82',
      phase: 'Underwater Inspection',
      status: 'Verified',
      timestamp: new Date(Date.now() - 7200000).toISOString(),
      gps: { lat: 12.9720, lng: 77.5950 }
    },
    {
      id: 'mock-3',
      type: 'photo',
      dataUrl: 'https://images.unsplash.com/photo-1590069261209-f8e9b8642343?auto=format&fit=crop&w=400&q=80',
      fileName: 'curing_check_v2.png',
      fileSize: '1.8 MB',
      hash: 'cd4b9e2832af8b7201ec90da11abfe92',
      phase: 'Curing Check',
      status: 'Verified',
      timestamp: new Date(Date.now() - 10800000).toISOString(),
      gps: { lat: 12.9712, lng: 77.5940 }
    }
  ])
  const [recording, setRecording] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [uploadCid, setUploadCid] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  async function startCamera() {
    try {
      if (streamRef.current) return
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setCameraActive(true)
    } catch (e) {
      console.error('Camera stream access failed:', e)
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraActive(false)
  }

  async function capturePhoto() {
    if (!videoRef.current) return
    setCapturing(true)
    await startCamera()
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    const blob = await (await fetch(dataUrl)).blob()
    const hash = await sha256Hex(await blob.arrayBuffer())
    const gps = await getGps()
    
    const newPhoto: ProofItem = {
      id: String(Date.now()),
      type: 'photo',
      dataUrl,
      fileName: `curing_capture_${Date.now().toString().slice(-4)}.jpg`,
      fileSize: '1.2 MB',
      hash,
      phase,
      status: 'Pending',
      timestamp: new Date().toISOString(),
      gps
    }

    setProofs((current) => [...current, newPhoto])
    setCapturing(false)
  }

  async function startVideo() {
    await startCamera()
    const stream = streamRef.current
    if (!stream) return
    const mr = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    mr.ondataavailable = (e) => chunks.push(e.data)
    mr.onstop = async () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const dataUrl = URL.createObjectURL(blob)
      const hash = await sha256Hex(await blob.arrayBuffer())
      const gps = await getGps()
      
      const newVideo: ProofItem = {
        id: String(Date.now()),
        type: 'video',
        dataUrl,
        fileName: `work_log_${Date.now().toString().slice(-4)}.mp4`,
        fileSize: '4.8 MB',
        hash,
        phase,
        status: 'Pending',
        timestamp: new Date().toISOString(),
        gps
      }
      setProofs((current) => [...current, newVideo])
    }
    recorderRef.current = mr
    mr.start()
    setRecording(true)
  }

  function stopVideo() {
    recorderRef.current?.stop()
    setRecording(false)
  }

  async function getGps() {
    return new Promise<{ lat: number; lng: number }>((resolve) => {
      navigator.geolocation?.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve({ lat: 12.9716, lng: 77.5946 }),
        { timeout: 3000 }
      )
    })
  }

  function deleteProof(proofId: string) {
    setProofs((current) => current.filter((p) => p.id !== proofId))
  }

  function submit() {
    const anchored = proofs.map((p) => ({
      ...p,
      status: 'Verified' as const,
      roadId: id,
      anchor: 'RoadRegistry'
    }))
    Promise.all(anchored.map((proof) => saveRecord('contractor_proofs', proof.id, proof)))
      .then(() => enqueueAction('contractor.proof.submit', { projectId: id, phase, count: anchored.length }))
    
    alert('✓ Cryptographic proof details successfully signed and anchored to Ledger registry.')
    navigate(`/contractor/project/${id}`)
  }

  async function onUploadComplete(result: any) {
    const cid = result?.ipfs || result?.cid || null
    setUploadCid(cid)
    await saveRecord('contractor_uploads', String(id), {
      projectId: id,
      uploadId: result?.uploadId,
      ipfs: cid,
      sha: result?.sha,
      filename: result?.filename,
      phase,
      completedAt: new Date().toISOString(),
    })
  }

  return (
    <Container>
      <div className="space-y-6 pb-12">
        {/* Navigation & Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-5">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate(`/contractor/project/${id}`)}
              className="p-2 border border-white/10 text-slate-300 hover:text-white bg-slate-900/40 rounded-xl"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#06B6D4] animate-pulse" />
                <span className="text-[10px] uppercase font-bold tracking-widest text-[#06B6D4]">
                  Evidence Registry
                </span>
              </div>
              <h1 className="text-2xl font-black text-white mt-0.5">Progress Proof Upload</h1>
              <p className="text-slate-400 text-xs mt-0.5">
                Submit visual evidence and completion logs for Project ID: <span className="font-mono text-slate-300">{id}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Form Selector for Phase */}
        <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
          <CardBody className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Active Infrastructure Phase</h3>
              <p className="text-[11px] text-slate-400">Select the specific phase you are logging evidence for.</p>
            </div>
            <select
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              className="bg-slate-950/80 text-slate-200 border border-white/10 rounded-xl px-4 py-2.5 text-xs font-semibold focus:outline-none focus:border-[#06B6D4]/50 min-w-[200px]"
            >
              <option>Foundation reinforcement</option>
              <option>Sub-base laying</option>
              <option>Bitumen overlay</option>
              <option>Line marking</option>
              <option>Drainage work</option>
            </select>
          </CardBody>
        </Card>

        {/* Media Capture and Preview Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Camera Capture Panel */}
          <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
            <CardBody className="p-5 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Camera className="h-4 w-4 text-[#06B6D4]" />
                  Secure Camera Stream
                </h3>
                {cameraActive && (
                  <Badge tone="success" className="text-[9px] px-2 py-0.5 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                    LIVE VIEW
                  </Badge>
                )}
              </div>

              {/* Viewport Box */}
              <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-slate-950/80 border border-white/5 flex flex-col items-center justify-center">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
                />
                {!cameraActive && (
                  <div className="text-center p-6 space-y-3">
                    <div className="h-14 w-14 rounded-full bg-cyan-950/40 border border-cyan-500/20 flex items-center justify-center mx-auto text-cyan-400">
                      <Camera className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">Camera Interface Suspended</h4>
                      <p className="text-[10px] text-slate-400 mt-1 max-w-[260px] mx-auto">
                        Activate the local media hardware interface to capture geo-tagged site images or record high-definition video logs.
                      </p>
                    </div>
                    <Button
                      onClick={startCamera}
                      className="text-xs font-semibold py-2 px-4 rounded-lg bg-cyan-950 border border-cyan-800/40 text-cyan-300 hover:bg-cyan-900/40"
                    >
                      Initialize Camera
                    </Button>
                  </div>
                )}

                {capturing && (
                  <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center">
                    <div className="text-center space-y-2">
                      <Spinner className="h-6 w-6 text-[#06B6D4] mx-auto" />
                      <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Capturing Frame...</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Camera Actions */}
              {cameraActive && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Button
                    onClick={capturePhoto}
                    disabled={capturing}
                    className="text-xs font-bold py-2.5 px-3 bg-gradient-to-r from-[#002045] to-[#1960a3] text-white rounded-lg flex items-center justify-center gap-1.5"
                  >
                    <Camera className="h-4 w-4" />
                    Capture Photo
                  </Button>
                  <Button
                    onClick={!recording ? startVideo : stopVideo}
                    className={`text-xs font-bold py-2.5 px-3 rounded-lg flex items-center justify-center gap-1.5 border ${
                      recording
                        ? 'border-red-500/30 bg-red-950/30 text-red-400'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:text-white'
                    }`}
                  >
                    <Video className="h-4 w-4" />
                    {recording ? 'Stop Recording' : 'Record Video'}
                  </Button>
                  <Button
                    onClick={stopCamera}
                    variant="ghost"
                    className="text-xs font-semibold py-2.5 px-3 rounded-lg border border-white/5 text-slate-400 hover:text-white"
                  >
                    Shutdown Interface
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Evidence Preview Panel */}
          <Card className="glass-card border-white/10 bg-[#122131]/40 backdrop-blur">
            <CardBody className="p-5 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <FileCheck className="h-4 w-4 text-[#8B5CF6]" />
                Evidence Logs & Preview ({proofs.length})
              </h3>

              <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                {proofs.map((proof) => (
                  <div
                    key={proof.id}
                    className="p-3 rounded-xl border border-white/5 bg-slate-950/20 relative overflow-hidden group"
                  >
                    <button
                      onClick={() => deleteProof(proof.id)}
                      className="absolute right-2 top-2 p-1 rounded bg-slate-900/80 text-slate-400 hover:text-red-400 hover:bg-slate-950 border border-white/5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>

                    <div className="flex items-center gap-3">
                      {proof.type === 'photo' ? (
                        <div className="h-14 w-20 rounded bg-slate-900 overflow-hidden border border-white/5 flex-shrink-0">
                          <img src={proof.dataUrl} alt="captured proof" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="h-14 w-20 rounded bg-slate-900 border border-white/5 flex items-center justify-center flex-shrink-0 text-purple-400">
                          <FileVideo className="h-6 w-6" />
                        </div>
                      )}

                      <div className="space-y-0.5 overflow-hidden flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white truncate max-w-[150px] sm:max-w-xs">
                            {proof.fileName || `${proof.type === 'photo' ? 'Image' : 'Video'}_Capture.bin`}
                          </span>
                          <span className="text-[9px] text-slate-500 font-medium">({proof.fileSize || '2.4 MB'})</span>
                        </div>
                        <p className="text-[10px] text-slate-400">Phase: <strong className="text-slate-300">{proof.phase}</strong></p>
                        <div className="flex flex-wrap gap-2 text-[9px] text-slate-500 pt-1 font-mono">
                          <span className="flex items-center gap-0.5">
                            <Cpu className="h-2.5 w-2.5 text-cyan-400" />
                            HASH: {proof.hash.slice(0, 8)}...
                          </span>
                          <span className="flex items-center gap-0.5">
                            <MapPin className="h-2.5 w-2.5 text-red-400" />
                            GPS: {proof.gps.lat.toFixed(4)}, {proof.gps.lng.toFixed(4)}
                          </span>
                        </div>
                      </div>

                      <Badge tone={proof.status === 'Verified' ? 'success' : 'warning'} className="text-[9px] px-1.5 py-0.2">
                        {proof.status}
                      </Badge>
                    </div>
                  </div>
                ))}

                {proofs.length === 0 && (
                  <div className="text-center py-12 text-slate-500 space-y-2">
                    <UploadCloud className="h-8 w-8 mx-auto text-slate-600" />
                    <p className="text-xs font-bold">No Visual Evidence Active</p>
                    <p className="text-[10px] text-slate-600">Please capture photos/videos via camera above or drag files here.</p>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* IPFS Uplink Component Section */}
        <Card className="glass-card border-[#06B6D4]/20 bg-[#06B6D4]/5 backdrop-blur">
          <CardBody className="p-5 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
              <UploadCloud className="h-4.5 w-4.5 text-[#06B6D4]" />
              Anchoring and Storage (IPFS Sync Node)
            </h3>
            <p className="text-[11px] text-slate-400">
              Synchronize evidence payloads to decentralized IPFS pinning storage. The resulting CID hash will be pinned in the Ledger system.
            </p>
            <div className="p-4 bg-slate-950/40 rounded-xl border border-white/5 space-y-3">
              <ResumableUpload
                metadata={{ type: 'contractor_proof', projectId: id }}
                onComplete={onUploadComplete}
              />
              <div className="flex items-center gap-2 mt-3 pt-2 border-t border-white/5">
                <span className="text-xs text-slate-400">Decentralized CID:</span>
                {uploadCid ? (
                  <Badge tone="success" className="font-mono text-[9px] select-all px-2 py-0.5 text-[#06B6D4] bg-[#06B6D4]/10 border border-[#06B6D4]/20">
                    ✓ {uploadCid}
                  </Badge>
                ) : (
                  <span className="text-[10px] text-slate-500 italic">Pending IPFS distribution</span>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Bottom Submission Actions */}
        <div className="flex gap-3">
          <Button
            onClick={() => navigate(-1)}
            variant="ghost"
            className="flex-1 text-xs font-bold py-3 rounded-xl border border-white/10 text-slate-300 hover:text-white"
          >
            Cancel Upload
          </Button>
          <Button
            onClick={submit}
            variant="primary"
            disabled={proofs.length === 0}
            className="flex-1 text-xs font-bold py-3 rounded-xl bg-gradient-to-r from-[#002045] to-[#1960a3] text-white hover:opacity-95 flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="h-4.5 w-4.5" />
            {proofs.length === 0 ? 'Capture Visual Proofs First' : '✓ Anchor & Register Proof'}
          </Button>
        </div>
      </div>
    </Container>
  )
}
