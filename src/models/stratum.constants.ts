// Stratum v1 extranonce sizes — matches the official Elektron Net pool
// integration guide (doc-elektron/mining-pool-integration.md §3.5):
//
//   coinbase = coinb1 + extranonce1 + extranonce2 + coinb2
//
// `extranonce1` is set per-connection by the pool (subscribe response),
// `extranonce2` is iterated by the miner in `mining.submit`. Both land
// inside the coinbase scriptSig, right after the BIP34 height push. The
// per-block `coinbase_required_outputs` (UTXO attestation + witness
// commitment) live entirely inside coinb2.
export const EXTRANONCE1_SIZE_BYTES = 4;
export const EXTRANONCE2_SIZE_BYTES = 4;
export const TOTAL_EXTRANONCE_SIZE_BYTES = EXTRANONCE1_SIZE_BYTES + EXTRANONCE2_SIZE_BYTES;
