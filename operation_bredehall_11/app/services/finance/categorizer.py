"""Rule-based transaction classification (typ + category).

Ported and significantly expanded from the Ekonomi Master ALL_DATA sheet.
This is the deterministic fallback that runs without any AI. An optional
LM Studio / OpenAI categorizer can refine the leftovers (see ai_finance.py).
"""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

# Categories used across the app (keep in sync with frontend legend)
CATEGORIES: List[str] = [
    "Lön",
    "Bidrag",
    "Ränta/Avkastning",
    "Inkomst (Swish)",
    "Övrig inkomst",
    "Livsmedel",
    "Restaurang & Uteät",
    "Systembolaget",
    "Boende & Drift",
    "Boende (el)",
    "Hushållstjänster",
    "Försäkring",
    "Skönhet & Tjänster",
    "Hälsa & Sjukvård",
    "Träning",
    "Shopping & Kläder",
    "Hem & Fritid",
    "Husdjur",
    "Streaming & Media",
    "Resor & Semester",
    "Kollektivtrafik & Taxi",
    "Bil & Transport",
    "Mobil & Bredband",
    "Bankavgifter",
    "Sparande",
    "Barn",
    "Donationer",
    "Swish (privat)",
    "CSN (Återbetalning)",
    "Bostadsköp (engång)",
    "Överföring",
    "Övrigt",
]


def sorted_categories(items: Optional[List[str]] = None) -> List[str]:
    """Return categories in Swedish alphabetical order."""
    cats = list(items if items is not None else CATEGORIES)
    try:
        import locale

        for loc in ("sv_SE.UTF-8", "Swedish_Sweden.1252", "sv_SE"):
            try:
                locale.setlocale(locale.LC_COLLATE, loc)
                return sorted(cats, key=locale.strxfrm)
            except locale.Error:
                continue
    except Exception:
        pass
    return sorted(cats, key=str.casefold)


def normalize_description(desc: str) -> str:
    """Strip card prefixes, dates and reference noise so merchant names match."""
    text = (desc or "").lower()
    # Remove common Swedish card-purchase prefixes with trailing date digits
    text = re.sub(r"\bkortk[öo]p\b\s*\d{0,6}", " ", text)
    text = re.sub(r"\bkortbetalning\b", " ", text)
    text = re.sub(r"\bautogiro\b", " ", text)
    text = re.sub(r"\bbetalning\b\s*(bg|pg)?\s*[\d-]*", " ", text)
    text = re.sub(r"\bswish\b\s*(betalning|inbetalning|mottagen|retur)?", lambda m: " swish " + (m.group(1) or "") + " ", text)
    # Strip standalone reference numbers / dates
    text = re.sub(r"\b\d{6,}\b", " ", text)
    text = re.sub(r"\b\d{2}[-/.]\d{2}[-/.]\d{2,4}\b", " ", text)
    text = re.sub(r"\*+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _match(pattern: str, text: str) -> bool:
    return bool(re.search(pattern, text, re.IGNORECASE))


# Shared el-provider matching (ASCII + Swedish spellings — bank exports often drop å/ä/ö).
EL_PROVIDER_PATTERN = (
    r"g[öo]teborg energi|gbg energi|goteborg energi|"
    r"ellevio|vattenfall|fortum|\beon\b|e\.on|dinel|kraftringen|"
    r"elnät|eln[aä]t|elhandel|elavtal|el\s*bill|tibber|greenely|bixia|telge energi|"
    r"skellefte[åa]\s*kraft|fortum\s*market|vattenfall\s*eldist|"
    r"partille energi|m[öo]lndal energi|kung[äa]lv energi|h[äa]rryda energi|"
    r"\bgeab\b|\bdin el\b|energi din el|cheap energy|boo energy|elify|"
    r"jämtkraft|jamtkraft|lule[åa] energi|ume[åa] energi|skekraft|"
    r"gotlands energi|kalmar energi|linde energi|mellanskan"
)


def is_el_expense(description: str) -> bool:
    """True when description looks like a household electricity bill/payment."""
    if not description:
        return False
    norm = normalize_description(description)
    raw = " ".join(description.split()).casefold()
    return bool(_match(EL_PROVIDER_PATTERN, norm) or _match(EL_PROVIDER_PATTERN, raw))


# Ordered most-specific → least-specific. First hit wins.
CATEGORY_RULES: List[Tuple[str, str]] = [
    (r"slutlikvid", "Bostadsköp (engång)"),
    # Income-ish (only applied to positive amounts unless typ says otherwise)
    (r"\blön\b|\blöne|salary|utbetalning lön", "Lön"),
    (r"\bcsn\b.*utbetal|studiemedel|studiebidrag|försäkringskassan|barnbidrag|bostadsbidrag|a-kassa|akassa", "Bidrag"),
    (r"\bränta\b|utdelning|återbäring|avkastning|skatteåterbäring|överskjutande skatt", "Ränta/Avkastning"),
    # Groceries
    (r"\bica\b|\bcoop\b|hemköp|hemkop|willys|lidl|city gross|citygross|mathem|tempo|pressbyrå|pressbyran|7-eleven|7eleven|\blivs\b|saluhall|matse|matsmart|handlar'?n|närlivs|nara |stora coop|\bmaxi\b|netto|x:?-?tra|foodmarket|frukt ab|tazeli|biskopsgaard|godis|fisk|bageri|market 24|24 7|oob |\boob\b|4 gott|zettle|izettle", "Livsmedel"),
    # Restaurants
    (r"restaurang|pizza|pizzeria|sushi|foodora|max burger|o'?learys|mcdonald|burger king|espresso house|\bwolt\b|starbucks|subway|\bkfc\b|chopchop|café|cafe|bistro|\bkrog\b|thai|kebab|nystekt|gateau|waynes|barista|deli|uber\s*eats|ubereats|systrarna|brödernas|taco|sushibar|olstugan|\bpub\b|tullen|food", "Restaurang & Uteät"),
    (r"systembolaget|vinmonopolet", "Systembolaget"),
    # Electricity (before general housing so el providers match first)
    (EL_PROVIDER_PATTERN, "Boende (el)"),
    # Housing & utilities (incl. Nordea mortgage debits — not internal transfers)
    (r"\bhyra\b|\bhsb\b|bolån|brf\b|samfällighet|amorter|omsättning lån|låneomsättning|oms\.? lån|tekniska verken|fjärrvärme|renhållning|sophämtning|va-avgift|hyresavi", "Boende & Drift"),
    (r"hemfrid|veterankraft|städ|flyttstäd|sotning|securitas|verisure|sector alarm|larm\b|trädgård", "Hushållstjänster"),
    # Insurance
    (r"lassie|agria|folksam|\btrygg\b|trygg-hansa|if skade|if skadeförs|svedea|moderna försäkr|hedvig|tandvård försäkr|nordea liv|livförsäkring|länsförsäkring|lansforsakring|dina försäkr|gjensidige|ica försäkr", "Försäkring"),
    (r"frisör|frisor|klippning|salong|barber|hudvård|hudvard|massage|nagel|skönhetss|skonhet|spa\b", "Skönhet & Tjänster"),
    (r"apotek|kronans|\bdoz\b|apotea|apoteket|lloyds|hjärtat|doktor|\bkry\b|min doktor|1177|vårdcentral|vardcentral|tandläkare|tandlakare|folktandvård|frisktandvård|frisktandv|capio|aleris|sjukhus|optiker|synsam|specsavers|lentiamo|smarteyes|synoptik|medicin|västra götal|vastra gotal|regionen|patientavgift|närhälsan|narhalsan", "Hälsa & Sjukvård"),
    (r"\bgym\b|friskis|\bsats\b|nordic wellness|fitness24seven|fitness 24|gymgrossis|actic|24seven|stc träning|crossfit|padel|klättr", "Träning"),
    # Pets
    (r"arken zoo|djurmagazinet|zoo\.se|dogman|furry fam|din veterinär|veterinär|veterinar|\bmusti\b|vetzoo|djuraffär|hundfoder|kattfoder|\bzoo\b", "Husdjur"),
    # Shopping
    (r"klarna|\bh&m\b|\bhm\b|zara|stadium|intersport|lager 157|åhléns|ahlens|lindex|kappahl|cubus|dressmann|gina tricot|mq\b|ellos|nelly|boozt|zalando|new yorker|uniqlo|nike|adidas|kicks|lyko|sephora|normal\b|flying tiger|vinted|temu|shein|wish\.com|aliexpress|amazon|riverty|dollarstore|dollar store|second han|jollyroom|babyworld", "Shopping & Kläder"),
    (r"ikea|jysk|rusta|clas ohlson|claes ohlson|kjell ?& ?co|kjell o co|panduro|blomsterland|plantagen|bauhaus|hornbach|biltema|\bjula\b|granngård|byggmax|hornbach|k-rauta|krauta|ahlsell|järnia|hemtex|mio\b| em home|royal design|akademibokhand|adlibris|bokus|bonnier|bokhandel|liseberg|gröna lund|grona lund|universeum|nöjespark", "Hem & Fritid"),
    (r"netflix|spotify|\bhbo\b|max\.com|help\.max|disney|youtube|prime video|amazon prime|\bsteam\b|steamgames|nextory|storytel|sf bio|filmstaden|ticketmaster|nintendo|playstation|patreon|nowo|viaplay|tv4 play|c more|cmore|audible|apple\.com/bill|\bgoogle\b|icloud|microsoft|adobe|twitch|onlyfans|notion|chatgpt|openai|anthropic|claude", "Streaming & Media"),
    (r"hotell|booking\.com|hotels\.com|airbnb|scandic|strawberry|elite hotel|first hotel|\bflyg\b|\bsas\b|norwegian|ryanair|swedavia|arlanda|landvetter|tui\b|ving\b|apollo|resia|trivago|expedia", "Resor & Semester"),
    (r"västtrafik|vasttrafik|\bsj\b|skånetrafik|skanetrafik|\bsl\b|mälartåg|malartag|länstrafik|\bvy\b|taxi|uber\b|\bbolt\b|cabonline|taxi kurir|taxi göteborg|flixbus|\bvoi\b|voi se|tier|lime|bird|elsparkcykel", "Kollektivtrafik & Taxi"),
    (r"bensin|circle k|circlek|\bingo\b|okq8|preem\b|tankning|\bst1\b|tanka\b|qstar|parkering|easypark|\baimo\b|apcoa|p-bolaget|q-park|bilprovning|besiktning|trängselskat|trangselskat|transportstyrelsen|ziklo|incharge|laddning|elbil|mekonomen|biltema bil|däck|hedin|verkstad|bilia|bildelar|autoexperten|fordon|car to go|sunfleet|m sverige|bilpool|digital charging|recharge|fortum charge|virta", "Bil & Transport"),
    (r"telia|telenor|tele2|\btre\b|halebop|bredband|comviq|hallon|vimla|sappa|bahnhof|bredband2|fello|chilimobil|telavox", "Mobil & Bredband"),
    (r"vardagspaket|\bavgift\b|kortavgift|årsavgift|aviavgift|påminnelseavgift|dröjsmål|bankavgift|nordea.*avgift|swedbank.*avgift|ratsit|open banking|pris internetbet|pris bankkort|pris kort|preliminär skatt|prelimin.r skatt", "Bankavgifter"),
    (r"lysa|savings|sparkonto|fondkonto|avanza|nordnet|isk\b|månadssparande|buffert", "Sparande"),
    (r"\bbvc\b|förskola|forskola|fritids|barnomsorg|babybjörn|babyland|leksak|toys.?r.?us|lekia|barnens", "Barn"),
    (r"djurens rätt|rädda barnen|radda barnen|läkare utan|unicef|röda kors|roda kors|greenpeace|wwf|amnesty|stadsmission|musikhjälpen|insamling|\bgåva\b|\bbris\b|plan intern|hyresgästför|hyresgastfor|transportarbetar|sv\.? *transp|sv\.? *arbetste|akademiker|fackförbund|fackavgift|a-?kassa|unionen|kommunal\b|if metall", "Donationer"),
    (r"\bcsn\b", "CSN (Återbetalning)"),
]


def classify_typ(
    amount: float,
    description: str,
    sender: Optional[str],
    receiver: Optional[str],
    own_accounts_regex: str,
) -> str:
    desc = (description or "").lower()
    sender_s = sender or ""
    receiver_s = receiver or ""

    transfer_text = _match(
        r"egen överföring|överföring mellan|mellan konton|lysa spar|\bsavings\b|"
        r"överföring \d|överf\b.*spar|spar.*överf|"
        r"extraamortering",
        desc,
    )
    own = own_accounts_regex or ""
    transfer_out = amount < 0 and own and bool(re.search(own, receiver_s, re.IGNORECASE))
    transfer_in = amount > 0 and own and bool(re.search(own, sender_s, re.IGNORECASE))

    if transfer_out or transfer_in or transfer_text:
        return "Överföring"

    priority_income = _match(r"\blön\b|\blöne|csn|utdelning|skatteverket|skatteåterbäring|bidrag|barnbidrag|swish.*mottag", desc)
    if priority_income and amount > 0:
        return "Inkomst"

    if amount > 0:
        return "Inkomst"
    if amount < 0:
        return "Utgift"
    return "Övrigt"


def categorize(
    description: str,
    typ: str,
    amount: float = 0.0,
    manual_category: Optional[str] = None,
) -> str:
    if manual_category and manual_category.strip():
        return manual_category.strip()
    if typ == "Överföring":
        return "Överföring"

    norm = normalize_description(description)

    # Swish income heuristic
    if typ == "Inkomst" and amount > 0 and _match(r"swish", description or ""):
        return "Inkomst (Swish)"

    for pattern, label in CATEGORY_RULES:
        if label == "Boende (el)" and is_el_expense(description):
            if typ == "Inkomst":
                continue
            return label
        if _match(pattern, norm):
            # Income rows shouldn't be tagged as an expense category
            if typ == "Inkomst" and label not in (
                "Lön", "Bidrag", "Ränta/Avkastning", "Inkomst (Swish)", "Sparande", "Donationer", "Husdjur",
            ):
                continue
            return label

    # Outgoing Swish that didn't match a known merchant = private person-to-person
    if _match(r"\bswish\b", description or ""):
        return "Swish (privat)"

    if typ == "Inkomst" and amount > 0:
        return "Övrig inkomst"
    return "Övrigt"


def enrich_transaction(row: dict, own_accounts_regex: str) -> dict:
    typ = classify_typ(
        row["amount"],
        row.get("description") or "",
        row.get("sender"),
        row.get("receiver"),
        own_accounts_regex,
    )
    category = categorize(
        row.get("description") or "",
        typ,
        amount=row.get("amount", 0.0),
        manual_category=row.get("manual_category"),
    )
    row["typ"] = typ
    row["category"] = category
    return row
