import { authorityProfiles, contractorProfiles } from '../data/roadwatchDashboard'

type RoadContextInput = {
  roadId?: string
  assignedContractor?: string
  assignedAuthority?: string
  severity?: number
}

type RoadBlueprint = {
  roadName: string
  roadType: string
  contractorName: string
  contractorHandle: string
  officerName: string
  officerRole: string
  sanctionedBudgetINR: number
}

type RoadContext = RoadBlueprint & {
  roadId: string
  contractorProfileName: string
  contractorRoute: string
  officerLabel: string
  finance: {
    sanctionedBudgetINR: number
    releasedBudgetINR: number
    spentBudgetINR: number
    pendingBudgetINR: number
    reserveBudgetINR: number
  }
}

const roadBlueprints: Record<string, RoadBlueprint> = {
  r1: {
    roadName: 'NH-48: Pune–Mumbai',
    roadType: 'National Highway (NH)',
    contractorName: 'SuperBuild Infra',
    contractorHandle: 'superbuild-infra',
    officerName: 'Rohit Verma',
    officerRole: 'Executive Engineer',
    sanctionedBudgetINR: 28000000,
  },
  r2: {
    roadName: 'SH-27 Bypass',
    roadType: 'State Highway (SH)',
    contractorName: 'RoadForge Works',
    contractorHandle: 'roadforge-works',
    officerName: 'Neha Sharma',
    officerRole: 'Junior Engineer',
    sanctionedBudgetINR: 19500000,
  },
  r3: {
    roadName: 'MDR-11 Link Road',
    roadType: 'Major District Road (MDR)',
    contractorName: 'MetroRoads Ltd',
    contractorHandle: 'metroroads-ltd',
    officerName: 'Dr. P. Iyer',
    officerRole: 'Chief Engineer',
    sanctionedBudgetINR: 14250000,
  },
}

function normalize(value: string | undefined) {
  return (value ?? '').trim().toLowerCase()
}

export function formatCurrencyINR(value: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

function findContractorProfile(contractorName?: string) {
  const lookup = normalize(contractorName)
  return contractorProfiles.find((profile) => normalize(profile.name) === lookup || normalize(profile.handle) === lookup) ?? contractorProfiles[0]
}

function findAuthorityProfile(label?: string) {
  const lookup = normalize(label)
  return authorityProfiles.find((profile) => normalize(profile.name) === lookup || normalize(profile.role) === lookup || normalize(`${profile.name}, ${profile.role}`) === lookup) ?? authorityProfiles[1] ?? authorityProfiles[0]
}

function inferRoadBlueprint(roadId?: string) {
  const normalizedRoadId = normalize(roadId)
  if (normalizedRoadId && roadBlueprints[normalizedRoadId]) {
    return roadBlueprints[normalizedRoadId]
  }

  if (normalizedRoadId.startsWith('r')) {
    return roadBlueprints.r1
  }

  return roadBlueprints.r2
}

export function resolveRoadContext(input: RoadContextInput): RoadContext {
  const blueprint = inferRoadBlueprint(input.roadId)
  const contractorProfile = findContractorProfile(input.assignedContractor || blueprint.contractorName)
  const authorityProfile = findAuthorityProfile(input.assignedAuthority || blueprint.officerName)
  const sanctionedBudgetINR = contractorProfile.lifecycleCostINR || blueprint.sanctionedBudgetINR
  const releasedBudgetINR = Math.round(sanctionedBudgetINR * 0.72)
  const spentBudgetINR = Math.round(releasedBudgetINR * (0.64 + Math.min(0.12, Math.max(0, (input.severity ?? 5) - 3) * 0.03)))
  const pendingBudgetINR = Math.max(0, releasedBudgetINR - spentBudgetINR)
  const reserveBudgetINR = Math.max(0, sanctionedBudgetINR - releasedBudgetINR)

  return {
    roadId: input.roadId || 'r1',
    ...blueprint,
    contractorName: input.assignedContractor || blueprint.contractorName,
    contractorHandle: contractorProfile.handle,
    officerName: input.assignedAuthority || authorityProfile.name,
    officerRole: authorityProfile.role || blueprint.officerRole,
    contractorProfileName: contractorProfile.name,
    contractorRoute: '/dashboard/contractor',
    officerLabel: `${authorityProfile.name} · ${authorityProfile.role}`,
    finance: {
      sanctionedBudgetINR,
      releasedBudgetINR,
      spentBudgetINR,
      pendingBudgetINR,
      reserveBudgetINR,
    },
  }
}