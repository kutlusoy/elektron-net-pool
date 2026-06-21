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
        // Header-only mining (Elektron Net): we keep `clientId` as the session
        // tag but it is NOT used as extranonce1 — coinbase is sent through
        // unchanged. `extranonce1` is emitted as an empty hex string and
        // `extranonce2_size` is 0 so miners don't try to extend the coinbase.
        return {
            id: this.id,
            error: null,
            result: [
                [
                    ['mining.notify', clientId]
                ],
                EXTRANONCE1_SIZE_BYTES === 0 ? '' : clientId,
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
