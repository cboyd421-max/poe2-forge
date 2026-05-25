"""Generate POE2 Forge Friends Guide PDF.

One-shot script — produces C:\\Users\\User\\Downloads\\POE2Forge_Friends_Guide.pdf.
Uses reportlab's Platypus for layout. No external assets.
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table,
    TableStyle, KeepTogether, HRFlowable,
)

GOLD = HexColor('#FFD600')
GOLD_DIM = HexColor('#7A6300')
VIOLET = HexColor('#7B2FFF')
BLUE = HexColor('#1A8FFF')
GREEN = HexColor('#00E676')
TEXT = HexColor('#E6E6F0')
TEXT_DIM = HexColor('#9090A8')
INK = HexColor('#1A1A20')
PANEL = HexColor('#F4F4F7')
BORDER = HexColor('#D0D0DA')
CODE_BG = HexColor('#272735')
CODE_TEXT = HexColor('#E6E6F0')

OUTPUT = r"C:\Users\User\Downloads\POE2Forge_Friends_Guide.pdf"

styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    'TitleBig', parent=styles['Title'],
    fontName='Helvetica-Bold', fontSize=28, leading=34,
    textColor=GOLD, alignment=TA_LEFT, spaceAfter=4,
)
subtitle_style = ParagraphStyle(
    'Subtitle', parent=styles['Normal'],
    fontName='Helvetica', fontSize=11, leading=15,
    textColor=TEXT_DIM, alignment=TA_LEFT, spaceAfter=14,
)
h1_style = ParagraphStyle(
    'H1', parent=styles['Heading1'],
    fontName='Helvetica-Bold', fontSize=15, leading=20,
    textColor=GOLD, spaceBefore=18, spaceAfter=10,
)
h2_style = ParagraphStyle(
    'H2', parent=styles['Heading2'],
    fontName='Helvetica-Bold', fontSize=12, leading=16,
    textColor=VIOLET, spaceBefore=12, spaceAfter=6,
)
body_style = ParagraphStyle(
    'Body', parent=styles['Normal'],
    fontName='Helvetica', fontSize=10.5, leading=15,
    textColor=INK, alignment=TA_LEFT, spaceAfter=8,
)
bullet_style = ParagraphStyle(
    'Bullet', parent=body_style,
    leftIndent=14, bulletIndent=0, spaceAfter=4,
)
small_style = ParagraphStyle(
    'Small', parent=body_style,
    fontSize=9.5, leading=13, textColor=TEXT_DIM,
)
callout_style = ParagraphStyle(
    'Callout', parent=body_style,
    fontSize=10, leading=14, textColor=INK,
    leftIndent=10, rightIndent=10,
    spaceBefore=4, spaceAfter=4,
)
code_style = ParagraphStyle(
    'Code', parent=body_style,
    fontName='Courier', fontSize=9.5, leading=13,
    textColor=CODE_TEXT, backColor=CODE_BG,
    leftIndent=10, rightIndent=10, spaceBefore=6, spaceAfter=10,
    borderPadding=8,
)


def code_block(text):
    return Paragraph(text.replace('\n', '<br/>'), code_style)


def bullet(text):
    return Paragraph(f"<bullet>&bull;</bullet> {text}", bullet_style)


def callout(text, color=VIOLET):
    tbl = Table(
        [[Paragraph(text, callout_style)]],
        colWidths=[6.5 * inch],
    )
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), PANEL),
        ('LINEBEFORE', (0, 0), (0, 0), 3, color),
        ('LEFTPADDING', (0, 0), (-1, -1), 14),
        ('RIGHTPADDING', (0, 0), (-1, -1), 14),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ]))
    return tbl


def hr():
    return HRFlowable(width="100%", thickness=0.6, color=BORDER, spaceBefore=6, spaceAfter=10)


story = []

# ── COVER / INTRO ────────────────────────────────────────────────────
story.append(Paragraph("POE2 FORGE", title_style))
story.append(Paragraph(
    "A tester's guide for friends &mdash; v16 (Phases 0&ndash;7C + PoB2 bridge)",
    subtitle_style,
))
story.append(hr())

story.append(Paragraph(
    "Hey &mdash; thanks for trying this out. POE2 Forge is a build tool I've been "
    "building for Path of Exile 2: think Path of Building 2, but with a cleaner UI, "
    "live trade-market integration, and a cross-class build scanner that pattern-matches "
    "S-tier interactions. It's all local-first (the UI is one HTML file) and there are "
    "no npm dependencies anywhere.",
    body_style,
))
story.append(Paragraph(
    "You have two ways to try it: a 2-minute browser demo with no install, or a "
    "15-minute full setup that turns on the live trade scans and character import. "
    "Both are below.",
    body_style,
))

# ── WHAT WORKS TODAY ────────────────────────────────────────────────
story.append(Paragraph("What works today", h1_style))
story.append(Paragraph(
    "Phases 0&ndash;7C plus the PoB2 bridge have shipped. Here's the surface area:",
    body_style,
))

story.append(bullet(
    "<b>Welcome tab</b> &mdash; first-time setup checklist, league/character dropdown, "
    "and the PoB2 bridge entry point for PoE2 character imports."
))
story.append(bullet(
    "<b>Optimizer tab</b> &mdash; paperdoll UI, scored upgrade results from the "
    "live <i>trade2</i> API, copy-whisper for every item."
))
story.append(bullet(
    "<b>PoB2 Decoder</b> &mdash; paste any Path of Building 2 export code, "
    "decode in-browser, send straight to the Optimizer for upgrades."
))
story.append(bullet(
    "<b>Build Gallery</b> &mdash; curated league-start builds (Jungroan Titan caster, "
    "Bridget Whirling Assault, etc.); save your own with the star button."
))
story.append(bullet(
    "<b>S-Rank Scanner</b> &mdash; pattern-matches the \"downside text negated by "
    "ascendancy keystone\" interaction behind every recent S-tier build "
    "(Lich + Last Lament, Hollow Form + Rolling Slam). Explains the actual mechanics, "
    "not just \"these things go together.\""
))
story.append(bullet(
    "<b>Advanced Thaumaturgy reference</b> &mdash; searchable alt-quality table; "
    "fills in with real data once PoE2DB ingests post-launch."
))
story.append(bullet(
    "<b>Build Export</b> &mdash; round-trips back to a PoB2 paste code; lossless "
    "if you originally imported from PoB."
))
story.append(bullet(
    "<b>Gear Editor (7A)</b> &mdash; toggle EDIT MODE on the paperdoll, "
    "click any slot to edit rarity, base, item level, and individual mods."
))
story.append(bullet(
    "<b>Skill Editor (7B)</b> &mdash; \"Edit Skills\" button. Edit each gem group: "
    "main + supports with an in-game-style searchable gem picker, level/quality, "
    "slot label, ENABLED/DISABLED chip, MAIN radio across groups."
))
story.append(bullet(
    "<b>Tree paste-import (7C)</b> &mdash; \"Edit Passive Tree\" button. Paste any "
    "tree URL (pathofexile.com / pobb.in / poeplanner) to replace the build's tree."
))
story.append(bullet(
    "<b>PoB2 Bridge (v16)</b> &mdash; \"Connect via PoB2\" launches PoB2 to import "
    "your PoE2 character (workaround for OAuth being unapproved); clipboard ingests "
    "the resulting code automatically."
))

story.append(Paragraph(
    "<i>What's coming next:</i> Phase 8 calc engine (live stat recompute), Phase 9 "
    "side-by-side comparison, Phase 10 market intelligence, an interactive tree "
    "renderer post-launch &mdash; see the roadmap PDF in the repo for the full plan.",
    small_style,
))

story.append(PageBreak())

# ── QUICK START ──────────────────────────────────────────────────────
story.append(Paragraph("Quick start (2 minutes, no install)", h1_style))
story.append(Paragraph(
    "Just open this link in any modern browser:",
    body_style,
))
story.append(code_block("https://cboyd421-max.github.io/poe2-forge"))
story.append(Paragraph(
    "You'll land on the v16 UI. The header will say <b>PROXY OFFLINE</b> &mdash; "
    "that's expected. Everything in the <b>Theorycraft</b> tab and the three editors "
    "(gear, skills, tree) work without the proxy. Only the Optimizer's live trade "
    "scans, the PoE1 character import, and the PoB2 bridge auto-launch need the proxy.",
    body_style,
))

story.append(Paragraph("Try these (in order):", h2_style))
story.append(bullet(
    "Open <b>Theorycraft &rarr; Build Gallery</b>, click any curated build, then "
    "<b>Send to Optimizer</b>. The paperdoll fills in."
))
story.append(bullet(
    "Back on the Optimizer, toggle the violet <b>EDIT MODE</b> chip in the top-right. "
    "Click any slot, change a mod, save. Watch the <b>STATS STALE</b> pill appear "
    "&mdash; an honest signal that displayed numbers no longer match (Phase 8 will "
    "recompute them properly)."
))
story.append(bullet(
    "Click <b>Edit Skills</b> in the left panel. Try the &#x2317; gem picker on any "
    "gem &mdash; type to filter, click to select, or just type a custom name. Flip a "
    "group's ENABLED chip to DISABLED, then save."
))
story.append(bullet(
    "Click <b>Edit Passive Tree</b>. Paste any tree URL (e.g. one from a creator's "
    "writeup) into the textarea. Watch the validator confirm the source and estimate "
    "node count, then save."
))
story.append(bullet(
    "Click <b>EXPORT BUILD (POB2)</b>. Paste the code into Path of Building 2 itself "
    "to confirm it imports cleanly &mdash; all your edits round-trip through."
))
story.append(bullet(
    "Open <b>Theorycraft &rarr; S-Rank Scanner</b>, hit <b>Scan Current Build</b>. "
    "It'll flag any downside-negation patterns it recognizes."
))

story.append(callout(
    "<b>Known sparse spot:</b> The Advanced Thaumaturgy reference is mostly empty "
    "until PoE2DB ingests the 0.5 patch data (24&ndash;48 hours after May 29 launch). "
    "Not a bug &mdash; just waiting on the data source.",
    color=BLUE,
))

story.append(PageBreak())

# ── FULL SETUP ──────────────────────────────────────────────────────
story.append(Paragraph("Full setup (15 minutes, adds trade + character import)", h1_style))
story.append(Paragraph(
    "Do this if you want the Optimizer to pull real upgrade options from the live "
    "trade API, or to use the PoB2 bridge for PoE2 character imports. You'll need "
    "<b>Node.js</b>, your <b>POESESSID cookie</b>, and a clone of the repo. As of "
    "proxy v2.5, the proxy also serves the HTML and assets &mdash; one URL for "
    "everything (no second static server).",
    body_style,
))

story.append(Paragraph("1. Install Node.js", h2_style))
story.append(Paragraph(
    "Download from <font color='#1A8FFF'>https://nodejs.org</font> and run the "
    "installer. v18 or newer is fine. Verify in PowerShell or Terminal:",
    body_style,
))
story.append(code_block("node --version"))

story.append(Paragraph("2. Get your POESESSID cookie", h2_style))
story.append(Paragraph(
    "This is a session cookie from pathofexile.com. The local proxy uses it to talk "
    "to the trade API as you.",
    body_style,
))
story.append(bullet("Log in at <font color='#1A8FFF'>https://www.pathofexile.com</font> in any browser."))
story.append(bullet("Open DevTools with <b>F12</b>."))
story.append(bullet("Go to the <b>Application</b> tab (Chrome) or <b>Storage</b> (Firefox)."))
story.append(bullet("Under <b>Cookies &rarr; https://www.pathofexile.com</b>, find the row named <b>POESESSID</b>."))
story.append(bullet("Copy the <b>Value</b> column &mdash; it's a long hex string."))

story.append(callout(
    "<b>Treat POESESSID like a password.</b> Anyone with it can act as you on the trade "
    "site. Don't paste it anywhere public. The repo's <b>.gitignore</b> already blocks "
    "the <b>.env</b> file you'll put it in.",
    color=VIOLET,
))

story.append(Paragraph("3. Clone the repo and create .env", h2_style))
story.append(code_block(
    "git clone https://github.com/cboyd421-max/poe2-forge.git\n"
    "cd poe2-forge"
))
story.append(Paragraph(
    "Create a file called <b>.env</b> in the project root with these lines "
    "(swap in your real values):",
    body_style,
))
story.append(code_block(
    "POESESSID=paste_your_cookie_value_here\n"
    "POE_ACCOUNT=YourAccountName#1234\n"
    "PORT=3001\n"
    "POB2_PATH=C:\\Program Files\\Path of Building Community (PoE2)\\Path of Building.exe"
))
story.append(Paragraph(
    "<b>POE_ACCOUNT</b> is your account name including the discriminator (the #1234 "
    "part). <b>POB2_PATH</b> is optional &mdash; only needed if you want the "
    "\"Connect via PoB2\" button to auto-launch PoB2. Without it, the bridge still "
    "works; you just open PoB2 manually.",
    body_style,
))

story.append(Paragraph("4. Run the proxy", h2_style))
story.append(code_block("node poe2forge-proxy.js"))
story.append(Paragraph(
    "You should see a banner with the app URL spelled out. Leave that window open.",
    body_style,
))

story.append(KeepTogether([
    Paragraph("5. Open the UI", h2_style),
    Paragraph(
        "Go to <b>http://localhost:3001/</b> in your browser. The proxy serves the "
        "HTML and assets directly &mdash; the header pill turns green and shows your "
        "current league.",
        body_style,
    ),
    callout(
        "<b>PoE2 characters:</b> the \"Connect Character\" dropdown returns PoE1 "
        "characters only today &mdash; PoE2 access needs GGG OAuth, which is pending. "
        "Use the new <b>Connect via PoB2</b> button on Welcome instead: it launches "
        "PoB2 (which has approved OAuth) and ingests the resulting code automatically.",
        color=BLUE,
    ),
]))

# ── FEEDBACK + WHAT TO TEST ─────────────────────────────────────────
story.append(Paragraph("What I'd love feedback on", h1_style))
story.append(Paragraph(
    "Anything that surprises you, breaks, or feels clunky &mdash; especially:",
    body_style,
))
story.append(bullet(
    "<b>Decoder edge cases</b>: paste a PoB code that doesn't decode cleanly, or "
    "decodes wrong. Most useful if you can share the exact code so I can reproduce."
))
story.append(bullet(
    "<b>S-Rank scanner false positives / misses</b>: tell me a build that should "
    "have been flagged but wasn't (or vice versa). The rule pack is small today "
    "and grows by example."
))
story.append(bullet(
    "<b>Trade scan results that don't make sense</b>: scored too high, scored too "
    "low, missing whisper, weird sort order."
))
story.append(bullet(
    "<b>The three editors (gear / skills / tree)</b>: anything you tried to edit "
    "that the editor wouldn't let you, saved wrong, or broke the round-trip export."
))
story.append(bullet(
    "<b>PoB2 bridge</b>: the \"Connect via PoB2\" flow on Welcome &mdash; did the "
    "auto-launch work, did clipboard paste work, did your character actually land?"
))
story.append(bullet(
    "<b>UI confusion</b>: anywhere you weren't sure what to click, what was a button "
    "vs. a label, what the colors meant."
))

story.append(Paragraph("How to send it back", h1_style))
story.append(Paragraph(
    "<b>Easiest:</b> DM me directly. Screenshots help a lot.",
    body_style,
))
story.append(Paragraph(
    "<b>If you're up for it:</b> open an issue on the repo:",
    body_style,
))
story.append(code_block("https://github.com/cboyd421-max/poe2-forge/issues"))
story.append(Paragraph(
    "Include what you were doing, what you expected, what happened. If it's a "
    "decoder or scanner issue, the PoB code or build details help me reproduce.",
    body_style,
))

story.append(KeepTogether([
    Paragraph("Heads-up on timing", h2_style),
    Paragraph(
        "PoE2 0.5 (Runes of Aldur) launches <b>May 29, 2026</b>. The 24&ndash;48 hours "
        "after that, two things happen: PoE2DB ingests the new data (so Advanced "
        "Thaumaturgy fills in), and people start posting league-start build codes (so "
        "the Decoder and S-Rank scanner get a workout against real new-meta builds). "
        "Best time to give me feedback is the first week of the league, while the meta "
        "is still forming and bugs are loudest.",
        body_style,
    ),
    hr(),
    Paragraph(
        "Thanks again for testing. The whole point of this project is to make leveling "
        "and gearing in PoE2 less of a fragmented mess &mdash; you trying it and telling "
        "me what's broken is exactly what makes that happen.",
        body_style,
    ),
]))


# ── BUILD ───────────────────────────────────────────────────────────
doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=letter,
    leftMargin=0.75 * inch,
    rightMargin=0.75 * inch,
    topMargin=0.75 * inch,
    bottomMargin=0.75 * inch,
    title="POE2 Forge - Tester's Guide",
    author="POE2 Forge",
    subject="Friend tester guide for POE2 Forge v13",
)

doc.build(story)
print(f"Wrote: {OUTPUT}")
