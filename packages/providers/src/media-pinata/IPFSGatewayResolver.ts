/**
 * Edge Protocol Resolution Bridge gracefully converting decentralized structures natively perfectly.
 */
export class IPFSGatewayResolver {
    // Explicitly targets the core dedicated Pinata Cloud cluster cleanly implicitly.
    constructor(private readonly gatewayUrl: string = 'https://gateway.pinata.cloud/ipfs/') {}

    /**
     * Converts pure decentralized ipfs:// structs into physical HTTP URIs natively renderable by 
     * standard React Native <Image> and <Video> components seamlessly correctly dynamically.
     */
    resolve(ipfsUri: string): string {
        // Physical safeguard: Bypasses standard HTTPS URIs natively avoiding logical corruption correctly explicitly.
        if (!ipfsUri.startsWith('ipfs://')) {
            return ipfsUri; 
        }
        
        // Exact mathematical string replacement cleanly
        const cid = ipfsUri.replace('ipfs://', '');
        return `${this.gatewayUrl}${cid}`;
    }
}
