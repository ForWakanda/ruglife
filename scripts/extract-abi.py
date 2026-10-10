#!/usr/bin/env python3
# Copies the compiled ABIs into the server package. Run after `forge build` in contracts/.
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
for name in ["RugLifeEscrow", "SeasonStamp"]:
    abi = json.load(open(root / f"contracts/out/{name}.sol/{name}.json"))["abi"]
    (root / f"packages/server/src/abi-{name}.ts").write_text(f"// Generated from contracts/out/{name}.sol/{name}.json by scripts/extract-abi.py — do not edit.\nexport const {name}Abi = {json.dumps(abi, separators=(',', ':'))} as const;\n")
    print(name, len(abi))
