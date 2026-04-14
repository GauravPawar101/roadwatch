import { Object, Property } from 'fabric-contract-api';

export enum ComplaintStatus {
    FILED = 'FILED',
    IN_PROGRESS = 'IN_PROGRESS',
    RESOLVED = 'RESOLVED',
    REJECTED = 'REJECTED',
}

@Object()
export class Complaint {
    @Property()
    public ID!: string;

    @Property()
    public RoadID!: string;

    // Privacy: no direct PII on public ledger state.
    // Anchor an opaque commitment hash of off-ledger details (includes any PII).
    @Property()
    public DetailsHash!: string;

    @Property()
    public Status!: ComplaintStatus;

    @Property()
    public AuthorityOrg!: string;

    @Property()
    public CreatedAt!: number;

    @Property()
    public UpdatedAt!: number;
}

@Object()
export class ComplaintPII {
    // Stored in a Private Data Collection (PDC) or off-ledger DB.
    // NOTE: PDC data is still replicated across eligible peers; treat as sensitive.

    @Property()
    public CitizenID?: string;

    @Property()
    public Location?: string; // Stringified coordinates (e.g., JSON string)

    @Property()
    public InitialIPFSCid?: string;

    @Property()
    public ResolutionIPFSCid?: string;
}

@Object()
export class MerkleAnchorBatch {
    @Property()
    public ID!: string;

    @Property()
    public MerkleRoot!: string;

    @Property()
    public Count!: number;

    @Property()
    public CreatedAt!: number;
}
