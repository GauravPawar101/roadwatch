/**
 * Road hierarchy and the authority responsible for each level.
 *
 * A road complaint is only actionable if it reaches the body that can actually
 * fix the road, and in India that body depends on the road's class, not on where
 * it happens to be. The same pothole is PWD's problem on a state highway and the
 * municipal corporation's on a residential lane, and Agra has all of these
 * overlapping inside one district.
 *
 * This is the mapping that decides routing, so it is stated explicitly rather
 * than scattered through handlers.
 *
 * Two things this is deliberately not:
 *
 *  * Not a claim about who is assigned to a specific road. That is a
 *    notification-register question, not a classification one.
 *  * Not derived from OSM. `highway=motorway` says a road is a motorway; it does
 *    not say who maintains it in Uttar Pradesh. The ownership split between NHAI,
 *    UP PWD and the local bodies is a policy fact, published by those bodies, and
 *    is encoded here.
 */

export type AuthorityLevel = 'national' | 'state' | 'district' | 'municipal';

export type Authority = {
  id: string;
  name: string;
  /** What the body is, in the terms an Indian citizen would recognise. */
  kind: string;
  level: AuthorityLevel;
  /** The jurisdiction, for a directory entry. */
  jurisdiction: string;
  /**
   * Published contact channels, at the *office* level.
   *
   * Deliberately office-level only. Individual officers' personal numbers, personal
   * addresses and photographs are not collected: they are personal data under the
   * DPDP Act 2023, they are not needed to route a complaint, and a civic platform
   * that gathers them becomes a liability rather than an accountability tool.
   * Where a public directory publishes a designated officer's name and official
   * designation, that belongs in `officerDirectory()` and is reviewed separately.
   */
  officeContacts: Array<{ label: string; value: string }>;
  source: string;
};

/**
 * The authority levels, from the widest jurisdiction down.
 *
 * Ordered because a complaint escalates upward: a municipal body that does not
 * act within its SLA is escalated to the district, then the state.
 */
export const AUTHORITY_LEVELS: ReadonlyArray<{
  level: AuthorityLevel;
  label: string;
  description: string;
}> = [
  {
    level: 'national',
    label: 'National',
    description:
      'National highways and expressways. NHAI owns the alignment; maintenance is ' +
      'delegated to concessionaires under a contract.',
  },
  {
    level: 'state',
    label: 'State',
    description:
      'State highways, major district roads and other PWD roads. Uttar Pradesh PWD ' +
      'builds and maintains; execution is through the circles and divisions.',
  },
  {
    level: 'district',
    label: 'District',
    description:
      'District roads, and the development authority for the urban area. Agra ' +
      'Development Authority covers planning, land and major development roads.',
  },
  {
    level: 'municipal',
    label: 'Municipal',
    description:
      'Internal city streets, lanes and colony roads. Nagar Nigam Agra Nigam is the ' +
      'body responsible within the municipal limits.',
  },
];

/**
 * Road class to responsible authority.
 *
 * The mapping is by `road_type` as imported from OSM, because that is the value
 * the catalog stores. Ordered most-specific first: `motorway` before `trunk`,
 * because a motorway is a national-highway class whatever else it is.
 *
 * `service` is mapped to municipal rather than to "unowned". Service roads in
 * OSM are mostly internal access roads — colony lanes, apartment approaches, and
 * the unnamed stubs at the end of a residential street. They are the single most
 * common source of resident complaints and the most commonly mis-routed, because
 * sending them to PWD produces a referral and nothing else.
 */
export const AUTHORITY_BY_ROAD_TYPE: Readonly<Record<string, AuthorityLevel>> = {
  motorway: 'national',
  trunk: 'national',
  primary: 'state',
  secondary: 'state',
  tertiary: 'district',
  unclassified: 'district',
  service: 'municipal',
  residential: 'municipal',
};

export const DEFAULT_AUTHORITY_LEVEL: AuthorityLevel = 'district';

/** The authority level responsible for a road type. */
export function authorityLevelFor(roadType: string): AuthorityLevel {
  return AUTHORITY_BY_ROAD_TYPE[roadType] ?? DEFAULT_AUTHORITY_LEVEL;
}

/**
 * The authorities for Agra.
 *
 * Contact details are the *published office* channels. Each carries its source so a
 * stale number is traceable to the page it came from rather than being corrected
 * from memory. Numbers here are the kinds published in official gazette notices and
 * public directories; they should be re-verified against the source before any
 * deployment relies on them, and a wrong number in a civic tool costs a citizen a
 * phone call.
 */
export const AGRA_AUTHORITIES: readonly Authority[] = [
  {
    id: 'AUTH-NHAI-UP',
    name: 'National Highways Authority of India — Uttar Pradesh Zone',
    kind: 'National road authority',
    level: 'national',
    jurisdiction: 'National highways in Uttar Pradesh, including the Agra-Lucknow and Agra-Gwalior corridors',
    officeContacts: [
      { label: 'Official website', value: 'https://nhai.gov.in' },
      { label: 'Central office (toll-free)', value: '1800-233-1323' },
    ],
    source:
      'NHAI public contact page. The zone office address and regional grievance ' +
      'officer change over time and should be re-read from the site before deployment.',
  },
  {
    id: 'AUTH-PWD-UP',
    name: 'Uttar Pradesh Public Works Department',
    kind: 'State road authority',
    level: 'state',
    jurisdiction: 'State highways, MDRs and PWD roads in Uttar Pradesh',
    officeContacts: [
      { label: 'Official website', value: 'https://pwd.up.nic.in' },
      { label: 'Department office', value: 'Kavi Kulgarg Bhawan, Kalash Kunj, Lucknow' },
    ],
    source:
      'UP PWD public site. Divisional and circle offices are listed per district; the ' +
      'Agra division office is the correct first escalation for a state road.',
  },
  {
    id: 'AUTH-ADA-AGRA',
    name: 'Agra Development Authority',
    kind: 'Development authority',
    level: 'district',
    jurisdiction: 'Agra district urban area — planning, land use and development roads',
    officeContacts: [
      { label: 'Official website', value: 'https://ada.up.nic.in' },
      { label: 'Commissioner office', value: 'Kartavya Path, Civil Lines, Agra' },
    ],
    source:
      'ADA public site. The commissioner is a designated office, not an individual ' +
      'holder of the post, and rotates.',
  },
  {
    id: 'AUTH-NAGAR-NIGAM-AGRA',
    name: 'Nagar Nigam Agra Nigam',
    kind: 'Municipal body',
    level: 'municipal',
    jurisdiction: 'Roads within Agra municipal limits',
    officeContacts: [
      { label: 'Official website', value: 'https://agranagarnigam.in' },
      { label: 'Nagar Nigam office', value: 'Nagar Nigam Parishad, Civil Lines, Agra' },
    ],
    source:
      'Municipal body public site. The office address is published in the civic ' +
      'hierarchy; the grievance channel should be read from the site, not assumed.',
  },
  {
    id: 'AUTH-DISTRICT-AGRA',
    name: 'District Administration, Agra',
    kind: 'District administration',
    level: 'district',
    jurisdiction: 'Overall district coordination; the escalation point when a lower body has not acted',
    officeContacts: [
      { label: 'Official website', value: 'https://agra.nic.in' },
      { label: 'District Magistrate office', value: 'Collectorate, Agra' },
    ],
    source:
      'District administration public site. Used as the escalation authority rather ' +
      'than as the first point of contact for a specific road.',
  },
];

export function authorityById(id: string): Authority | undefined {
  return AGRA_AUTHORITIES.find(a => a.id === id);
}

export function authorityByLevel(level: AuthorityLevel): Authority | undefined {
  return AGRA_AUTHORITIES.find(a => a.level === level);
}

/** The next authority up the escalation chain from `level`. */
export function escalateFrom(level: AuthorityLevel): AuthorityLevel | undefined {
  const order: AuthorityLevel[] = ['municipal', 'district', 'state', 'national'];
  const i = order.indexOf(level);
  return i === -1 ? undefined : order[i + 1];
}

export type RoadTypeSummary = {
  road_type: string;
  roads: number;
  total_km: number;
  named: number;
  authority_id: string;
  authority_name: string;
  authority_level: AuthorityLevel;
};

/**
 * The report the platform actually needs: every road class, how much of it there
 * is, and who is responsible for it.
 *
 * Grouping in SQL rather than in JS so the numbers come from the table rather than
 * from a re-derivation that could disagree with it.
 */
export async function buildAuthorityReport(
  query: (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
  districtId: string,
): Promise<RoadTypeSummary[]> {
  const result = await query(
    `select r.road_type,
            count(*)::int as roads,
            round(coalesce(sum(r.total_length_km), 0)::numeric, 1)::float as total_km,
            count(*) filter (where r.name is not null)::int as named
     from roads_catalog r
     where r.district_id = $1
     group by r.road_type
     order by total_km desc`,
    [districtId],
  );

  return result.rows.map(row => {
    const roadType = String(row.road_type);
    const level = authorityLevelFor(roadType);
    const authority = authorityByLevel(level);
    return {
      road_type: roadType,
      roads: Number(row.roads),
      total_km: Number(row.total_km),
      named: Number(row.named),
      authority_id: authority?.id ?? 'unassigned',
      authority_name: authority?.name ?? 'Unassigned',
      authority_level: level,
    };
  });
}
