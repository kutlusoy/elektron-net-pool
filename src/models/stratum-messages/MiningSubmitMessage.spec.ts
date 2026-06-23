import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MiningSubmitMessage } from './MiningSubmitMessage';

describe('MiningSubmitMessage', () => {

    describe('test message parsing', () => {

        // With EXTRANONCE2_SIZE_BYTES = 0 the worker contributes nothing to
        // the coinbase. Anything the firmware sends in this slot is
        // normalised to "" so the validator accepts it.
        const MINING_SUBMIT_MESSAGE = ' {"id": 5, "method": "mining.submit", "params": ["tb1qumezefzdeqqwn5zfvgdrhxjzc5ylr39uhuxcz4.bitaxe3", "1", "", "64b1f10f", "2402812d", "00006000"]}'

        const message = plainToInstance(
            MiningSubmitMessage,
            JSON.parse(MINING_SUBMIT_MESSAGE),
        );

        it('should parse message', () => {
            expect(message.id).toEqual(5);
            expect(message.userId).toEqual('tb1qumezefzdeqqwn5zfvgdrhxjzc5ylr39uhuxcz4.bitaxe3');
            expect(message.jobId).toEqual('1');
            expect(message.extraNonce2).toEqual('');
            expect(message.ntime).toEqual('64b1f10f');
            expect(message.nonce).toEqual('2402812d');
            expect(message.versionMask).toEqual('00006000');
        });

        it('should validate empty extranonce2 submissions', async () => {
            const errors = await validate(message);
            expect(errors).toEqual([]);
        });

        it('should normalise any firmware-supplied extranonce2 to empty', async () => {
            const submissionWithExtra = plainToInstance(
                MiningSubmitMessage,
                JSON.parse(' {"id": 5, "method": "mining.submit", "params": ["tb1qumezefzdeqqwn5zfvgdrhxjzc5ylr39uhuxcz4.bitaxe3", "1", "99020000", "64b1f10f", "2402812d", "00006000"]}'),
            );

            expect(submissionWithExtra.extraNonce2).toEqual('');
            const errors = await validate(submissionWithExtra);
            expect(errors).toEqual([]);
        });
    });


});
