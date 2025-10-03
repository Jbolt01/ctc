# Examples

## Order Placement CLI

This repository includes a simple terminal client for placing orders against the CTC API.

File: `examples/place_order_cli.py`

### Requirements
- Python 3.12+
- requests (`pip install requests`)

### API URL and Key
- Use `https://cornelltradingcompetition.org` as the API base URL in production.
- To get an API key:
  1. Visit `https://cornelltradingcompetition.org/`
  2. Sign in with Google.
  3. After onboarding (create or join a team), go to the Team page.
  4. As a team owner, use the API Keys section to create a new key for your bot. Copy the key when prompted.

The script accepts the API URL and key via flags or environment variables:
- Flags: `--api-url`, `--api-key`
- Environment variables (checked in order):
  - URL: `CTC_API_URL`, `NEXT_PUBLIC_API_URL`
  - Key: `CTC_API_KEY`, `API_KEY`, `X_API_KEY`

### Non-Interactive Usage
Place a single order and exit:

```bash
python examples/place_order_cli.py \
  --api-url https://cornelltradingcompetition.org \
  --api-key "$X_API_KEY" \
  place --symbol AAPL --side buy --type limit --quantity 10 --price 199.50
```

- For market orders, omit `--price` and pass `--type market`.

### Interactive Usage
Run the CLI interactively:

```bash
python examples/place_order_cli.py \
  --api-url https://cornelltradingcompetition.org \
  --api-key "$X_API_KEY"
```

Type `help` to see available commands:

```
symbols                 # list tradable symbols
open [SYMBOL]           # list open orders (optional symbol filter)
buy SYMBOL QTY         # place a market buy
sell SYMBOL QTY        # place a market sell
limitbuy SYMBOL QTY PX  # place a limit buy
limitsell SYMBOL QTY PX # place a limit sell
quit                    # exit
```

### Notes
- The CLI sets the `X-API-Key` header on every request.
- Limit orders require `--price`. Market orders ignore it.
- Errors from the API are surfaced as simple messages (e.g., invalid key, trading halted).
