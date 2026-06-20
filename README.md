## Description

A NestJS and TypeScript Stratum V1 mining pool server for **Elektron Net**
(a Bitcoin Core C++20 fork with mandatory pruning, per-block UTXO attestation
and 60 s block time — see `doc-elektron/BITCOIN_CORE_DIFF.md` and
`doc-elektron/mining-pool-integration.md` in the elektron-net repo).

This fork derives from `public-pool`. The Elektron-specific changes are:

- Reads `coinbase_required_outputs` from `getblocktemplate` and appends them
  verbatim to the coinbase (UTXO attestation + witness commitment, in that order).
- Honours `coinbase_script_sig_prefix` when supplied by the node.
- Accepts Bech32 addresses with the Elektron HRP `be` (`be1q…`) via
  `bitcoinjs.address.toOutputScript`.
- Template refresh tightened to 30 s (Elektron block target is 60 s).

Requires an **Elektron Net node v4.0+** (protocol version 70017) as the RPC backend.

## Installation

```bash
$ npm install
```

Create a new `.env` file in the root directory and configure it with the
parameters in `.env.example`.

## Running the app

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production build
$ npm run build
```

## Test

```bash
# unit tests
$ npm run test

# test coverage
$ npm run test:cov
```

## Web interface

See [elektron-net-pool-ui](https://github.com/kutlusoy/elektron-net-pool-ui).

## Deployment

Install pm2 (https://pm2.keymetrics.io/)

```bash
$ pm2 start dist/main.js
```

When running the worker app in PM2 cluster mode, start the PM2 daemon with OS-level
connection scheduling. The environment variable must be present when the PM2 daemon
starts, not only in the worker configuration.

```bash
$ NODE_CLUSTER_SCHED_POLICY=none pm2 start ecosystem.config.js
```

Cluster-mode connection dropping requires Node.js `22.12.0` or newer.

`STRATUM_MAX_CONNECTIONS_PER_LISTENER` is enforced per worker and Stratum port.
Size it using the busiest port: `worker count * limit`. For example, 28 workers
with the default limit of `10000` allow up to `280000` connections on one port.

## Docker

Build container:

```bash
$ docker build -t elektron-pool .
```

Run container:

```bash
$ docker container run --name elektron-pool --rm -p 3333:3333 -p 3334:3334 -p 8332:8332 -v .env:/elektron-pool/.env elektron-pool
```

### Docker Compose

Build container:
```bash
$ docker compose build
```

Run container:
```bash
$ docker compose up -d
```

The docker-compose binds to `127.0.0.1` by default. To expose the Stratum services on your server change:
```diff
    ports:
-      - "127.0.0.1:3333:3333/tcp"
-      - "127.0.0.1:3334:3334/tcp"
+      - "3333"
+      - "3334"
```

**note**: To successfully connect to the Elektron RPC you will need to add

```
rpcallowip=172.16.0.0/12
```

to your `elektron.conf`.

## Migrating from a Bitcoin pool

The `ELEKTRON_RPC_*` env vars are preferred; the legacy `BITCOIN_RPC_*` names
still work as a fallback to ease migration. See `.env.example` for the full
list.

The `NETWORK` setting defaults to `mainnet` (Elektron mainnet, HRP `be`). For
testing against an upstream Bitcoin Core node, set `NETWORK=bitcoin-mainnet`,
`bitcoin-testnet` or `bitcoin-regtest`.
