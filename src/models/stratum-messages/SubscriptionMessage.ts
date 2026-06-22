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
        // Header-only mining (Elektron Net): the coinbase must be sent through
        // unchanged for the per-block UTXO attestation to validate, so we set
        // `extranonce2_size = 0`. But mainstream ASIC firmware (Bitaxe
        // ESP-Miner, NerdMiner, BraiinsOS, stock Bitmain) rejects a subscribe
        // response with an EMPTY extranonce1 and closes the socket — see
        // stratum.constants.ts for the long version. We therefore send the
        // per-connection session id (= clientId) as extranonce1; with
        // extranonce2_size = 0 the firmware is expected to keep it as a
        // session tag and not splice it into the coinbase.
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
