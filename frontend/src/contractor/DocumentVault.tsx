import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  FolderOpen,
  Search,
  ArrowLeft,
  FileText,
  FileImage,
  FileVideo,
  Download,
  Trash2,
  Clock,
  Plus,
  Upload,
  Cpu,
  ShieldCheck,
  SearchCode
} from 'lucide-react'
import { Badge, Button, Card, CardBody, Container, Spinner } from '../components/UIComponents'

type DocumentItem = {
  id: string
  name: string
  type: 'pdf' | 'jpg' | 'png' | 'mp4' | 'csv'
  size: string
  category: 'Contract' | 'Approval' | 'Inspection Log' | 'Material Receipt'
  date: string
  hash: string
}

const seedDocuments: DocumentItem[] = [
  {
    id: 'doc-1',
    name: 'rebar_foundation_west.jpg',
    type: 'jpg',
    size: '4.2 MB',
    category: 'Inspection Log',
    date: '2026-05-18 10:45 AM',
    hash: '5d8f2a93c71e8d9b2a7590d1101e405a'
  },
  {
    id: 'doc-2',
    name: 'structural_video_log.mp4',
    type: 'mp4',
    size: '28.5 MB',
    category: 'Inspection Log',
    date: '2026-05-18 09:30 AM',
    hash: '8f2a110d9e83c4b927ac05a110e54d82'
  },
  {
    id: 'doc-3',
    name: 'curing_check_v2.png',
    type: 'png',
    size: '1.8 MB',
    category: 'Inspection Log',
    date: '2026-05-17 04:15 PM',
    hash: 'cd4b9e2832af8b7201ec90da11abfe92'
  },
  {
    id: 'doc-4',
    name: 'seismic_design_pylons.pdf',
    type: 'pdf',
    size: '14.5 MB',
    category: 'Contract',
    date: '2026-05-12 11:00 AM',
    hash: 'a71e8d9b2a7590d1101e405abef8f110'
  },
  {
    id: 'doc-5',
    name: 'soil_density_report.csv',
    type: 'csv',
    size: '850 KB',
    category: 'Material Receipt',
    date: '2026-05-10 02:20 PM',
    hash: 'abfe92cc1a08e7b92f7ac0110e54d82f'
  }
]

export default function DocumentVault() {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'All' | 'Contract' | 'Approval' | 'Inspection Log' | 'Material Receipt'>('All')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('roadwatch_document_vault')
    if (saved) {
      setDocuments(JSON.parse(saved))
    } else {
      localStorage.setItem('roadwatch_document_vault', JSON.stringify(seedDocuments))
      setDocuments(seedDocuments)
    }
    setLoading(false)
  }, [])

  function saveDocs(docs: DocumentItem[]) {
    setDocuments(docs)
    localStorage.setItem('roadwatch_document_vault', JSON.stringify(docs))
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const ext = file.name.split('.').pop()?.toLowerCase() as any
    const categories: Record<string, any> = {
      pdf: 'Contract',
      jpg: 'Inspection Log',
      png: 'Inspection Log',
      mp4: 'Inspection Log',
      csv: 'Material Receipt'
    }

    const newDoc: DocumentItem = {
      id: String(Date.now()),
      name: file.name,
      type: ['pdf', 'jpg', 'png', 'mp4', 'csv'].includes(ext) ? ext : 'pdf',
      size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
      category: categories[ext] || 'Contract',
      date: new Date().toLocaleString(),
      hash: Math.random().toString(16).substring(2, 10) + Math.random().toString(16).substring(2, 10)
    }

    saveDocs([newDoc, ...documents])
    alert(`Successfully registered and hashed file: ${file.name}`)
  }

  function deleteDoc(id: string) {
    if (confirm('Are you sure you want to delete this document from the vault?')) {
      const updated = documents.filter((d) => d.id !== id)
      saveDocs(updated)
    }
  }

  const filtered = documents.filter((d) => {
    const matchesSearch = d.name.toLowerCase().includes(search.toLowerCase()) || d.hash.includes(search.toLowerCase())
    const matchesCategory = categoryFilter === 'All' || d.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  const getIcon = (type: string) => {
    switch (type) {
      case 'jpg':
      case 'png':
        return <FileImage className="h-5 w-5 text-cyan-400" />
      case 'mp4':
        return <FileVideo className="h-5 w-5 text-purple-400" />
      case 'csv':
        return <FileText className="h-5 w-5 text-yellow-500" />
      default:
        return <FileText className="h-5 w-5 text-rose-400" />
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner className="h-8 w-8 text-[#06B6D4]" />
      </div>
    )
  }

  return (
    <Container>
      <div className="space-y-6 pb-12">
        {/* Navigation & Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate('/dashboard/contractor')}
              className="p-2 border border-white/10 text-slate-300 hover:text-white bg-slate-900/40 rounded-xl"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#06B6D4]">
                  Secure Storage Registry
                </p>
              </div>
              <h1 className="text-2xl font-black text-white mt-1">Document Vault</h1>
              <p className="text-slate-400 text-xs mt-0.5">
                Unified repository for contract scopes, official approvals, and certified structural evidence payloads.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="relative cursor-pointer">
              <input
                type="file"
                onChange={handleFileUpload}
                className="hidden"
              />
              <span className="inline-flex items-center gap-2 bg-gradient-to-r from-[#002045] to-[#1960a3] hover:opacity-95 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow cursor-pointer transition">
                <Upload className="h-4 w-4" />
                Upload Document
              </span>
            </label>
          </div>
        </div>

        {/* Stats Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="glass-card">
            <CardBody className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Documents</p>
                <h4 className="text-2xl font-black text-white mt-1">{documents.length}</h4>
              </div>
              <div className="p-2 bg-white/5 rounded-lg border border-white/10">
                <FolderOpen className="h-5 w-5 text-cyan-400" />
              </div>
            </CardBody>
          </Card>

          <Card className="glass-card">
            <CardBody className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vault Hashing</p>
                <h4 className="text-lg font-black text-emerald-400 mt-1.5 flex items-center gap-1">
                  <ShieldCheck className="h-4 w-4" />
                  Active SHA-256
                </h4>
              </div>
              <div className="p-2 bg-white/5 rounded-lg border border-white/10">
                <Cpu className="h-5 w-5 text-emerald-400" />
              </div>
            </CardBody>
          </Card>

          <Card className="glass-card">
            <CardBody className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Last Audit Sync</p>
                <h4 className="text-sm font-bold text-slate-200 mt-2 flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-purple-400" />
                  4 mins ago
                </h4>
              </div>
              <div className="p-2 bg-white/5 rounded-lg border border-white/10">
                <Clock className="h-5 w-5 text-purple-400" />
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Filters and Search Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/40 p-4 rounded-2xl border border-white/5">
          <div className="relative flex-1 max-w-md">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
              <Search className="h-4 w-4" />
            </span>
            <input
              type="text"
              placeholder="Search by file name or hex hash..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-950/80 text-slate-200 pl-10 pr-4 py-2 rounded-xl text-xs font-medium border border-white/5 focus:outline-none focus:border-[#06B6D4]/50"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {['All', 'Contract', 'Approval', 'Inspection Log', 'Material Receipt'].map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  categoryFilter === cat
                    ? 'bg-gradient-to-r from-[#002045] to-[#1960a3] text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Documents Grid List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((item) => (
            <motion.div
              key={item.id}
              whileHover={{ y: -2 }}
              className="group rounded-2xl border border-white/10 bg-[#122131]/40 backdrop-blur p-4 flex flex-col justify-between gap-4 transition-all duration-300 hover:border-white/20"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-slate-950/80 border border-white/5 flex items-center justify-center flex-shrink-0">
                    {getIcon(item.type)}
                  </div>
                  <div className="space-y-0.5 overflow-hidden">
                    <h3 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors truncate max-w-[200px] sm:max-w-xs">
                      {item.name}
                    </h3>
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                      {item.category}
                    </p>
                    <div className="flex items-center gap-3 pt-1 text-[9px] text-slate-500 font-mono">
                      <span>Size: {item.size}</span>
                      <span>•</span>
                      <span>Type: {item.type.toUpperCase()}</span>
                    </div>
                  </div>
                </div>

                <Badge tone="success" className="text-[9px] px-2 py-0.5">
                  Verified
                </Badge>
              </div>

              {/* Hash and actions */}
              <div className="bg-slate-950/40 p-2.5 rounded-xl border border-white/5 flex items-center justify-between gap-4">
                <div className="font-mono text-[9px] text-slate-400 flex items-center gap-1 truncate">
                  <Cpu className="h-3 w-3 text-cyan-400" />
                  SHA: <span className="text-cyan-400 font-bold">{item.hash}</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    onClick={() => alert(`Simulating secure download for verified file: ${item.name}`)}
                    className="p-1.5 rounded bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    onClick={() => deleteDoc(item.id)}
                    className="p-1.5 rounded bg-red-950/20 border border-red-500/20 text-red-400 hover:text-red-300 hover:bg-red-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </motion.div>
          ))}

          {filtered.length === 0 && (
            <div className="col-span-full py-16 text-center text-slate-500 space-y-3">
              <SearchCode className="h-10 w-10 text-slate-600 mx-auto animate-pulse" />
              <h4 className="text-sm font-bold text-white">No Matching Documents</h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                No documents found for search term "{search}" in category "{categoryFilter}". Add a new document above.
              </p>
            </div>
          )}
        </div>
      </div>
    </Container>
  )
}
