#!/usr/bin/env python3
"""
Simple terminal client for placing orders against the CTC API.

Requirements:
  - Python 3.12+
  - requests (pip install requests)

Usage examples:
  - Non-interactive, single order:
      python examples/place_order_cli.py \
        --api-url http://localhost:8000 \
        --api-key "$X_API_KEY" \
        place --symbol AAPL --side buy --type limit --quantity 10 --price 199.50

  - Interactive session:
      python examples/place_order_cli.py --api-url http://localhost:8000 --api-key "$X_API_KEY"
"""

from __future__ import annotations

import os
import sys
import time
import json
import argparse
from typing import Any, Optional

import requests


def build_headers(api_key: str) -> dict[str, str]:
    return {"X-API-Key": api_key, "Content-Type": "application/json"}


def api_get(base_url: str, path: str, api_key: str, params: Optional[dict[str, Any]] = None) -> Any:
    url = f"{base_url}{path}"
    resp = requests.get(url, headers=build_headers(api_key), params=params, timeout=15)
    _raise_for_api_error(resp)
    return resp.json()


def api_post(base_url: str, path: str, api_key: str, body: dict[str, Any]) -> Any:
    url = f"{base_url}{path}"
    resp = requests.post(url, headers=build_headers(api_key), data=json.dumps(body), timeout=15)
    _raise_for_api_error(resp)
    return resp.json()


def _raise_for_api_error(resp: requests.Response) -> None:
    if 200 <= resp.status_code < 300:
        return
    try:
        data = resp.json()
        detail = data.get("detail") if isinstance(data, dict) else None
    except Exception:
        detail = None
    msg = f"HTTP {resp.status_code}"
    if detail:
        msg += f": {detail}"
    raise RuntimeError(msg)


def list_symbols(base_url: str, api_key: str) -> None:
    data = api_get(base_url, "/api/v1/symbols", api_key)
    symbols = data.get("symbols", [])
    if not symbols:
        print("No symbols available.")
        return
    print("Available symbols:")
    for row in symbols:
        print(f"  - {row.get('symbol')}\t{row.get('name')}")


def list_open_orders(base_url: str, api_key: str, symbol: Optional[str] = None) -> None:
    params: dict[str, Any] = {}
    if symbol:
        params["symbol"] = symbol
    data = api_get(base_url, "/api/v1/orders/open", api_key, params=params)
    orders = data.get("orders", [])
    if not orders:
        print("No open orders.")
        return
    print("Open orders:")
    for o in orders:
        price_str = f" @ {o['price']}" if o.get("price") is not None else ""
        print(
            f"  - {o['order_id']} | {o['symbol']} {o['side']} {o['quantity']} {o['order_type']}{price_str} | {o['status']}"
        )


def place_order(
    base_url: str,
    api_key: str,
    *,
    symbol: str,
    side: str,
    order_type: str,
    quantity: int,
    price: Optional[float],
) -> None:
    payload: dict[str, Any] = {
        "symbol": symbol,
        "side": side,
        "order_type": order_type,
        "quantity": quantity,
    }
    if order_type == "limit":
        if price is None:
            raise ValueError("Limit orders require --price")
        payload["price"] = float(price)

    res = api_post(base_url, "/api/v1/orders", api_key, payload)
    print("Order placed:")
    print(json.dumps(res, indent=2, default=str))


def interactive_loop(base_url: str, api_key: str) -> None:
    print("\nCTC Terminal - Interactive Mode")
    print("Type 'help' for commands; 'quit' to exit.\n")
    while True:
        try:
            cmd = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return

        if not cmd:
            continue
        if cmd in {"quit", "exit"}:
            return
        if cmd == "help":
            print(
                """
Commands:
  symbols                 # list tradable symbols
  open [SYMBOL]           # list open orders (optional symbol filter)
  buy SYMBOL QTY         # place a market buy
  sell SYMBOL QTY        # place a market sell
  limitbuy SYMBOL QTY PX  # place a limit buy
  limitsell SYMBOL QTY PX # place a limit sell
  quit                    # exit
                """.strip()
            )
            continue

        parts = cmd.split()
        try:
            if parts[0] == "symbols":
                list_symbols(base_url, api_key)
            elif parts[0] == "open":
                sym = parts[1] if len(parts) > 1 else None
                list_open_orders(base_url, api_key, sym)
            elif parts[0] in {"buy", "sell"}:
                if len(parts) < 3:
                    print("Usage: buy|sell SYMBOL QTY")
                    continue
                sym = parts[1]
                qty = int(parts[2])
                place_order(
                    base_url,
                    api_key,
                    symbol=sym,
                    side=parts[0],
                    order_type="market",
                    quantity=qty,
                    price=None,
                )
            elif parts[0] in {"limitbuy", "limitsell"}:
                if len(parts) < 4:
                    print("Usage: limitbuy|limitsell SYMBOL QTY PRICE")
                    continue
                sym = parts[1]
                qty = int(parts[2])
                px = float(parts[3])
                side = "buy" if parts[0] == "limitbuy" else "sell"
                place_order(
                    base_url,
                    api_key,
                    symbol=sym,
                    side=side,
                    order_type="limit",
                    quantity=qty,
                    price=px,
                )
            else:
                print("Unknown command; type 'help' for usage.")
        except Exception as err:  # surface API errors without stack trace
            print(f"Error: {err}")
            time.sleep(0.1)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="CTC Trading CLI")
    parser.add_argument(
        "--api-url",
        default=os.environ.get("CTC_API_URL") or os.environ.get("NEXT_PUBLIC_API_URL") or "http://localhost:8000",
        help="Base URL of the API, e.g. http://localhost:8000",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("CTC_API_KEY") or os.environ.get("API_KEY") or os.environ.get("X_API_KEY"),
        help="Your API key (or set CTC_API_KEY, API_KEY, or X_API_KEY env var)",
    )

    sub = parser.add_subparsers(dest="command")

    sub.add_parser("symbols", help="List tradable symbols")

    sp_open = sub.add_parser("open", help="List open orders")
    sp_open.add_argument("--symbol", help="Optional symbol filter", default=None)

    sp_place = sub.add_parser("place", help="Place an order (non-interactive)")
    sp_place.add_argument("--symbol", required=True)
    sp_place.add_argument("--side", required=True, choices=["buy", "sell"]) 
    sp_place.add_argument("--type", required=True, choices=["market", "limit"]) 
    sp_place.add_argument("--quantity", required=True, type=int)
    sp_place.add_argument("--price", type=float)

    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    api_url: str = str(args.api_url).rstrip("/")
    api_key: Optional[str] = args.api_key

    if not api_key:
        try:
            api_key = input("Enter API key: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 1
    if not api_key:
        print("API key is required")
        return 1

    if args.command == "symbols":
        list_symbols(api_url, api_key)
        return 0
    if args.command == "open":
        list_open_orders(api_url, api_key, args.symbol)
        return 0
    if args.command == "place":
        try:
            place_order(
                api_url,
                api_key,
                symbol=args.symbol,
                side=args.side,
                order_type=args.type,
                quantity=int(args.quantity),
                price=float(args.price) if args.price is not None else None,
            )
        except Exception as err:
            print(f"Error: {err}")
            return 2
        return 0

    # Interactive mode
    interactive_loop(api_url, api_key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))


