import * as bitcoinjs from 'bitcoinjs-lib';

import { IJobTemplate } from '../services/stratum-v1-jobs.service';
import { eResponseMethod } from './enums/eResponseMethod';
import { IMiningNotify } from './stratum-messages/IMiningNotify';
import { ConfigService } from '@nestjs/config';
import { TOTAL_EXTRANONCE_SIZE_BYTES } from './stratum.constants';

const MAX_BLOCK_WEIGHT = 4000000;
const MAX_SCRIPT_SIZE = 100; //   https://github.com/bitcoin/bitcoin/blob/ffdc3d6060f6e65e69cf115a13b83e6eb4a0a0a8/src/consensus/tx_check.cpp#L49
interface AddressObject {
    address: string;
    percent: number;
}
export class MiningJob {

    private coinbaseTransaction: bitcoinjs.Transaction;
    private coinbasePart1: string;
    private coinbasePart2: string;
    private coinbasePart1Buffer: Buffer;
    private coinbasePart2Buffer: Buffer;
    private merkleBranchBuffers: Buffer[];

    public jobTemplateId: string;
    public networkDifficulty: number;
    public creation: number;

    constructor(
        configService: ConfigService,
        private network: bitcoinjs.networks.Network,
        public jobId: string,
        payoutInformation: AddressObject[],
        jobTemplate: IJobTemplate
    ) {

        this.creation = new Date().getTime();
        this.jobTemplateId = jobTemplate.blockData.id;
        this.merkleBranchBuffers = jobTemplate.merkle_branch.map(branch => Buffer.from(branch, 'hex'));

        this.coinbaseTransaction = this.createCoinbaseTransaction(payoutInformation, jobTemplate.blockData.coinbasevalue);
        // Elektron Net consensus: coinbase nLockTime must equal height - 1 (see
        // doc-elektron/mining-pool-integration.md §9 and src/node/miner.cpp:198).
        this.coinbaseTransaction.locktime = jobTemplate.blockData.height - 1;

        // Build the scriptSig prefix (BIP34 height push). For Elektron Net, the node may supply
        // `coinbase_script_sig_prefix` verbatim — if present, use it instead of self-encoding.
        // Layout: <prefix bytes> <pool identifier> <padding for extranonce>
        let blockHeightPrefix: Buffer;
        if (jobTemplate.coinbase_script_sig_prefix && jobTemplate.coinbase_script_sig_prefix.length > 0) {
            blockHeightPrefix = jobTemplate.coinbase_script_sig_prefix;
        } else {
            // Encode the block height (BIP34)
            const blockHeightEncoded = bitcoinjs.script.number.encode(jobTemplate.blockData.height);
            const blockHeightLengthByte = Buffer.from([blockHeightEncoded.length]);
            blockHeightPrefix = Buffer.concat([blockHeightLengthByte, blockHeightEncoded]);
        }

        const poolIdentifier = configService.get('POOL_IDENTIFIER') || 'Public-Pool';
        const extra = Buffer.from(poolIdentifier);

        // Padding so the extranonce region always lands at a known offset.
        // Original formula: EXTRANONCE + (3 - encoded_height_length); since
        // blockHeightPrefix = length_byte + encoded_height_bytes, prefix.length = 1 + encoded_length.
        // → padding = EXTRANONCE + 4 - prefix.length, clamped to 0.
        const paddingSize = Math.max(0, TOTAL_EXTRANONCE_SIZE_BYTES + 4 - blockHeightPrefix.length);
        const padding = Buffer.alloc(paddingSize, 0);

        let script = Buffer.concat([blockHeightPrefix, extra, padding]);
        if (script.length > MAX_SCRIPT_SIZE) {
            console.warn('Pool identifier is too long, removing the pool identifier');
            script = Buffer.concat([blockHeightPrefix, padding]);
        }

        this.coinbaseTransaction.ins[0].script = script;

        // Elektron Net: append all `coinbase_required_outputs` from GBT verbatim, in order.
        //   [0] = UTXO attestation (OP_RETURN <height> <32-byte UTXO hash>)
        //   [1] = witness commitment (OP_RETURN 0x24 0xaa21a9ed <32-byte commitment>)
        // Fallback for legacy/Bitcoin templates that did not provide required outputs:
        // build the witness commitment from block.witnessCommit (Bitcoin-compatible path).
        const requiredOutputs = jobTemplate.coinbase_required_outputs ?? [];
        if (requiredOutputs.length > 0) {
            for (const out of requiredOutputs) {
                this.coinbaseTransaction.addOutput(out.scriptPubKey, out.value);
            }
        } else if (jobTemplate.block.witnessCommit) {
            const segwitMagicBits = Buffer.from('aa21a9ed', 'hex');
            this.coinbaseTransaction.addOutput(
                bitcoinjs.script.compile([bitcoinjs.opcodes.OP_RETURN, Buffer.concat([segwitMagicBits, jobTemplate.block.witnessCommit])]),
                0,
            );
        }

        if ((this.coinbaseTransaction.weight() + jobTemplate.block.weight()) > MAX_BLOCK_WEIGHT) {
            console.warn('Block weight exceeds the maximum allowed weight, removing the pool identifier');
            this.coinbaseTransaction.ins[0].script = Buffer.concat([blockHeightPrefix, padding]);
        }

        // get the non-witness coinbase tx
        //@ts-ignore
        const serializedCoinbaseTx = this.coinbaseTransaction.__toBuffer().toString('hex');

        const inputScript = this.coinbaseTransaction.ins[0].script.toString('hex');

        const partOneIndex = serializedCoinbaseTx.indexOf(inputScript) + inputScript.length;

        this.coinbasePart1 = serializedCoinbaseTx.slice(0, partOneIndex - (TOTAL_EXTRANONCE_SIZE_BYTES * 2));
        this.coinbasePart2 = serializedCoinbaseTx.slice(partOneIndex);
        this.coinbasePart1Buffer = Buffer.from(this.coinbasePart1, 'hex');
        this.coinbasePart2Buffer = Buffer.from(this.coinbasePart2, 'hex');


    }

    public cloneCoinbaseTransaction(): bitcoinjs.Transaction {
        return bitcoinjs.Transaction.fromBuffer(this.coinbaseTransaction.toBuffer());
    }

    public buildHeaderBuffer(jobTemplate: IJobTemplate, versionMask: number, nonce: number, extraNonce: string, extraNonce2: string, timestamp: number): Buffer {
        const coinbaseBuffer = Buffer.concat([
            this.coinbasePart1Buffer,
            Buffer.from(`${extraNonce}${extraNonce2}`, 'hex'),
            this.coinbasePart2Buffer,
        ]);
        const coinbaseHash = bitcoinjs.crypto.hash256(coinbaseBuffer);
        const merkleRoot = this.calculateMerkleRootHash(coinbaseHash, this.merkleBranchBuffers);

        let version = jobTemplate.block.version;
        if (versionMask !== undefined && versionMask != 0) {
            version = version ^ versionMask;
        }

        const header = Buffer.alloc(80);
        header.writeInt32LE(version, 0);
        jobTemplate.block.prevHash.copy(header, 4);
        merkleRoot.copy(header, 36);
        header.writeUInt32LE(timestamp, 68);
        header.writeUInt32LE(jobTemplate.block.bits, 72);
        header.writeUInt32LE(nonce, 76);

        return header;
    }

    public copyAndUpdateBlock(jobTemplate: IJobTemplate, versionMask: number, nonce: number, extraNonce: string, extraNonce2: string, timestamp: number): bitcoinjs.Block {

        const testBlock = Object.assign(new bitcoinjs.Block(), jobTemplate.block);
        testBlock.transactions = jobTemplate.block.transactions.map(tx => {
            return Object.assign(new bitcoinjs.Transaction(), tx);
        });

        testBlock.transactions[0] = this.cloneCoinbaseTransaction();

        testBlock.nonce = nonce;

        // recompute version mask
        if (versionMask !== undefined && versionMask != 0) {
            testBlock.version = (testBlock.version ^ versionMask);
        }

        // set the nonces
        const nonceScript = testBlock.transactions[0].ins[0].script.toString('hex');

        testBlock.transactions[0].ins[0].script = Buffer.from(`${nonceScript.substring(0, nonceScript.length - (TOTAL_EXTRANONCE_SIZE_BYTES * 2))}${extraNonce}${extraNonce2}`, 'hex');

        //recompute the root since we updated the coinbase script with the nonces
        testBlock.merkleRoot = this.calculateMerkleRootHash(testBlock.transactions[0].getHash(false), this.merkleBranchBuffers);


        testBlock.timestamp = timestamp;

        return testBlock;
    }


    private calculateMerkleRootHash(newRoot: Buffer, merkleBranches: Buffer[]): Buffer {

        const bothMerkles = Buffer.alloc(64);

        bothMerkles.set(newRoot);

        for (let i = 0; i < merkleBranches.length; i++) {
            bothMerkles.set(merkleBranches[i], 32);
            newRoot = bitcoinjs.crypto.hash256(bothMerkles);
            bothMerkles.set(newRoot);
        }

        return bothMerkles.subarray(0, 32)
    }


    private createCoinbaseTransaction(addresses: AddressObject[], reward: number): bitcoinjs.Transaction {
        // Part 1
        const coinbaseTransaction = new bitcoinjs.Transaction();

        // Set the version of the transaction
        coinbaseTransaction.version = 2;

        // Add the coinbase input (input with no previous output)
        coinbaseTransaction.addInput(Buffer.alloc(32, 0), 0xffffffff, 0xffffffff);

        // Add an output
        let rewardBalance = reward;

        addresses.forEach(recipientAddress => {
            const amount = Math.floor((recipientAddress.percent / 100) * reward);
            rewardBalance -= amount;
            coinbaseTransaction.addOutput(this.getPaymentScript(recipientAddress.address), amount);
        })

        //Add any remaining sats from the Math.floor
        coinbaseTransaction.outs[0].value += rewardBalance;

        const segwitWitnessReservedValue = Buffer.alloc(32, 0);

        //and the coinbase's input's witness must consist of a single 32-byte array for the witness reserved value
        coinbaseTransaction.ins[0].witness = [segwitWitnessReservedValue];

        return coinbaseTransaction;
    }

    private getPaymentScript(address: string): Buffer {
        // bitcoinjs.address.toOutputScript handles P2PKH, P2SH, P2WPKH, P2WSH and P2TR.
        // It uses the bech32 HRP from `this.network`, so Elektron `be1q…` addresses are
        // accepted automatically when the elektronMainnet Network object is supplied.
        try {
            return bitcoinjs.address.toOutputScript(address, this.network);
        } catch (e) {
            console.warn(`Invalid payout address ${address}: ${e.message ?? e}`);
            return Buffer.alloc(0);
        }
    }

    public response(jobTemplate: IJobTemplate): string {

        const job: IMiningNotify = {
            id: null,
            method: eResponseMethod.MINING_NOTIFY,
            params: [
                this.jobId,
                this.swapEndianWords(jobTemplate.block.prevHash).toString('hex'),
                this.coinbasePart1,
                this.coinbasePart2,
                jobTemplate.merkle_branch,
                jobTemplate.block.version.toString(16),
                jobTemplate.block.bits.toString(16),
                jobTemplate.block.timestamp.toString(16),
                jobTemplate.blockData.clearJobs
            ]
        };

        return JSON.stringify(job) + '\n';
    }


    private swapEndianWords(buffer: Buffer): Buffer {
        const swappedBuffer = Buffer.alloc(buffer.length);

        for (let i = 0; i < buffer.length; i += 4) {
            swappedBuffer[i] = buffer[i + 3];
            swappedBuffer[i + 1] = buffer[i + 2];
            swappedBuffer[i + 2] = buffer[i + 1];
            swappedBuffer[i + 3] = buffer[i];
        }

        return swappedBuffer;
    }


}
