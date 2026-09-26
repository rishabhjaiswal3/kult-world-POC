export type Capability = 'analysis' | 'creativity' | 'strategy' | 'social';
export type Outcome = 'success' | 'miss';
export interface AnchorReceipt {
  agentId: `0x${string}`;
  receiptId: `0x${string}`;
  evidenceHash: `0x${string}`;
  cap: Capability;
  outcome: Outcome;
  difficulty: number;
}
export declare const ROBINHOOD_TESTNET: Readonly<{chainId:46630;chainIdHex:'0xb626';name:string;explorerUrl:string}>;
export declare const DOMAIN: Readonly<Record<Capability, number>>;
export declare const OUTCOME: Readonly<Record<Outcome, number>>;
export declare function encodeAnchorCalldata(receipt: AnchorReceipt): `0x${string}`;
export declare class KultWorldClient {
  constructor(options?: {baseUrl?:string;fetchImpl?:typeof fetch});
  passport(agentId:string):Promise<unknown>;
  challenge(challengeId:string):Promise<unknown>;
  moment(slug:string):Promise<unknown>;
  leaderboard(cap?:Capability):Promise<unknown>;
  creators():Promise<unknown>;
}
