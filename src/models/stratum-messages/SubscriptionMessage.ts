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
        // Standard Stratum v1 subscribe response: `clientId` is the per-
        // connection extranonce1 (also the mining.notify channel tag), and
        // `extranonce2_size` tells the worker how many bytes it generates
        // and iterates inside the coinbase scriptSig.
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
