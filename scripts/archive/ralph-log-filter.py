#!/usr/bin/env python3
"""Filter claude --output-format stream-json into readable progress logs."""
import sys
import json
import os

# Force unbuffered stdout
sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', buffering=1)

# Read line-by-line without buffering (not `for line in sys.stdin` which buffers)
while True:
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
    except json.JSONDecodeError:
        # Not JSON — print as-is (e.g. verbose/debug output from claude)
        print(line, flush=True)
        continue

    t = e.get("type", "")

    if t == "content_block_start":
        cb = e.get("content_block", {})
        if cb.get("type") == "tool_use":
            name = cb.get("name", "?")
            print(f"\n--- {name} ---", flush=True)

    elif t == "content_block_delta":
        delta = e.get("delta", {})
        dt = delta.get("type", "")
        if dt == "text_delta":
            print(delta.get("text", ""), end="", flush=True)
        elif dt == "input_json_delta":
            chunk = delta.get("partial_json", "")
            if len(chunk) < 200:
                print(chunk, end="", flush=True)

    elif t == "content_block_stop":
        print("", flush=True)

    elif t == "result":
        subtype = e.get("subtype", "")
        if subtype == "success":
            print("\n=== iteration finished ===", flush=True)
        elif subtype == "error":
            print(f"\n!!! error: {e.get('error', '?')} !!!", flush=True)

    elif t == "tool_result":
        content = e.get("content", "")
        if isinstance(content, str) and content:
            preview = content[:300]
            if len(content) > 300:
                preview += f"... ({len(content)} chars)"
            print(preview, flush=True)
