// Elektron Net header-only mining.
//
// The per-block UTXO attestation in the node's GBT template is computed
// against an unmodified coinbase (scriptSig = BIP34 height push only).
// Inserting bytes into the coinbase scriptSig would change the coinbase
// txid and invalidate the attestation, so the pool must ship the coinbase
// through verbatim. Miners therefore iterate ONLY header bits (nNonce,
// nTime, BIP320 version-rolling).
//
// However, mainstream ASIC firmware (Bitaxe ESP-Miner, NerdMiner, Bitmain
// stock, BraiinsOS) requires a non-empty `extranonce1` in the
// `mining.subscribe` response — they treat an empty value as a malformed
// reply and close the TCP socket, producing a reconnect loop.
//
// Compromise:
//   * `EXTRANONCE1_SIZE_BYTES = 4` — pool emits a 4-byte per-connection
//     session id as extranonce1. Used by the firmware to identify the
//     session; with `EXTRANONCE2_SIZE_BYTES = 0`, the firmware should
//     NOT splice those bytes into the coinbase (no scriptSig iteration
//     happens because there is no extranonce2 to vary).
//   * `EXTRANONCE2_SIZE_BYTES = 0` — miner does not iterate the coinbase.
//     Coinbase from GBT is passed through unchanged; UTXO attestation
//     validates.
//
// If a particular firmware does splice extranonce1 into the coinbase even
// when extranonce2_size is 0, mined blocks will be rejected with
// `bad-utxo-attestation` (the scriptSig will contain 4 bytes the node did
// not expect). Pool-only fixes have reached their limit at that point.
export const EXTRANONCE1_SIZE_BYTES = 4;
export const EXTRANONCE2_SIZE_BYTES = 0;
export const TOTAL_EXTRANONCE_SIZE_BYTES = EXTRANONCE1_SIZE_BYTES + EXTRANONCE2_SIZE_BYTES;
