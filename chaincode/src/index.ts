import type { Contract } from 'fabric-contract-api';
import { ComplaintContract } from './contract';

// Fabric Node chaincode entrypoint.
// The Fabric Node runtime will load this module and start the shim.
// We only need to export the contracts array.
export const contracts: Array<typeof Contract> = [ComplaintContract];
