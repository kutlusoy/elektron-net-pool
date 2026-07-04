## Description

A NestJS and TypeScript Stratum V1 mining pool server for **Elektron Net**
(a Bitcoin Core C++20 fork with mandatory pruning, per-block UTXO attestation
and 60 s block time — see `doc-elektron/BITCOIN_CORE_DIFF.md` and
`doc-elektron/mining-pool-integration.md` in the elektron-net repo).

This fork derives from `public-pool`. The Elektron-specific changes are:

- Reads `coinbase_required_outputs` from `getblocktemplate` and appends them
  verbatim to the coinbase (UTXO attestation + witness commitment, in that
  order).
- Honours `coinbase_script_sig_prefix` when supplied by the node.
- Accepts Bech32 addresses with the Elektron HRP `be` (`be1q…`) via
  `bitcoinjs.address.toOutputScript`.
- Sets coinbase `nLockTime = height - 1` as required by consensus.
- **Per-miner block templates.** The Elektron node computes the UTXO
  attestation hash against the template's coinbase, including the payout
  output. The pool therefore calls `getblocktemplate` separately for each
  connected miner, passing the miner's payout address in the
  `coinbaseaddress` parameter. Templates cannot be shared across miners as
  in plain Bitcoin pools — a mismatch would be rejected as
  `bad-utxo-attestation`. Each client refreshes its template on every new
  block plus a 30 s safety timer.
- **No dev/pool fee in the coinbase.** A second coinbase output would
  change the bytes the attestation hash was computed against, so 100 % of
  the block reward goes directly to the miner's authorized payout address.

Requires an **Elektron Net node v4.0+** (protocol version 70017) as the RPC
backend.

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

## Supported miners

See [`Miner_Compatibility_List.md`](./Miner_Compatibility_List.md) for the
full matrix of tested SHA-256d miners (industrial ASICs, hobby ASICs,
CPU/GPU clients) with per-miner status and the reason behind any
incompatibility. Short version: anything running stock cgminer-derived
firmware — Antminer, Whatsminer, Avalon, Canaan, Innosilicon, Bitaxe
(ESP-Miner), cpuminer, bfgminer, sgminer — works in NORMAL mode out of
the box. NerdMiner_v2 and its forks (NerdAxe, NerdQAxe) stay connected
in HOBBY mode but cannot earn rewards: their firmware hardcodes a
coinbase extranonce splice that Elektron's per-block UTXO attestation
rejects.

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

### Sizing for Elektron Net

Because each connected miner triggers its own `getblocktemplate` call on the
Elektron node (per new block + every 30 s), the practical connection ceiling
is bound by your node's RPC throughput, **not** raw socket capacity. The
`STRATUM_MAX_CONNECTIONS_PER_LISTENER` cap (default `10000`) is enforced per
worker and Stratum port, but you should set it well below that to match
your node — start with `50`–`100` and scale once you've measured RPC load.
The built-in backpressure monitor (`STRATUM_BACKPRESSURE_*`) also pauses
accepts when the event loop or RSS goes red.

## Docker

### 0. Installing Docker itself

Skip to [step 1](#1-clone-the-repo-and-create-your-env) if Docker is already
installed and `docker version` / `docker compose version` both print a
**Server**/daemon section (not just a client version) — that's the part
missing if you hit `Cannot connect to the Docker daemon` or
`open Dockerfile: no such file or directory` immediately followed by
`pull access denied`.

**Linux (Ubuntu/Debian) — Docker Engine + Compose plugin:**
```bash
# 1. Remove any old/conflicting packages (safe to skip if none installed)
sudo apt-get remove docker docker-engine docker.io containerd runc 2>/dev/null

# 2. Install via the official convenience script (simplest, always current)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 3. Let your user run docker without sudo (log out and back in — or `newgrp docker` — afterwards)
sudo usermod -aG docker $USER
newgrp docker

# 4. Make the daemon start on every boot AND start it now (PERMANENT — survives reboot)
sudo systemctl enable --now docker

# 5. Verify
docker version
docker compose version
docker run hello-world
```
Other distros: see the [official install docs](https://docs.docker.com/engine/install/)
for `dnf`/`pacman`/etc. equivalents — `systemctl enable --now docker` is the
same everywhere systemd is used.

**Windows — Docker Desktop:**
1. Enable WSL2 first (from an **elevated** PowerShell): `wsl --install`, then reboot if prompted.
2. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), default options (WSL2 backend, not Hyper-V).
3. Start Docker Desktop once manually, then open **Settings → General** and enable
   **"Start Docker Desktop when you sign in"** — this is what makes it
   **PERMANENT** across reboots; without it, `docker compose up -d`'s
   `restart: unless-stopped` (see step 4 below) has nothing to restart into
   after a reboot until you open Docker Desktop by hand again.
4. Verify from **PowerShell**:
   ```powershell
   docker version
   docker compose version
   docker run hello-world
   ```

**macOS — Docker Desktop:** same as Windows (install, enable "Start Docker
Desktop when you log in" in Settings), commands run identically to the
Linux/bash examples below in any Terminal.

### 1. Clone the repo and create your `.env`

**All `docker`/`docker compose` commands below must be run from inside the
cloned repository** (the directory containing `Dockerfile` and
`docker-compose.yml`). Running them from your home directory or anywhere
else is the #1 cause of `open Dockerfile: no such file or directory` and the
follow-on `pull access denied for elektron-pool` (that second error just
means the build never produced a local image, so Docker fell back to trying
— and failing — to pull a public image of that name from Docker Hub).

**Linux / macOS (bash):**
```bash
git clone https://github.com/kutlusoy/elektron-net-pool.git
cd elektron-net-pool
cp .env.example .env
```

**Windows (PowerShell):**
```powershell
git clone https://github.com/kutlusoy/elektron-net-pool.git
cd elektron-net-pool
Copy-Item .env.example .env
```

Now edit `.env` (any text editor) and fill in at least `ELEKTRON_RPC_URL`
and `ELEKTRON_RPC_USER`/`ELEKTRON_RPC_PASSWORD` (or `ELEKTRON_RPC_COOKIEFILE`).
Unlike the PPLNS pool, this solo pool never holds miner funds — each miner's
coinbase pays their own address directly — so there is no pool wallet to
configure here at all. See the [cheat sheet](#6-cheat-sheet-all-settings-at-a-glance)
below for a one-table summary of every setting mentioned on this page.

**If your Elektron node is *not* in Docker** (e.g. `elektrond`/`elektron-qt`
installed natively on the same Windows/Linux/macOS machine, outside any
container) — `ELEKTRON_RPC_URL=http://127.0.0.1` or `localhost` in `.env`
will **not** work. Inside the container, `127.0.0.1` means the container
itself, not your host machine, so the pool would be trying to reach an
Elektron node running inside its own container (there is none).

```
ELEKTRON_RPC_URL=http://host.docker.internal
```

`docker-compose.yml` already includes `extra_hosts:
"host.docker.internal:host-gateway"`, which makes this hostname resolve on
every OS, including Linux (where Docker doesn't provide it out of the box —
it's otherwise a Docker Desktop–only convenience name). If you're using the
raw `docker run` form from step 3 instead of Compose, add the same thing
manually: `docker run --add-host=host.docker.internal:host-gateway ...`.

**Windows specifically:** Docker Desktop's `host.docker.internal` transparently
forwards to whatever your Windows host has bound on `127.0.0.1`, so a node
running with its default `rpcbind=127.0.0.1` needs no further change on the
node side — only `elektron.conf`'s `rpcallowip` needs to permit the
container (see the `rpcallowip=172.16.0.0/12` note further down; that CIDR
covers every subnet Docker Desktop typically assigns).

**Linux specifically:** `host-gateway` resolves to the real Docker bridge
interface IP, which is a genuinely different address from the host's own
`127.0.0.1` — a node bound only to `rpcbind=127.0.0.1` is **not** reachable
this way. Either add `rpcbind=0.0.0.0` (and rely on `rpcallowip` to restrict
who may actually connect) or bind explicitly to the Docker bridge address
(`ip addr show docker0`) in `elektron.conf`.

Either way, also confirm the node's RPC port itself isn't blocked by the
host firewall for connections originating from Docker's bridge network
(same `ufw`/`New-NetFirewallRule` mechanism as [step 5.2](#52-host-firewall--this-is-required-in-addition-to-51-not-instead-of-it),
just scoped to the Docker subnet instead of the whole internet).

### 2. Docker Compose (recommended)

Compose resolves the `./.env` and `./${NETWORK}-DB` paths in
`docker-compose.yml` relative to the compose file itself, so it works
identically on Linux, macOS, and Windows (PowerShell or WSL2 terminal)
without any path juggling — prefer this over the raw `docker build`/`docker
run` commands in step 3 unless you have a specific reason not to.

```bash
docker compose build
docker compose up -d
```

View logs:
```bash
docker compose logs -f
```

Open a shell **inside the running container** (for debugging — e.g. to
check `cat DB/*.sqlite` exists, or `env | grep ELEKTRON`):
```bash
docker compose exec elektron-pool sh
```

Restart after editing `.env` (env changes are not picked up by a running
container automatically):
```bash
docker compose up -d --force-recreate
```

Stop (containers removed, volumes/DB kept):
```bash
docker compose down
```

The compose file binds Stratum/API to `127.0.0.1` by default (not reachable
from other machines) and already sets `restart: unless-stopped` — see
[step 4](#4-permanent--survives-reboot-settings) for what that does and does
not cover. See [step 5](#5-exposing-the-pool-to-the-internet) before opening
these ports to the internet.

### 3. Raw `docker build`/`docker run` (alternative)

Only needed if you're not using Compose. The bind-mount syntax for `.env`
differs by shell — this is the other common failure point, since a bare
`.env` relative path is not resolved the same way by `docker run` on every
platform.

Build (same command on every OS, run from the repo root):
```bash
docker build -t elektron-pool .
```

Run — **Linux / macOS (bash):**
```bash
docker container run --name elektron-pool -d --restart unless-stopped \
  -p 3333:3333 -p 3334:3334 \
  -v "$(pwd)/.env:/elektron-pool/.env" \
  -v "$(pwd)/DB:/elektron-pool/DB" \
  elektron-pool
```

Run — **Windows (PowerShell):**
```powershell
docker container run --name elektron-pool -d --restart unless-stopped `
  -p 3333:3333 -p 3334:3334 `
  -v "${PWD}/.env:/elektron-pool/.env" `
  -v "${PWD}/DB:/elektron-pool/DB" `
  elektron-pool
```

`-d --restart unless-stopped` runs it detached and (once Docker itself is
running — see step 0/4) brings it back automatically after a host reboot,
matching what Compose does by default. Use `--rm` instead only for a
throwaway foreground test run (`docker container run --rm -it ...`, drop
`-d`), since `--rm` and `--restart` are mutually exclusive.

Logs / shell for this form:
```bash
docker logs -f elektron-pool
docker exec -it elektron-pool sh
```

The `8332` RPC port from older instructions is intentionally omitted: the
pool is an RPC *client* to your Elektron node, not an RPC server itself, so
there is nothing listening on 8332 inside this container to publish.

**note**: To successfully connect to the Elektron RPC you will need to add

```
rpcallowip=172.16.0.0/12
```

to your `elektron.conf`.

### 4. Permanent / survives-reboot settings

Three independent things all need to be "on" for the pool to come back by
itself after the host machine reboots — missing any one of them is the
usual cause of "it was running yesterday, now it's gone":

| # | What | Linux | Windows / macOS (Docker Desktop) |
|---|------|-------|-----------------------------------|
| 1 | Docker daemon starts on boot | `sudo systemctl enable --now docker` (step 0) | Settings → General → "Start Docker Desktop when you sign in" (step 0) |
| 2 | This container restarts once the daemon is up | `restart: unless-stopped` in `docker-compose.yml` (already set) or `--restart unless-stopped` on `docker run` (step 3) | same |
| 3 | Your `.env` and `DB/` folder are not deleted between runs | Don't `docker compose down -v` (the `-v` deletes volumes) — plain `down`/`up -d` preserves the bind-mounted `.env`/`DB` since they live on your host filesystem, not in a Docker-managed volume | same |

`restart` policy values, for reference (set in `docker-compose.yml`'s
`restart:` key or via `docker update --restart <value> elektron-pool`):

| Value | Restarts after crash? | Restarts after reboot (once Docker is up)? | Restarts after `docker stop`? |
|-------|:---:|:---:|:---:|
| `no` (default if unset) | No | No | No |
| `on-failure` | Only on non-zero exit | No | No |
| `unless-stopped` (**used here**) | Yes | Yes | No (stays stopped until you start it) |
| `always` | Yes | Yes | Yes (even restarts after an explicit `docker stop`, on next daemon start) |

### 5. Exposing the pool to the internet

By default **nothing here is internet-reachable** — Compose binds to
`127.0.0.1` and a plain `docker run` without `-p` publishes nothing. Two
different ports have two different exposure needs:

| Port | Env var | Must miners reach it from the internet? | Notes |
|------|---------|:---:|-------|
| `3333` (Stratum) | `STRATUM_PORT` | **Yes** — this is the whole point of a public pool | TCP only, no built-in TLS (see below) |
| `3334` (API) | `API_PORT` | Only if you want `elektron-net-pool-ui` or remote dashboards to reach it directly | Put behind a reverse proxy for HTTPS in production (see below) |
| Elektron RPC (`ELEKTRON_RPC_PORT`) | — | **Never** | Not published by this container at all (see step 3's note on port 8332) — keep it off any public interface on the node too |

#### 5.1 Docker-side: change the bind address

Compose (`docker-compose.yml`):
```diff
    ports:
-      - "127.0.0.1:${STRATUM_PORT}:${STRATUM_PORT}/tcp"
-      - "127.0.0.1:${API_PORT}:${API_PORT}/tcp"
+      - "${STRATUM_PORT}:${STRATUM_PORT}/tcp"
+      - "${API_PORT}:${API_PORT}/tcp"
```
then `docker compose up -d --force-recreate` to apply.

Raw `docker run`: just drop the `127.0.0.1:` prefix from `-p` in step 3
(`-p 3333:3333` already binds all interfaces — the examples above already do
this; only Compose defaults to loopback-only).

#### 5.2 Host firewall — this is required in addition to 5.1, not instead of it

**Linux (`ufw`):**
```bash
sudo ufw allow 3333/tcp comment 'Elektron Pool Stratum'
sudo ufw allow 3334/tcp comment 'Elektron Pool API'   # only if exposing the API too
sudo ufw reload
```
(`firewalld` equivalent: `sudo firewall-cmd --permanent --add-port=3333/tcp && sudo firewall-cmd --reload`.)

**Windows (PowerShell, run as Administrator) — permanent, survives reboot:**
```powershell
New-NetFirewallRule -DisplayName "Elektron Pool Stratum" -Direction Inbound -Protocol TCP -LocalPort 3333 -Action Allow
New-NetFirewallRule -DisplayName "Elektron Pool API" -Direction Inbound -Protocol TCP -LocalPort 3334 -Action Allow
```

**Cloud VM (AWS/GCP/Azure/Hetzner/etc.):** additionally open the same ports
in that provider's security-group / firewall console — the host-level rules
above only control the OS firewall, not the cloud provider's separate
network-layer filtering in front of it.

**Home network / behind a router (NAT):** forward the same ports to the
machine's LAN IP in your router's port-forwarding settings, in addition to
5.1 and 5.2 — three layers (Docker bind, host firewall, router) all have to
allow the connection through.

#### 5.3 TLS

- `API_SECURE=true` in `.env` (plus `secrets/key.pem`/`secrets/cert.pem`
  mounted into the container at `/elektron-pool/secrets/`) turns on **HTTPS
  for the API port only** — this is the one TLS mode built into the app
  itself (`src/main.ts`).
- There is **no built-in TLS for the Stratum port**. `elektron-net-pool-ui`'s
  `SECURE_STRATUM_URL` config (default port `4333`) assumes an external
  TLS-terminating proxy in front of plain-TCP `3333` — this pool does not
  listen on `4333` itself. A minimal example with `stunnel` (config file,
  run alongside the container, not inside it):
  ```
  ; /etc/stunnel/elektron-pool.conf
  [elektron-stratum-tls]
  accept = 4333
  connect = 127.0.0.1:3333
  cert = /etc/stunnel/cert.pem
  key = /etc/stunnel/key.pem
  ```
  then open `4333` the same way as `3333` in steps 5.1/5.2. For the API,
  prefer a reverse proxy (Caddy or nginx) in front of `3334` instead of
  `API_SECURE`, if you already run one for other services — automatic
  certificate renewal is one less thing to manage by hand.

### 6. Cheat sheet: all settings at a glance

| Setting | Where | Permanent? | Purpose |
|---|---|:---:|---|
| `sudo systemctl enable --now docker` | Linux host | ✅ | Docker daemon survives reboot |
| "Start Docker Desktop when you sign in" | Windows/macOS Settings | ✅ | Same, for Docker Desktop |
| `restart: unless-stopped` | `docker-compose.yml` (already set) | ✅ | Container restarts once the daemon is up |
| `.env` file (not a Docker volume) | repo root, bind-mounted | ✅ | Survives `docker compose down` (not `down -v`) |
| `./${NETWORK}-DB` (Compose) / `./DB` (raw run) | bind-mounted host folder | ✅ | SQLite DB survives container recreation |
| `ELEKTRON_RPC_URL`/`USER`/`PASSWORD` | `.env` | — | Required; pool can't fetch templates without it |
| Compose `ports:` without `127.0.0.1:` prefix | `docker-compose.yml` | ✅ once edited | Exposes Stratum/API beyond localhost |
| `ufw allow` / `New-NetFirewallRule` | host firewall | ✅ | Required in addition to the port bind, not instead of it |
| Cloud security group / router port-forward | provider console / router UI | ✅ | Required on top of the host firewall for VMs / home NAT |
| `API_SECURE=true` + `secrets/*.pem` | `.env` + mounted files | ✅ | HTTPS for the API port only |
| `stunnel`/reverse proxy in front of `3333`/`3334` | separate process, outside the container | ✅ (if that process is itself enabled/`unless-stopped`) | TLS for Stratum (`4333`) since none is built in |

## Migrating from a Bitcoin pool

The `ELEKTRON_RPC_*` env vars are preferred; the legacy `BITCOIN_RPC_*` names
still work as a fallback to ease migration. See `.env.example` for the full
list.

The `NETWORK` setting defaults to `mainnet` (Elektron mainnet, HRP `be`). For
testing against an upstream Bitcoin Core node, set `NETWORK=bitcoin-mainnet`,
`bitcoin-testnet` or `bitcoin-regtest`.

`DEV_FEE_ADDRESS` from upstream `public-pool` is ignored: Elektron's per-block
UTXO attestation pins the coinbase to a single payout output, so the pool
cannot insert a fee split. Operators who want to charge fees must collect
them off-chain (e.g. periodic transfers from miner addresses).
