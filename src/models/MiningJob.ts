import * as bitcoinjs from 'bitcoinjs-lib';

import { IJobTemplate } from '../services/stratum-v1-jobs.service';
import { eResponseMethod } from './enums/eResponseMethod';
import { IMiningNotify } from './stratum-messages/IMiningNotify';
import { ConfigService } from '@nestjs/config';
import { TOTAL_EXTRANONCE_SIZE_BYTES } from './stratum.constants';

const MAX_BLOCK_WEIGHT = 4000000;

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
        // Elektron Net consensus: coinbase nLockTime must equal height - 1.
        this.coinbaseTransaction.locktime = jobTemplate.blockData.height - 1;

        // scriptSig layout:  <BIP34 height push>  <extranonce hole>
        //                     ^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^
        //                     coinbase_script_     filled by miner
        //                     sig_prefix from      with extranonce1 +
        //                     GBT                  extranonce2
        // The hole is zero-padded at template time; the actual extranonce
        // bytes get spliced in by the worker per Stratum spec.
        let scriptSigPrefix: Buffer;
        if (jobTemplate.coinbase_script_sig_prefix && jobTemplate.coinbase_script_sig_prefix.length > 0) {
            scriptSigPrefix = jobTemplate.coinbase_script_sig_prefix;
        } else {
            const heightEncoded = bitcoinjs.script.number.encode(jobTemplate.blockData.height);
            const heightLengthByte = Buffer.from([heightEncoded.length]);
            scriptSigPrefix = Buffer.concat([heightLengthByte, heightEncoded]);
        }

        const extranoncePlaceholder = Buffer.alloc(TOTAL_EXTRANONCE_SIZE_BYTES, 0);
        this.coinbaseTransaction.ins[0].script = Buffer.concat([scriptSigPrefix, extranoncePlaceholder]);

        // Outputs:
        //   vout[0]  payout
        //   vout[1]  required_outputs[0]  (UTXO attestation OP_RETURN)
        //   vout[2]  required_outputs[1]  (witness commitment OP_RETURN)
        // Order MUST match the array order from GBT — the node uses content
        // matching to identify the attestation but Merkle reconstruction
        // depends on a stable layout.
        const requiredOutputs = jobTemplate.coinbase_required_outputs ?? [];
        if (requiredOutputs.length > 0) {
            for (const out of requiredOutputs) {
                this.coinbaseTransaction.addOutput(out.scriptPubKey, out.value);
            }
        } else if (jobTemplate.block.witnessCommit) {
            const segwitMagic = Buffer.from('aa21a9ed', 'hex');
            this.coinbaseTransaction.addOutput(
                bitcoinjs.script.compile([bitcoinjs.opcodes.OP_RETURN, Buffer.concat([segwitMagic, jobTemplate.block.witnessCommit])]),
                0,
            );
        }

        if ((this.coinbaseTransaction.weight() + jobTemplate.block.weight()) > MAX_BLOCK_WEIGHT) {
            throw new Error('Block weight exceeds the maximum allowed weight');
        }

        // Split serialized coinbase around the extranonce hole so the miner's
        // bytes land exactly in scriptSig:
        //
        //   coinb1 = serialized prefix up to (and including) <BIP34 height push>
        //   <extranonce1 + extranonce2>                       (filled by miner)
        //   coinb2 = rest of scriptSig + sequence + outputs + locktime
        //
        // Find the placeholder position in the serialized non-witness tx.
        // @ts-ignore — bitcoinjs's __toBuffer skips witness serialization, which
        // is what we want here (txid is computed over non-witness bytes).
        const serializedCoinbaseTx: string = this.coinbaseTransaction.__toBuffer().toString('hex');
        const fullScriptHex = this.coinbaseTransaction.ins[0].script.toString('hex');
        const scriptStart = serializedCoinbaseTx.indexOf(fullScriptHex);
        if (scriptStart < 0) {
            throw new Error('Failed to locate coinbase scriptSig in serialized tx');
        }
        // Where the extranonce hole begins inside the serialized tx.
        const holeStart = scriptStart + scriptSigPrefix.length * 2;
        const holeEnd = holeStart + TOTAL_EXTRANONCE_SIZE_BYTES * 2;

        this.coinbasePart1 = serializedCoinbaseTx.slice(0, holeStart);
        this.coinbasePart2 = serializedCoinbaseTx.slice(holeEnd);
        this.coinbasePart1Buffer = Buffer.from(this.coinbasePart1, 'hex');
        this.coinbasePart2Buffer = Buffer.from(this.coinbasePart2, 'hex');
    }

    public cloneCoinbaseTransaction(): bitcoinjs.Transaction {
        return bitcoinjs.Transaction.fromBuffer(this.coinbaseTransaction.toBuffer());
    }

    public buildHeaderBuffer(jobTemplate: IJobTemplate, versionMask: number, nonce: number, extraNonce: string, extraNonce2: string, timestamp: number): Buffer {
        // Hash the EXACT bytes the miner used: coinb1 + extranonce1 + extranonce2 + coinb2.
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

        // Splice the miner's extranonce bytes into the coinbase scriptSig
        // exactly where the placeholder was. Result is the canonical, valid
        // coinbase the miner POW'd against — this is what we submit.
        const coinbase = this.cloneCoinbaseTransaction();
        const placeholderScript = coinbase.ins[0].script;
        const replacedScriptHex =
            placeholderScript
                .toString('hex')
                .slice(0, placeholderScript.length * 2 - TOTAL_EXTRANONCE_SIZE_BYTES * 2)
            + extraNonce + extraNonce2;
        coinbase.ins[0].script = Buffer.from(replacedScriptHex, 'hex');
        testBlock.transactions[0] = coinbase;

        testBlock.nonce = nonce;
        if (versionMask !== undefined && versionMask != 0) {
            testBlock.version = (testBlock.version ^ versionMask);
        }

        testBlock.merkleRoot = this.calculateMerkleRootHash(coinbase.getHash(false), this.merkleBranchBuffers);
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
        const coinbaseTransaction = new bitcoinjs.Transaction();
        coinbaseTransaction.version = 2;
        coinbaseTransaction.addInput(Buffer.alloc(32, 0), 0xffffffff, 0xfffffffe);

        let rewardBalance = reward;
        addresses.forEach(recipientAddress => {
            const amount = Math.floor((recipientAddress.percent / 100) * reward);
            rewardBalance -= amount;
            coinbaseTransaction.addOutput(this.getPaymentScript(recipientAddress.address), amount);
        });
        coinbaseTransaction.outs[0].value += rewardBalance;

        // BIP141 reserved witness value (32 zero bytes) on the coinbase input.
        coinbaseTransaction.ins[0].witness = [Buffer.alloc(32, 0)];

        return coinbaseTransaction;
    }

    private getPaymentScript(address: string): Buffer {
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
