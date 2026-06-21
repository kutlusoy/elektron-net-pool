import * as bitcoinjs from 'bitcoinjs-lib';

import { IJobTemplate } from '../services/stratum-v1-jobs.service';
import { eResponseMethod } from './enums/eResponseMethod';
import { IMiningNotify } from './stratum-messages/IMiningNotify';
import { ConfigService } from '@nestjs/config';

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
        // Elektron Net consensus: coinbase nLockTime must equal height - 1 (see
        // doc-elektron/mining-pool-integration.md §9 and src/node/miner.cpp:198).
        this.coinbaseTransaction.locktime = jobTemplate.blockData.height - 1;

        // Elektron Net: the UTXO attestation in the GBT template is bound to a
        // coinbase whose scriptSig is exactly the node-supplied prefix (BIP34
        // height push). Any extra bytes — pool identifier, extranonce padding
        // — would change the coinbase txid and break the attestation. So this
        // is the FULL scriptSig; workers vary only header bits.
        let blockHeightPrefix: Buffer;
        if (jobTemplate.coinbase_script_sig_prefix && jobTemplate.coinbase_script_sig_prefix.length > 0) {
            blockHeightPrefix = jobTemplate.coinbase_script_sig_prefix;
        } else {
            const blockHeightEncoded = bitcoinjs.script.number.encode(jobTemplate.blockData.height);
            const blockHeightLengthByte = Buffer.from([blockHeightEncoded.length]);
            blockHeightPrefix = Buffer.concat([blockHeightLengthByte, blockHeightEncoded]);
        }

        this.coinbaseTransaction.ins[0].script = blockHeightPrefix;

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
            throw new Error('Block weight exceeds the maximum allowed weight');
        }

        // Coinbase is not split (extranonce size = 0); the entire serialized
        // tx is sent as coinb1 with an empty coinb2 so the miner can't insert
        // bytes that would shift the txid.
        //@ts-ignore
        this.coinbasePart1 = this.coinbaseTransaction.__toBuffer().toString('hex');
        this.coinbasePart2 = '';
        this.coinbasePart1Buffer = Buffer.from(this.coinbasePart1, 'hex');
        this.coinbasePart2Buffer = Buffer.alloc(0);
    }

    public cloneCoinbaseTransaction(): bitcoinjs.Transaction {
        return bitcoinjs.Transaction.fromBuffer(this.coinbaseTransaction.toBuffer());
    }

    public buildHeaderBuffer(jobTemplate: IJobTemplate, versionMask: number, nonce: number, _extraNonce: string, _extraNonce2: string, timestamp: number): Buffer {
        // Coinbase is fixed (no extranonce); just hash coinbasePart1Buffer directly.
        const coinbaseHash = bitcoinjs.crypto.hash256(this.coinbasePart1Buffer);
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

    public copyAndUpdateBlock(jobTemplate: IJobTemplate, versionMask: number, nonce: number, _extraNonce: string, _extraNonce2: string, timestamp: number): bitcoinjs.Block {

        const testBlock = Object.assign(new bitcoinjs.Block(), jobTemplate.block);
        testBlock.transactions = jobTemplate.block.transactions.map(tx => {
            return Object.assign(new bitcoinjs.Transaction(), tx);
        });

        // Coinbase is taken verbatim — no scriptSig mutation. Merkle root only
        // needs recomputation because the placeholder coinbase from the template
        // had a different shape; the actual coinbase here is our payout one.
        testBlock.transactions[0] = this.cloneCoinbaseTransaction();

        testBlock.nonce = nonce;

        if (versionMask !== undefined && versionMask != 0) {
            testBlock.version = (testBlock.version ^ versionMask);
        }

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
