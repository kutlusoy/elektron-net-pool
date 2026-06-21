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

        it('should send the full coinbase as coinb1 with an empty coinb2', () => {
            // Header-only mining: extranonce size is 0, so the entire coinbase
            // serialization lives in coinb1 and coinb2 is empty.
            const notify = JSON.parse(job.response(jobTemplate));
            const coinbasePart1 = notify.params[2];
            const coinbasePart2 = notify.params[3];

            expect(coinbasePart2).toBe('');
            const coinbase = bitcoinjs.Transaction.fromHex(coinbasePart1);
            expect(coinbase.ins.length).toBe(1);
            // scriptSig is just the BIP34 height push from the template
            expect(coinbase.ins[0].script.length).toBeGreaterThan(0);
        });

        it('should ignore extranonce arguments when updating the block', () => {
            const originalCoinbase = job.cloneCoinbaseTransaction();
            const updatedBlock = job.copyAndUpdateBlock(
                jobTemplate,
                parseInt('00002000', 16),
                parseInt('ed460d91', 16),
                'deadbeef',
                'cafebabe00000000',
                parseInt(MockRecording1.TIME, 16)
            );

            expect(updatedBlock.nonce).toBe(parseInt('ed460d91', 16));
            expect(updatedBlock.version).toBe(jobTemplate.block.version ^ parseInt('00002000', 16));
            // Coinbase scriptSig is unchanged — extranonce args are no-ops.
            expect(updatedBlock.transactions[0].ins[0].script.equals(originalCoinbase.ins[0].script)).toBe(true);
        });

        it('should leave block version unchanged without a version mask', () => {
            const updatedBlock = job.copyAndUpdateBlock(
                jobTemplate,
                0,
                parseInt('ed460d91', 16),
                '',
                '',
                parseInt(MockRecording1.TIME, 16)
            );

            expect(updatedBlock.version).toBe(jobTemplate.block.version);
        });

        it('should build the same header as the full block update path', () => {
            const versionMask = parseInt('00002000', 16);
            const nonce = parseInt('ed460d91', 16);
            const timestamp = parseInt(MockRecording1.TIME, 16);

            const updatedBlock = job.copyAndUpdateBlock(
                jobTemplate,
                versionMask,
                nonce,
                '',
                '',
                timestamp
            );
            const fastHeader = job.buildHeaderBuffer(
                jobTemplate,
                versionMask,
                nonce,
                '',
                '',
                timestamp
            );

            expect(fastHeader.equals(updatedBlock.toBuffer(true))).toBe(true);
        });
    });
});
