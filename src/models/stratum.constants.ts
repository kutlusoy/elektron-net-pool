// Stratum v1 extranonce sizes per Elektron Net Mining Pool Integration
// Guide v4.0.1, §3.5:
//
//   coinbase = coinb1 + extranonce1 + extranonce2 + coinb2
//
// `extranonce1` is set per-connection by the pool in the subscribe response,
// `extranonce2` is iterated by the worker in `mining.submit`. Per §3.5 the
// extranonce MUST only land in scriptSig (right after the BIP34 height
// push). All `coinbase_required_outputs` — UTXO attestation followed by
// witness commitment, in that order — live entirely inside coinb2.
//
// 4 + 4 = 8 bytes of total extranonce space mirrors the public-pool layout
// that mainstream firmware (Bitaxe, NerdMiner, BraiinsOS, Bitmain stock)
// is already configured for.
export const EXTRANONCE1_SIZE_BYTES = 4;
export const EXTRANONCE2_SIZE_BYTES = 4;
export const TOTAL_EXTRANONCE_SIZE_BYTES = EXTRANONCE1_SIZE_BYTES + EXTRANONCE2_SIZE_BYTES;
