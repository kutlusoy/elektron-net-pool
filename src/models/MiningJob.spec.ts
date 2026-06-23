import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as bitcoinjs from 'bitcoinjs-lib';
import { BehaviorSubject } from 'rxjs';

import { MockRecording1 } from '../../test/models/MockRecording1';
import { IMiningInfo } from './bitcoin-rpc/IMiningInfo';
import { IJobTemplate, StratumV1JobsService } from '../services/stratum-v1-jobs.service';
import { MiningJob } from './MiningJob';

describe('MiningJob', () => {
    let moduleRef: TestingModule;
    let configService: ConfigService;
    let jobTemplate: IJobTemplate;

    beforeAll(async () => {
        moduleRef = await Test.createTestingModule({
            providers: [
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn(() => null)
                    }
                }
            ],
        }).compile();
        configService = moduleRef.get<ConfigService>(ConfigService);
    });

    describe('block updates', () => {
        let job: MiningJob;

        beforeEach(async () => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date(parseInt(MockRecording1.TIME, 16) * 1000));
            configService.get = jest.fn(() => null);

            const miningInfo$ = new BehaviorSubject<IMiningInfo>({
                blocks: MockRecording1.BLOCK_TEMPLATE.height
            } as IMiningInfo);
            const bitcoinRpcService = {
                newBlock$: miningInfo$.asObservable(),
                getBlockTemplate: jest.fn().mockResolvedValue(MockRecording1.BLOCK_TEMPLATE)
            };
            jest.spyOn(console, 'log').mockImplementation(() => undefined);

            const jobsService = new StratumV1JobsService(bitcoinRpcService as any);
            jobTemplate = await jobsService.buildTemplateFor('tb1qumezefzdeqqwn5zfvgdrhxjzc5ylr39uhuxcz4');
            job = new MiningJob(
                configService,
                bitcoinjs.networks.testnet,
                '1',
                [{ address: 'tb1qumezefzdeqqwn5zfvgdrhxjzc5ylr39uhuxcz4', percent: 100 }],
                jobTemplate
            );
        });

        afterEach(() => {
            jest.restoreAllMocks();
            jest.useRealTimers();
        });

        it('should split coinbase around 8 bytes of extranonce space', () => {
            const notify = JSON.parse(job.response(jobTemplate));
            const coinb1 = notify.params[2];
            const coinb2 = notify.params[3];
            const extraNonce1 = '57a6f098';
            const extraNonce2 = 'c7080000';
            const coinbase = bitcoinjs.Transaction.fromHex(`${coinb1}${extraNonce1}${extraNonce2}${coinb2}`);

            expect(Buffer.byteLength(extraNonce1 + extraNonce2, 'hex')).toBe(8);
            expect(coinbase.ins[0].script.toString('hex')).toContain(`${extraNonce1}${extraNonce2}`);
        });

        it('should splice extranonce into coinbase scriptSig when assembling a block', () => {
            const extraNonce1 = '57a6f098';
            const extraNonce2 = 'c7080000';
            const updatedBlock = job.copyAndUpdateBlock(
                jobTemplate,
                parseInt('00002000', 16),
                parseInt('ed460d91', 16),
                extraNonce1,
                extraNonce2,
                parseInt(MockRecording1.TIME, 16)
            );

            expect(updatedBlock.nonce).toBe(parseInt('ed460d91', 16));
            expect(updatedBlock.version).toBe(jobTemplate.block.version ^ parseInt('00002000', 16));
            const scriptHex = updatedBlock.transactions[0].ins[0].script.toString('hex');
            expect(scriptHex.endsWith(`${extraNonce1}${extraNonce2}`)).toBe(true);
        });

        it('should leave block version unchanged without a version mask', () => {
            const updatedBlock = job.copyAndUpdateBlock(
                jobTemplate,
                0,
                parseInt('ed460d91', 16),
                '57a6f098',
                'c7080000',
                parseInt(MockRecording1.TIME, 16)
            );

            expect(updatedBlock.version).toBe(jobTemplate.block.version);
        });

        it('should build the same header as the full block update path', () => {
            const versionMask = parseInt('00002000', 16);
            const nonce = parseInt('ed460d91', 16);
            const extraNonce1 = '57a6f098';
            const extraNonce2 = 'c7080000';
            const timestamp = parseInt(MockRecording1.TIME, 16);

            const updatedBlock = job.copyAndUpdateBlock(
                jobTemplate,
                versionMask,
                nonce,
                extraNonce1,
                extraNonce2,
                timestamp
            );
            const fastHeader = job.buildHeaderBuffer(
                jobTemplate,
                versionMask,
                nonce,
                extraNonce1,
                extraNonce2,
                timestamp
            );

            expect(fastHeader.equals(updatedBlock.toBuffer(true))).toBe(true);
        });
    });
});
