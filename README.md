# token-radar-01

A token launch radar: pre-token DeFi protocols ranked by implied value, with farming steps. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01) [![Rank](https://make.fun/badge/token-radar-01/aldifirman-dev/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01) [![Reward](https://make.fun/badge/token-radar-01/aldifirman-dev/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

The board covers the full watchlist, includes every rankable pre-token protocol below its floor, and keeps protocols with recorded tokens in a separate live set. The model uses only the sealed snapshot.

**radar-2:** `round(TVL × 0.25 × (1 + clamp(change_7d, -80, 200) / 100 × 0.5) × (0.6 + min(age_days, 1095) / 1095 × 0.4) × (1 + 0.04 × min(max(chains - 1, 0), 5)))`

Run it with Node:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot>
```

The output contains `board.json`, a static dashboard, screenshots, and a make.fun dossier. The dashboard sandbox changes the base multiple, growth weight, and chain step to rerank the full board.

[Use referral code 7gs0014x](https://make.fun/?ref=7gs0014x)
