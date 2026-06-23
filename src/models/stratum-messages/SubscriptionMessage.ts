import { Expose, Transform } from 'class-transformer';
import { IsArray, IsString, MaxLength } from 'class-validator';

import { eRequestMethod } from '../enums/eRequestMethod';
import { EXTRANONCE2_SIZE_BYTES } from '../stratum.constants';
import { StratumBaseMessage } from './StratumBaseMessage';

export class SubscriptionMessage extends StratumBaseMessage {


    @IsArray()
    params: string[];

    @Expose()
    @IsString()
    @MaxLength(128)
    @Transform(({ value, key, obj, type }) => {
        return obj?.params?.[0] == null ? 'unknown' : SubscriptionMessage.refineUserAgent(obj.params[0]);
    })
    public userAgent: string;

    constructor() {
        super();
        this.method = eRequestMethod.SUBSCRIBE;
    }

    public response(clientId: string) {
        // miner.py-equivalent Stratum wiring: EXTRANONCE2_SIZE_BYTES = 0 so the
        // worker iterates nothing and cannot splice anything into the coinbase.
        // `clientId` is the mining.notify channel tag — kept stable across
        // `mining.set_difficulty` updates — AND is reused as the extranonce1
        // slot on the wire. It must be a non-empty hex string or hobby-miner
        // firmwares (NerdMiner, Bitaxe, ESP-Miner) reject the subscribe reply
        // and disconnect. The coinbase the pool actually submits is built from
        // `coinbase_script_sig_prefix` verbatim (see MiningJob.ts) and never
        // includes this value, so UTXO attestation is unaffected.
        return {
            id: this.id,
            error: null,
            result: [
                [
                    ['mining.notify', clientId]
                ],
                clientId,
                EXTRANONCE2_SIZE_BYTES
            ]
        }


    }

    public static refineUserAgent(userAgent: string): string {
        userAgent = userAgent.split(' ')[0].split('/')[0].split('V')[0].split('-')[0];

        if (userAgent.includes('bosminer') || userAgent.includes('bOS')) {
            userAgent = 'Braiins OS';
        } else if (userAgent.includes('cpuminer')) {
            userAgent = 'cpuminer';
        }
        return userAgent;
    }
}
