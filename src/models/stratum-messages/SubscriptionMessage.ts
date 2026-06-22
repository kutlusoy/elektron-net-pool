import { Expose, Transform } from 'class-transformer';
import { IsArray, IsString, MaxLength } from 'class-validator';

import { eRequestMethod } from '../enums/eRequestMethod';
import { EXTRANONCE1_SIZE_BYTES, EXTRANONCE2_SIZE_BYTES } from '../stratum.constants';
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
        // Header-only mining (Elektron Net): the coinbase must be sent through
        // unchanged for the UTXO attestation to validate. We therefore set
        // `extranonce2_size = 0` so miners do not iterate any bytes into the
        // coinbase scriptSig.
        //
        // We DO send a non-empty `extranonce1` (the per-connection session id)
        // because many ASIC firmwares (Bitaxe ESP-Miner, NerdMiner, BraiinsOS,
        // stock Bitmain) reject a subscribe response with an empty extranonce1
        // — they fail JSON validation client-side and close the TCP socket
        // immediately, leading to a 1–2 Hz reconnect loop. With size_2 = 0 the
        // miner builds the coinbase as `coinb1 + extranonce1 + coinb2`. The
        // pool's `MiningJob` therefore splits the serialized coinbase around
        // a length-SESSION_ID_SIZE_BYTES hole that gets filled by extranonce1
        // (see MiningJob.ts).
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
        // return userAgent;
        userAgent = userAgent.split(' ')[0].split('/')[0].split('V')[0].split('-')[0];

        if (userAgent.includes('bosminer') || userAgent.includes('bOS')) {
            userAgent = 'Braiins OS';
        } else if (userAgent.includes('cpuminer')) {
            userAgent = 'cpuminer';
        }
        return userAgent;
    }
}
