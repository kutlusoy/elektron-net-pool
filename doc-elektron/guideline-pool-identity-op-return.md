# Elektron Net - `elektron-net-pool` Pool Identity OP_RETURN Guideline

- **Version:** 0.1 (implemented on `poolidentity`, pending review/merge and live testing before `main`)
- **Date:** September 4, 2026
- **Audience:** `elektron-net-pool` developers, solo-pool operators
- **Reference implementation:** [`elektron-net`](https://github.com/kutlusoy/elektron-net) - `doc-elektron/guideline-coinbase-third-op-return.md` (the decided design this document extends), `src/validation.cpp` (`ExtractCoinbaseUTXOAttestation()`), `src/consensus/validation.h` (`GetWitnessCommitmentIndex()`) - treat as ground truth for anything referenced below
- **Consumer:** [`elektron-net-mempool`](https://github.com/kutlusoy/elektron-net-mempool) - `backend/src/api/pool-identity-parser.ts`, `backend/src/api/bitcoin/bitcoin.routes.ts` (detection/display side, specified in `doc-elektron/guideline-pool-identity-detection.md` in that repo) - already pool-agnostic and content-addressed, so this document requires no change on the mempool side (see Section 8)
- **See also:** [`guideline-coinbase-third-op-return.md`](https://github.com/kutlusoy/elektron-net/blob/main/doc-elektron/guideline-coinbase-third-op-return.md), [`elektron-net-ppool`'s guideline-pool-identity-op-return.md](https://github.com/kutlusoy/elektron-net-ppool/blob/poolidentity/doc-elektron/guideline-pool-identity-op-return.md) (the sibling document this one mirrors byte-for-byte), [`mining-pool-integration.md`](https://github.com/kutlusoy/elektron-net/blob/main/doc-elektron/mining-pool-integration.md)

- Requirement-level words follow standard usage: **MUST** = mandatory, **SHOULD** = strongly recommended, **MAY** = optional.
- Never use the em dash character in this document or its follow-up code comments; use a hyphen and spaces instead, as done throughout.

---

## 1. Status of This Document

This document ports `elektron-net-ppool`'s `doc-elektron/guideline-pool-identity-op-return.md` to `elektron-net-pool` (the solo pool). `elektron-net-ppool`'s Section 10 explicitly flagged this as an open question ("Should `elektron-net-pool` receive the identical feature for parity?"), and `elektron-net-mempool`'s companion document recommended the same magic bytes be reused so its detector needs no pool-specific code. Both are resolved here: yes, and the identical `EPNM`/`EPUR` magic bytes are reused unchanged.

**Implemented** on the `poolidentity` branch (`src/models/MiningJob.ts`, `.env.example`, `src/models/MiningJob.spec.ts`), not yet merged to `main` - live testing on regtest/testnet is pending before merge, same as `elektron-net-ppool`'s process. See Section 9 for what remains.

## 2. Why: Same Limits as `elektron-net-ppool`, Same Fix

`elektron-net-pool` builds its coinbase transaction the same way `elektron-net-ppool` does: `src/models/MiningJob.ts`'s constructor builds exactly one spendable payout output (`vout[0]`, see `createCoinbaseTransaction()`), and today's address-based pool matching in `elektron-net-mempool` (`pools-parser.ts`, `matchBlockMiner()`) is the only way a block explorer can attribute a block to this pool. The three problems `elektron-net-ppool`'s document lists in its Section 2 (address rotation breaks identification, no structured URL field, payment and identity conflated) apply identically here - `elektron-net-pool` is a solo pool, not a PPLNS pool, but its coinbase-construction code path is the same `MiningJob.ts` shape (confirmed by comparing both repos' `src/models/MiningJob.ts` before this change: identical except for pool-specific defaults such as `POOL_IDENTIFIER`'s default string).

## 3. Decided Constraint (Inherited, Must Not Be Violated)

Identical to `elektron-net-ppool`'s Section 3 - both repos share the same `elektron-net` node, so the same validation-side facts apply without modification:

- **UTXO attestation** - `ExtractCoinbaseUTXOAttestation()` (`src/validation.cpp:2423-2459`) scans `vout` and returns on the **first** output whose `OP_RETURN` payload decodes as **two consecutive data pushes**: a `CScriptNum`-like value equal to the current height, then an **exact 32-byte** push.
- **Witness commitment** - `GetWitnessCommitmentIndex()` (`src/consensus/validation.h:147-162`) scans `vout` and keeps the **last** output whose `OP_RETURN` payload is a **single 36-byte push** starting with the 4-byte magic `aa21a9ed`.

Any new coinbase output this document adds **MUST** stay clear of both shapes, exactly as `elektron-net-ppool`'s Section 3 (a)-(c) require: single data push per output, magic prefixes that do not start with `aa21a9ed`, and always appended strictly after the existing `coinbase_required_outputs` loop.

## 4. New Design: Two Magic-Tagged Outputs (Identical Bytes to `elektron-net-ppool`)

Same two outputs, same magic bytes - reusing the exact values already confirmed against `elektron-net-mempool`'s parser is what makes this a zero-change addition on the mempool side (Section 8):

| Output | Content | Magic (hex) | Magic (ASCII) |
|---|---|---|---|
| Last-but-one | Pool name | `45504e4d` | `EPNM` (Elektron Pool NaMe) |
| Last | Pool URL | `45505552` | `EPUR` (Elektron Pool URl) |

Each output's script is `OP_RETURN <ONE data push>`, where the pushed bytes are `MAGIC (4 bytes) || UTF-8 payload`. Both outputs have `value = 0`. The safety reasoning (single push defeats the two-push attestation shape; magic's first byte `0x45` differs from the commitment magic's `0xaa`; `OP_RETURN` outputs never enter the UTXO set) is identical to `elektron-net-ppool`'s Section 4 and is not repeated here.

Both outputs **MUST** be appended after the existing `coinbase_required_outputs` loop / witness-commitment fallback branch, so they are always the **last two** coinbase outputs, located by content rather than position exactly as `elektron-net-mempool`'s parser expects.

Either output **MAY** be omitted independently if its underlying config value is not set. When a value is omitted, no placeholder or zero-length output is produced for it - the coinbase looks exactly as it does today for an operator who does not opt in. This is the backward-compatibility guarantee: an `elektron-net-pool` deployment that does not set `POOL_URL` (and, for existing deployments, one that already runs with a `POOL_IDENTIFIER` value it never intended as an on-chain identity) keeps a byte-for-byte unchanged coinbase, so nothing that depends on today's coinbase shape can break.

## 5. Config Surface

- **Pool name** reuses the existing `POOL_IDENTIFIER` environment variable (already present in this repo's `.env.example`, default `"Elektron-Pool"`, already used off-chain in `StratumV1Client.ts` for external share submission - same pattern as `elektron-net-ppool`, different default string). No new variable for the name.
- **Pool URL** is a **new** environment variable, `POOL_URL` (e.g. `https://elektron-net.org`), optional, unset by default. When unset, the URL output is not produced.
- Both values **SHOULD** be capped at 64 bytes of UTF-8 text per field, identical to `elektron-net-ppool`'s Section 5 - kept identical rather than repeating the open byte-cap question independently in each repo (see `elektron-net-ppool`'s Section 10, item 1, which remains the single place this is tracked).
- Both values **MUST** be sanitized before being pushed on-chain: strip bytes that do not form valid UTF-8, and truncate on a UTF-8 code-point boundary (never split a multi-byte sequence).

## 6. Exact Code Hook (`MiningJob.ts`)

Identical insertion point to `elektron-net-ppool`: immediately after the existing `requiredOutputs` / `witnessCommit` fallback block and before the `MAX_BLOCK_WEIGHT` check, i.e. right after the code that ends around:

```ts
} else if (jobTemplate.block.witnessCommit) {
    // ... existing witness-commitment fallback ...
}
```

and before:

```ts
if ((this.coinbaseTransaction.weight() + jobTemplate.block.weight()) > MAX_BLOCK_WEIGHT) {
```

Implemented as a private method `appendPoolIdentityOutputs(configService)`, called from the constructor at that exact point, that:

1. Reads `POOL_IDENTIFIER` and `POOL_URL` from `ConfigService`.
2. For each non-empty value: sanitizes and truncates it per Section 5, builds `bitcoinjs.script.compile([bitcoinjs.opcodes.OP_RETURN, Buffer.concat([MAGIC, sanitizedTextBuffer])])`, and calls `this.coinbaseTransaction.addOutput(script, 0)`.
3. Skips the output entirely (no call to `addOutput`) when the corresponding config value is empty/unset.
4. Runs strictly after the existing `requiredOutputs` loop / witness-commitment fallback, and strictly before the weight check, so both new outputs are always counted in the existing `MAX_BLOCK_WEIGHT` guard with no separate check needed.

The implementation in `src/models/MiningJob.ts` is a straight port of `elektron-net-ppool`'s version - same helper methods (`appendPoolIdentityOutputs`, `appendPoolIdentityOutput`, `sanitizePoolIdentityText`), same magic constants, same 64-byte cap.

## 7. Test Plan

`src/models/MiningJob.spec.ts` was extended with the same cases as `elektron-net-ppool`'s `MiningJob.spec.ts`:

- Both `POOL_IDENTIFIER` and `POOL_URL` set -> exactly two new outputs appended, in order, as the **last** two outputs.
- Only one of the two set -> exactly one new output appended, the other absent.
- Neither set -> no change from today's coinbase shape (regression guard).
- Each new output decompiles to exactly `[OP_RETURN, <one Buffer>]` (single push, never two).
- Each new output's pushed bytes start with the expected magic (`45504e4d` / `45505552`).
- Truncation on a UTF-8 code-point boundary at the 64-byte cap, with no replacement characters.
- Neither new output's pushed bytes can ever form a 36-byte push starting with `aa21a9ed`.

## 8. Impact on `elektron-net-mempool`: None

`elektron-net-mempool`'s `pool-identity-parser.ts` (per its own `doc-elektron/guideline-pool-identity-detection.md`, Section 4) is deliberately pool-agnostic: it scans every coinbase `vout` for the exact magic bytes `EPNM`/`EPUR`, with no per-pool special-casing and no dependency on which pool produced the block. Because this document reuses those same magic bytes unchanged, `elektron-net-pool` blocks that set `POOL_IDENTIFIER`/`POOL_URL` are detected and surfaced by the existing, already-merged-to-`poolidentity` mempool backend with **zero code changes** on that side. This closes the open question `elektron-net-mempool`'s document raised in its own Section 10, item 3.

## 9. Checklist

- [x] Implement `appendPoolIdentityOutputs()` in `MiningJob.ts` per Section 6 (ported from `elektron-net-ppool`)
- [x] Add `POOL_URL` to `.env.example`, documented next to the existing `POOL_IDENTIFIER` entry
- [x] Implement the sanitize/length-cap helper (Section 5)
- [x] Extend `MiningJob.spec.ts` per Section 7
- [ ] Live-test on regtest/testnet (real `getblocktemplate`, real submitted block) before merging to `main`
- [ ] Update `elektron-net`'s `mining-pool-integration.md` once merged, to document the two identity outputs as part of the coinbase layout (same follow-up `elektron-net-ppool`'s document already tracks)

## 10. Open Questions

1. Exact byte cap per field - tracked once, in `elektron-net-ppool`'s `doc-elektron/guideline-pool-identity-op-return.md` Section 10, item 1, to avoid two repos disagreeing on the same constant.
2. `elektron-net-stack` does not currently orchestrate `elektron-net-pool` (it only installs `elektron-net-ppool` as the pool service - confirmed by inspecting `elektron-stack.conf.example` and `install-elektron-stack.sh` on both `main` and `poolidentity`, neither of which reference `elektron-net-pool`). No stack-side change is needed for this document; if `elektron-net-pool` is ever added to the stack, its `POOL_URL` should be wired into `elektron-stack.conf.example` the same way `elektron-net-ppool`'s already is.
