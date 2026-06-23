// 1:1 mirror of mining/miner.py:_build_coinbase_tx.
//
// The Python reference miner sets `scriptSig = bytes.fromhex(prefix_hex)`
// where `prefix_hex` is the `coinbase_script_sig_prefix` returned by
// `getblocktemplate`. Nothing else is appended — no extranonce padding,
// no pool identifier. The accompanying comment in miner.py is explicit:
//
//   # Use the exact prefix from getblocktemplate so UTXO attestation matches.
//
// Anything beyond the prefix changes the coinbase txid and the node
// rejects the block with `bad-utxo-attestation`. To stay byte-for-byte
// equivalent to the reference miner, the pool must therefore advertise
// zero extranonce on both sides:
//
//   * EXTRANONCE1_SIZE_BYTES = 0  → nothing is spliced by the pool
//   * EXTRANONCE2_SIZE_BYTES = 0  → nothing is iterated by the worker
//   * coinb1 = the full non-witness coinbase serialization
//   * coinb2 = "" (empty)
//
// With both sizes 0, `coinb1 + extranonce1 + extranonce2 + coinb2`
// degenerates to `coinb1` — exactly the bytes miner.py emits.
export const EXTRANONCE1_SIZE_BYTES = 0;
export const EXTRANONCE2_SIZE_BYTES = 0;
export const TOTAL_EXTRANONCE_SIZE_BYTES = EXTRANONCE1_SIZE_BYTES + EXTRANONCE2_SIZE_BYTES;
