// Elektron Net: the per-block UTXO attestation in the node's GBT template is
// computed against an unmodified coinbase (scriptSig = BIP34 height push only).
// Any extranonce inserted into the coinbase scriptSig would change the coinbase
// txid and invalidate the attestation, so this pool does header-only mining:
// workers vary nNonce, nTime and version bits (BIP320 version-rolling) but the
// coinbase is sent through unchanged. Extranonce sizes are therefore 0.
export const EXTRANONCE1_SIZE_BYTES = 0;
export const EXTRANONCE2_SIZE_BYTES = 0;
export const TOTAL_EXTRANONCE_SIZE_BYTES = EXTRANONCE1_SIZE_BYTES + EXTRANONCE2_SIZE_BYTES;
