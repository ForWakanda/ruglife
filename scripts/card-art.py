#!/usr/bin/env python3
# Run with ~/ComfyUI/.venv/bin/python (it has PIL): the system python3 does not.
"""Card art for every card. Threats get a monster of their own (2026-10-13: a Chog on every Threat read as lame too) and keep their
real-Chog casting as the "starring" line with a small face; everything else gets its own picture.

    ~/ComfyUI/.venv/bin/python scripts/card-art.py   # renders the missing ones, writes packages/client/public/art/<id>.webp + src/art.ts
    python3 scripts/card-art.py --only s11 --seed 7   # redo one card with another seed
    python3 scripts/card-art.py --sheet    # a contact sheet of everything rendered → /tmp/card-art-sheet.jpg

Local Z-Image Turbo through ComfyUI (the in-session recipe: the generator script under the GPU lock; the pm2 `comfyui` lane is
started here and stopped again if it was stopped). Everything rendered here is made inside the hackathon window; before a
submission, scripts/check-no-prebell-art.sh hashes the result against ~/chogathon-prep/lookdev/SHA256SUMS.
"""
import argparse, json, os, subprocess, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "packages/client/public/art"
RAW = Path(os.environ.get("CARD_ART_RAW", "/tmp/claude-1000/-home-someone/2027a41e-5a0a-4cb0-be56-2c8de691991f/scratchpad/card-art"))
GEN = Path.home() / ".openclaw/skills/comfyui-image/scripts/generate_image_zimage.py"
PY = Path.home() / "ComfyUI/.venv/bin/python"
PM2 = Path.home() / ".nvm/versions/node/v22.22.0/bin/pm2"
LOCK = Path.home() / ".openclaw/gpu-queue/lock"
STYLE = ("Flat cartoon illustration with thick black outlines and flat saturated colours, bold simple shapes, sticker-like, "
         "centred subject on a simple background, no gradients, no photorealism. No people, no faces, no text, no letters, no numbers.")
PALETTE = {
    "fud": "Palette: sickly purple and toxic green with black.",
    "boost": "Palette: hot orange, red and yellow fire tones with black.",
    "trouble-oneshot": "Palette: alarm red, white and black.",
    "gear": "Palette: deep green, gold and black.",
    "loot-oneshot": "Palette: electric blue, cyan and yellow with black.",
    "levelup": "Palette: gold, yellow and cream with black.",
    "key": "Palette: steel grey, yellow and black.",
    "threat": "Palette: alarm red, acid yellow and black, menacing.",
    "boss": "Palette: deep crimson, black and gold, towering and menacing.",
}
# id → (type, subject). Subjects are objects and scenes only: no people (the Chogs are the people of this game).
SUBJECTS = {
 "f01": ("fud", "A swimming pool drained to a small puddle of spit at the bottom, cracked tiles, a sad deflated pool float, a pool ladder leading nowhere."),
 "f02": ("fud", "An old red rotary telephone off the hook, glowing menacingly, with an axe embedded in the desk beside it and a red down-arrow on the wall."),
 "f03": ("fud", "A giant glowing gift box with a mousetrap snapping shut inside it, a big mouse-cursor arrow hovering over the lid, sparkles turning to smoke."),
 "f04": ("fud", "A smoking pocket calculator with one huge extra zero flying off the screen, keys popping loose, a scorched desk."),
 "f05": ("fud", "A tiny blue checkmark badge on a marble pedestal under a spotlight, a magnifying glass lying ignored on the floor, velvet rope."),
 "f06": ("fud", "A washing machine mid-spin full of suds, wooden letter tiles and banknotes tumbling inside, water leaking on the floor."),
 "f07": ("fud", "A huge security camera with an enormous lens pointed at a cracked-open mailbox, a blank name tag pinned to it, floodlight."),
 "f08": ("fud", "A megaphone with a padlock hanging open and its chain broken, a red siren light flashing above it, a crowbar on the floor."),
 "f09": ("fud", "A loading spinner wheel grown thick with cobwebs and dust, a desk calendar with pages curling, a cold cup of coffee."),
 "f10": ("fud", "An open leather wallet with a tumbleweed rolling out of it, a few coins crumbling into dust, a small cactus."),
 "f11": ("fud", "An abandoned office desk with a rolled-up roadmap scroll left behind, hiking boots walking out of the door, an aeroplane through the window."),
 "f12": ("fud", "A stopwatch exploding into springs beside a red candlestick chart shaped like a roller-coaster drop with a cart flying off the end."),
 "bo01": ("boost", "A towering green candle shaped like a candlestick chart bar on a stone altar, smaller green candles and incense around it, cult banners without writing."),
 "bo02": ("boost", "An enormous whale surfacing through a sea of speech bubbles, typing-indicator dots rising like spray, phones bobbing on the waves."),
 "bo03": ("boost", "A rubber stamp shaped like a bull head pressing a certificate, a pile of nine cheap burner phones with the same glowing screen."),
 "bo04": ("boost", "A medieval catapult loaded with a boulder made of keyboards and brown poop-emoji shapes, a pinned flag, a trench of broken monitors."),
 "bo05": ("boost", "A yellow sticky note pinned with a thumbtack over a giant billboard, a magnifying glass beside stacked screenshot frames, the billboard cracking."),
 "bo06": ("boost", "A podcast microphone with a bright red ON light, loud sound waves blasting out of it, a tipped-over coffee cup and an open suitcase of cash behind it."),
 "tr01": ("trouble-oneshot", "A stack of photo prints, each a blurrier, more deep-fried copy of the one beneath, JPEG blocks and crumpled corners, a phone camera above."),
 "tr02": ("trouble-oneshot", "A shady briefcase half open in a dark alley under a street lamp, a glowing folded document inside, a referral coupon ticket beside it."),
 "tr03": ("trouble-oneshot", "A smartphone on a nightstand with two red notification dots, a coffee-ring stain, a lamp on at night, a banana crest on the lock screen."),
 "tr04": ("trouble-oneshot", "A stapled document soaked and dripping under a leaking faucet, ink running off the pages into a puddle."),
 "tr05": ("trouble-oneshot", "A clipboard with a giant rubber stamp and a mountain of binders chained to a ball and chain, a conveyor belt feeding more binders."),
 "g01": ("gear", "A hardware wallet USB stick frozen inside an ice cube that is on fire, steam and melting water, a tiny padlock charm."),
 "g02": ("gear", "A single diagonal leather bandolier ammunition belt, every loop holding a small flip phone instead of a bullet, laid out flat, no clothing."),
 "g03": ("gear", "A crumpled tinfoil crown on a velvet cushion, a microwave oven glowing ominously in the background."),
 "g04": ("gear", "Ski goggles with rose-red lenses, green candlestick charts reflected in both lenses, a strap with a bull-horn buckle."),
 "g05": ("gear", "A contact-lens case with two glowing red laser lenses, beams cutting a smoking hole through a steel safe door."),
 "g06": ("gear", "A gas mask with bull horns on the straps and a filter shaped like a megaphone, hanging on a hook."),
 "g07": ("gear", "A black hoodie on a hanger with a courtroom gavel shadow falling across it, a stapled paper pinned to the chest, handcuffs on the hook."),
 "g08": ("gear", "A tuxedo on a mannequin bust with a banana-print sash, in front of a summit podium with flags without emblems."),
 "g09": ("gear", "A cannon built from a giant keyboard key, firing bright jagged shapes and smoke, heavy recoil wheels."),
 "g10": ("gear", "A yellow supercar hoisted on a tow-truck hook, a boot clamp on the front wheel, the repo truck lights flashing."),
 "g11": ("gear", "A tiny kick scooter with a suitcase strapped on with bungee cords, a trail of dust, a revised-budget piggy bank in the basket."),
 "g12": ("gear", "Wooden clogs painted with flames, with rocket boosters bolted to the heels, skid marks."),
 "g13": ("gear", "Heavy moon boots with lead weights chained on, a crescent moon in the sky, a very small launch pad."),
 "g14": ("gear", "A fake gold wristwatch with two hour hands and no minute hand, on a small rug, a peeling gold-plate edge."),
 "g15": ("gear", "A fat 1990s brick mobile phone with fourteen SIM cards taped all over it, a long antenna, a charging cable."),
 "g16": ("gear", "A crowbar wrapped in a coiled customer-service headset cord, lying on a service counter with a bell."),
 "g17": ("gear", "A filthy oversized grey rag being wrung out by itself over a tin bucket, dripping blue tears and brown coffee, a tipped coffee cup beside it."),
 "g18": ("gear", "A pair of binoculars on a windowsill, one lens pointed at a laptop and the other at an exit door, a doorway lit red."),
 "g19": ("gear", "A shopping cart with a flag pole and a tiny flag without emblem, one wobbly wheel, motorcade motorcycles tiny behind it."),
 "g20": ("gear", "A heavy burlap sack bulging and tied with a thick chain, a blank price tag, scattered exit signs tiny around it."),
 "g21": ("gear", "A banana costume on a stand with a diplomat's medal sash and a passport, a row of tiny fruit flags behind it."),
 "g22": ("gear", "A battered megaphone spewing a cloud of brown bull-shaped smoke, with a bull horn mounted on top."),
 "g23": ("gear", "A lanyard press pass with a banana crest and a blank name area, a camera and an evacuation route arrow sign."),
 "g24": ("gear", "Fluffy bunny slippers with racing stripes and tiny rockets strapped on, in front of a bed, a laptop on the pillow."),
 "s01": ("loot-oneshot", "A big bowl of dip with tortilla chips planted in it like flags, a huge red arrow diving into the bowl, reinforcement chips marching."),
 "s02": ("loot-oneshot", "A television studio news desk with a flashing siren on it, a banana crest on the wall, a TV test pattern on the big screen."),
 "s03": ("loot-oneshot", "A rocket on a launch pad with a giant red launch button and a cut red ribbon, an empty risk-committee chair tipped over."),
 "s04": ("loot-oneshot", "An opened first-aid kit full of bandages, a stress ball, ice packs and a screenshot print with a red cross on the lid."),
 "s05": ("loot-oneshot", "A back door ajar on a party room, a pint glass left half full, an empty coat hook, confetti on the floor."),
 "s06": ("loot-oneshot", "A paper shredder eating a stack of screenshot prints, paper confetti flying, a smashed phone beside it."),
 "s07": ("loot-oneshot", "An envelope with a padlock sticker leaking glowing green liquid, forwarded-arrow stickers all over it."),
 "s08": ("loot-oneshot", "A plain cardboard box tied with a gift bow and a biohazard sticker, one side glowing gold, the other leaking smoke."),
 "s09": ("loot-oneshot", "A dump truck tipping a mountain of red candlestick bars off a cliff into a pit."),
 "s10": ("loot-oneshot", "A giant sausage-sized finger smashing a tiny keyboard key, sparks, a green candle shooting up behind."),
 "s11": ("loot-oneshot", "A banana next to a tiny ruler with a huge mountain behind it, forced perspective, a tape measure."),
 "s12": ("loot-oneshot", "A golden glowing halo and rays of light over a toilet, a stained-glass window behind it."),
 "s13": ("loot-oneshot", "A bucket, an ice pack, a pill bottle and a melting green candle on a nightstand, a wilted party balloon."),
 "s14": ("loot-oneshot", "A toilet cubicle door in camouflage pattern with a heavy bolt lock, a stopwatch hanging on the handle."),
 "s15": ("loot-oneshot", "A newspaper being sucked backwards into a printing press, a bottle of correction fluid, ink splashes."),
 "s16": ("loot-oneshot", "A sofa cushion lifted to reveal a burlap sack of banana-print banknotes stuffed behind the sofa."),
 "l01": ("levelup", "A huge green arrow bursting upward through clouds with fireworks, coins raining, a tiny flag planted on the arrow tip."),
 "l02": ("levelup", "A parachute lowering a wooden crate onto a doormat, the crate glowing gold, a doorbell."),
 "l03": ("levelup", "A banana wearing a tiny crown standing on a mountain summit with a planted flag and sunrise."),
 "l04": ("levelup", "An alarm clock ringing at sunrise with a rocket still waiting on the launch pad behind it, birds."),
 "l05": ("levelup", "A cash register on a mountain peak with confetti, a tiny rain cloud above it, a receipt curling down the slope."),
 "l06": ("levelup", "A cardboard box used as a desk with a very long blank gold name plate and a tiny crown on top, a stapler."),
 "k01": ("key", "A sticker sheet of pairs of glowing red laser eyes, one pair half peeled off and lifting, red laser beams shooting from it, on a plain table."),
 "k02": ("key", "A baseball bat with a price tag and a business card on a shop pedestal, a sign shape with no writing, chains."),
 "k03": ("key", "A green sun visor with a sticky note stuck to it and a key card tucked in the band, on an admin desk."),
 "k04": ("key", "A banana shaped like a key turning in the lock of a vault's back door, a rotating security light."),
 "k05": ("key", "A scroll scribbled in crayon with a wax seal of a banana, a battering ram leaning on a door."),
 # Threats are monsters, machines and creatures — never a human face (the Chogs are the people of this game); the cast Chog is the
 # "starring" credit on the card, not the picture.
 "t01": ("threat", "A small green goblin creature in a gas-station attendant vest holding a fuel nozzle that drips coins, a price sign with no writing, a snack rack behind it."),
 "t02": ("threat", "A tiny panicking slime creature in a loose necktie slamming a huge red SELL-style lever on a trading desk, three monitors showing one falling red candle each, papers flying."),
 "t03": ("threat", "A fat toad monster in a landlord's crown and bathrobe sitting on a throne made of a chat-server window, holding out a palm for rent, a tiny eviction scroll."),
 "t04": ("threat", "A scarecrow stuffed with hundreds of empty crypto wallets and seed-phrase cards, crows made of parachutes, a field of tiny identical wallet-shaped tombstones."),
 "t05": ("threat", "A friendly-looking robot headset creature with a wide fake smile, one claw holding a clipboard, the other claw reaching for a seed-phrase card, a support desk."),
 "t06": ("threat", "A gang of three identical masked rat creatures in hoodies each carrying a copy-paste clipboard, strung together with bugs crawling over the code sheets."),
 "t07": ("threat", "A sleek shark creature in a motivational coach's whistle and headset standing on a stage, an escalator of smaller fish walking into its mouth, a sign with no writing."),
 "t08": ("threat", "A huge round monster with a vacuum-cleaner mouth hoovering up tiny picture frames off a gallery floor, price tags fluttering, the floor tiles peeling away."),
 "t09": ("threat", "A sweaty bull creature strapped to a rocket chair labelled only with a huge x symbol, a lit fuse, a liquidation guillotine blade above, a fart cloud."),
 "t10": ("threat", "A honey-dripping Venus flytrap monster wearing a headset and a name badge with no writing, a queue ticket machine, a phone with the cord cut."),
 "t11": ("threat", "A parade of tiny panicking lemming creatures in single file carrying exit signs with no writing, marching off a cliff edge of a red candlestick chart, confetti."),
 "t12": ("threat", "A headless business suit with a halo and angel wings holding a stopwatch set three seconds early, a pile of coins behind its back, a laboratory flask."),
 "t13": ("threat", "A hydra monster with five heads each wearing a different startup logo-shaped hat, bursting out of a wall of pitch decks, suitcases of cash leaking from its tail."),
 "t14": ("threat", "A bank counter booth with a shuttered steel window, a closed sign shape with no writing, a tentacle monster behind the window holding a sack of coins, cobwebs."),
 "t15": ("threat", "A battalion of one hundred identical cardboard-cutout bot soldiers with megaphone heads, all plugged into one single charging cable, a parade ground."),
 "t16": ("threat", "A giant glowing power switch set to off, a decentralised network of nodes drawn as little planets hanging dead and dark, a mechanical hand on the switch."),
 "t17": ("threat", "A green goblin creature with a keyboard for teeth and a mouse-cursor arrow on a stick, hundreds of tiny speech bubbles around it, a suspicious link chain in its hand."),
 "t18": ("threat", "A boxy rusty robot crying oil tears over a failed captcha puzzle of traffic lights and crosswalks, a tissue box, a heart-shaped battery."),
 "t19": ("threat", "A giant monster sandwich with two slices of bread chomping down on a tiny transaction receipt scroll, a bot-shaped mascot squeezing it, mustard splashing."),
 "t20": ("threat", "A sneaky chameleon creature in a crown and a moderator's armband holding a fake badge, a direct-message envelope glowing with red urgency, a crooked spelling of nothing."),
 "t21": ("threat", "A reporter owl creature with a microphone and a satellite-dish backpack standing on the moon's surface, a news-van, a question-mark-shaped crater."),
 "t22": ("threat", "An archaeologist mole creature with a pith helmet and a brush digging up a crumbling roadmap scroll from a fossil layer, a tiny Q4 fossil shaped like a question mark."),
 "t23": ("threat", "A bear creature with its shorts literally on fire running from a green rocket candle, a bucket of water just out of reach, scorched exchange tickets."),
 "t24": ("threat", "A huge grizzly bear monster in reading glasses holding a thick folder of printed screenshots, long claws out, a red marker pen, a courtroom bench."),
 "t25": ("threat", "A stern banana creature in an auditor's visor and sleeve garters stamping a cookbook of accounts over a frying pan, a green unripe banana flag, an abacus."),
 "t26": ("threat", "A government-ministry building shaped like a crying face with its columns as teeth, a flag of a tear drop, a rubber stamp the size of a car, filing cabinets overflowing."),
 "b01": ("boss", "A skeletal chairman in a pinstripe suit at the head of a long boardroom table, every chair holding a skeleton, a bullish green arrow chart on the wall, candles."),
 "b02": ("boss", "A glowing radioactive mutant blob monster clutching a bag of coins to its chest inside a collapsing nuclear plant, warning trefoils, decaying walls, green ooze."),
 "b03": ("boss", "A one-eyed crystalline monster made of a single rare gem on a committee table surrounded by empty microphones and name plates with no writing, spotlight."),
 "b04": ("boss", "A giant building-sized monster made of floor tiles and marble that is eating the floor itself, cranes, a tiny demolition ball, a shop floor peeling up into its mouth."),
 "b05": ("boss", "A cult of hooded faceless figures around a giant emergency-broadcast siren with a television for a head, stripes of warning colour, candles, a satellite dish altar."),
 "b06": ("boss", "A trench coat standing by itself with three raccoon creatures stacked inside it wearing a top hat, a briefcase of burning banknotes, a stock-exchange floor."),
}

def comfy_up() -> bool:
    try:
        urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=3); return True
    except Exception:
        return False

def pm2_status() -> str:
    try:
        j = json.loads(subprocess.run([str(PM2), "jlist"], capture_output=True, text=True).stdout)
        return next((p["pm2_env"]["status"] for p in j if p["name"] == "comfyui"), "absent")
    except Exception:
        return "unknown"

def render(cid: str, seed: int, size: int) -> Path:
    typ, subject = SUBJECTS[cid]
    prompt = f"{subject} {PALETTE[typ]} {STYLE}"
    RAW.mkdir(parents=True, exist_ok=True)
    out = RAW / f"{cid}-s{seed}.png"
    cmd = ["flock", str(LOCK), str(PY), str(GEN), "-p", prompt, "-f", str(out), "--width", str(size), "--height", str(size), "--steps", "8", "--seed", str(seed)]
    t = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not out.exists():
        print(f"✗ {cid}: {r.stderr.strip()[-300:]}", file=sys.stderr); return None
    print(f"✓ {cid} {time.time() - t:5.1f}s {out.name}", flush=True)
    return out

def to_webp(src: Path, cid: str, px: int = 512) -> Path:
    from PIL import Image
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / f"{cid}.webp"
    Image.open(src).convert("RGB").resize((px, px), Image.LANCZOS).save(dst, "WEBP", quality=82, method=6)
    return dst

def write_index() -> None:
    ids = sorted(p.stem for p in OUT.glob("*.webp"))
    (ROOT / "packages/client/src/art.ts").write_text(
        "// Generated by scripts/card-art.py — the cards with their own picture (every card). Threats also keep a real-Chog casting credit.\n"
        f"export const ART: ReadonlySet<string> = new Set({json.dumps(ids)});\n")
    print(f"art.ts: {len(ids)} cards")

def sheet() -> None:
    from PIL import Image, ImageDraw
    files = sorted(OUT.glob("*.webp"))
    cols, cell = 10, 160
    rows = (len(files) + cols - 1) // cols
    im = Image.new("RGB", (cols * cell, rows * (cell + 18)), "black"); d = ImageDraw.Draw(im)
    for i, f in enumerate(files):
        x, y = (i % cols) * cell, (i // cols) * (cell + 18)
        im.paste(Image.open(f).resize((cell, cell)), (x, y)); d.text((x + 4, y + cell + 2), f.stem, fill="white")
    im.save("/tmp/card-art-sheet.jpg", quality=85); print("sheet: /tmp/card-art-sheet.jpg")

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="card ids to (re)render")
    ap.add_argument("--seed", type=int, default=None, help="seed for --only (default: per-card)")
    ap.add_argument("--size", type=int, default=768)
    ap.add_argument("--sheet", action="store_true")
    ap.add_argument("--all", action="store_true", help="re-render even when the webp exists")
    a = ap.parse_args()
    if a.sheet: sheet(); return
    ids = a.only or [i for i in SUBJECTS if a.all or not (OUT / f"{i}.webp").exists()]
    if not ids: print("nothing to render"); write_index(); return
    was = pm2_status()
    if not comfy_up():
        subprocess.run([str(PM2), "start", "comfyui"], capture_output=True)
        for _ in range(90):
            if comfy_up(): break
            time.sleep(2)
        else:
            sys.exit("ComfyUI did not come up")
    try:
        done = 0
        for i, cid in enumerate(ids):
            seed = a.seed if a.seed is not None else 1000 + list(SUBJECTS).index(cid)
            raw = render(cid, seed, a.size)
            if raw: to_webp(raw, cid); done += 1
        print(f"rendered {done}/{len(ids)}")
    finally:
        if was == "stopped":
            subprocess.run([str(PM2), "stop", "comfyui"], capture_output=True); print("comfyui stopped again (as found)")
    write_index()

if __name__ == "__main__":
    main()
