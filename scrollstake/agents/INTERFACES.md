# Interfaces (source of truth)

## 1. On-chain program `scrollstake` (Anchor 0.30.x)

### Accounts
| Account | Seeds | Fields |
|---|---|---|
| `Group` | `["group", group_id]` | authority, oracle, mint, pool, group_id (String, max 16), penalty_total (u64), bump |
| Pool token account | `["pool", group]` | SPL token account, mint = USDC mint, owner = Group PDA |
| `Stake` | `["stake", group, member]` | member, group, amount (u64), slashed (u64), strikes (u16), bump |

`group_id` is the session/group identifier string used in seeds (<= 16 bytes, we use the session code).

### Instructions
| Instruction | Signer | Args | Effect |
|---|---|---|---|
| `create_group` | authority | `group_id: String` | creates Group + pool token account, stores oracle pubkey |
| `deposit` | member | `amount: u64` | transfers tokens member ATA -> pool, increases Stake.amount (creates Stake if needed) |
| `slash` | oracle | `amount: u64` | Stake.amount -= min(amount, Stake.amount); Stake.slashed += that; strikes += 1; Group.penalty_total += that; emits `Slashed` |
| `withdraw` | member | none | transfers Stake.amount pool -> member ATA, sets Stake.amount = 0 |

### Event
`Slashed { group: Pubkey, member: Pubkey, amount: u64, remaining: u64, strikes: u16 }`

## 2. HTTP API (Next.js route handlers in `web/app/api`)

All bodies are JSON. Money fields are in **USDC decimals** (e.g. `0.5`) at the API layer; the API converts to base units for the chain.

### `POST /api/sessions`
Request: `{ "creatorWallet": string, "stakeUsdc": number, "penaltyUsdc": number, "lives": number }`
Response: `{ "code": string }`  (6-char session code; also used as on-chain `group_id`)

### `POST /api/sessions/join`
Request: `{ "code": string, "wallet": string, "name": string }`
Response: `{ "clientToken": string, "session": Session }`
The `clientToken` is what the CV client sends in the `x-client-token` header.

### `GET /api/sessions/{code}`
Response: `Session`

### `POST /api/events`  (called by the CV client)
Headers: `x-client-token: <token>`
Request:
```json
{ "code": "AB12CD", "wallet": "<pubkey>", "type": "distraction",
  "reason": "window:instagram" , "durationSec": 12.3, "ts": 1760000000 }
```
`type` is one of `distraction | heartbeat`.
Response:
```json
{ "status": "forgiven" | "slashed" | "ignored" | "error",
  "livesLeft": 2, "strikes": 1, "txSig": "..." }
```

### `GET /api/leaderboard?code={code}` (stretch, Tiger Data)
Response: `[{ "wallet": string, "name": string, "strikes": number, "slashedUsdc": number }]`

### Types (`web/lib/types.ts`)
```ts
Session = { code, creatorWallet, stakeUsdc, penaltyUsdc, lives, createdAt, members: Member[] }
Member  = { wallet, name, livesLeft, strikes, slashedUsdc, lastEventAt }
```

## 3. Environment variables

`web/.env.local`
```
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=<from anchor deploy>
NEXT_PUBLIC_USDC_MINT=<devnet test mint>
NEXT_PUBLIC_PRIVY_APP_ID=<privy>
ORACLE_SECRET_KEY=<base58 secret key of the oracle keypair>
SOLANA_DRY_RUN=1            # set 0 once the program is deployed
DATABASE_URL=               # Tiger Data connection string (optional until stretch)
```

`cv-client/.env`
```
API_URL=http://localhost:3000
SESSION_CODE=AB12CD
CLIENT_TOKEN=<from /api/sessions/join>
WALLET=<member pubkey>
GRACE_SECONDS=10
```
