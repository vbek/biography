"""
Nepal Election 2082 — API Scraper
==================================
Iterates district IDs 1-78 and constituency IDs 1-20 per district,
calling the results API directly. No GeoJSON needed.

District and constituency names come from the results JSON itself:
  DistrictName, StateName, SCConstID

SETUP
-----
1. browser_request.txt must exist (Copy as cURL from Chrome DevTools)
   with the X-CSRF-Token header and cookie header included.

USAGE
-----
    python scrape.py --debug       # test district 1, const 1
    python scrape.py --quick       # districts 1-78, consts 1-3 each
    python scrape.py               # full scrape
"""

import argparse, csv, json, re, sys, time
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("pip install requests")

BASE     = "https://result.election.gov.np"
MAIN_URL = BASE + "/MapElectionResult2082.aspx"
HANDLER  = BASE + "/Handlers/SecureJson.ashx?file="

# All 78 district IDs (from the dropdown we saw earlier, including 98/99=NA, 77, 78)
ALL_DISTRICT_IDS = list(range(1, 76)) + [77, 78, 98, 99]

CSV_COLUMNS = [
    "Province", "District", "Constituency",
    "Candidate Name", "Age", "Gender",
    "Political Party", "Symbol", "Votes Received", "Status", "Rank",
]

HERE      = Path(__file__).parent
OUT       = HERE / "nepal_election_results.csv"
DEV2ASCII = str.maketrans("०१२३४५६७८९", "0123456789")


def make_session():
    session = requests.Session()
    print("  [a] Fetching main page for session cookies …", end=" ", flush=True)
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    try:
        r = session.get(MAIN_URL, timeout=30)
        print(f"OK  (cookies: {list(session.cookies.keys())})")
    except Exception as e:
        print(f"WARN: {e}")
    time.sleep(1.0)

    curl_file = HERE / "browser_request.txt"
    if curl_file.exists():
        print("  [b] Loading headers from browser_request.txt …", end=" ")
        text = curl_file.read_text(encoding="utf-8", errors="ignore")
        loaded = {}
        for line in text.splitlines():
            line = line.strip().rstrip("\\").strip()
            m = re.match(r'''-H\s+['"](.+?)['"]$''', line)
            if m:
                raw = m.group(1)
                if ":" in raw:
                    name, value = raw.split(":", 1)
                    loaded[name.strip()] = value.strip()
        session.headers.update(loaded)
        # move cookie header into the session cookie jar properly
        cookie_str = loaded.get("cookie", "")
        for part in cookie_str.split(";"):
            part = part.strip()
            if "=" in part:
                k, v = part.split("=", 1)
                session.cookies.set(k.strip(), v.strip(), domain="result.election.gov.np")
        print(f"OK  ({len(loaded)} headers)")
    return session


def fetch_json(session, path, retries=3):
    url = HANDLER + path
    for attempt in range(retries):
        try:
            r = session.get(url, timeout=20)
            if r.status_code in (404, 400):
                return None        # no data for this combo
            if r.status_code == 403:
                print(f"\n  ⚠  403 on {path}")
                return None
            if r.status_code == 429:
                wait = 5 * (attempt + 1)
                print(f"\n  [rate limit] 429 — waiting {wait}s …", end=" ", flush=True)
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except json.JSONDecodeError:
            return None
        except Exception as e:
            if attempt == retries - 1:
                print(f"\n  ⚠  {path}: {e}")
                return None
            time.sleep(1.5 * (attempt + 1))


def parse_votes(val):
    if val is None: return 0
    try:
        return int(float(val))
    except (ValueError, TypeError):
        s = str(val).translate(DEV2ASCII).replace(",","").strip()
        return int(s) if s.isdigit() else 0


def fetch_constituency(session, district_id, const_id):
    """Fetch results for one constituency. Returns list of candidate dicts or []."""
    data = fetch_json(session, f"JSONFiles/Election2082/HOR/FPTP/HOR-{district_id}-{const_id}.json")
    if not data:
        return []
    candidates = data if isinstance(data, list) else next(
        (data[k] for k in ("Candidates","candidates","data","Results")
         if k in data and isinstance(data[k], list)), [])
    if not candidates:
        return []

    records = []
    for c in candidates:
        if not isinstance(c, dict): continue
        votes = parse_votes(c.get("TotalVoteReceived") or 0)
        gen   = str(c.get("Gender") or "")
        gender = "Male" if "पुरुष" in gen else "Female" if "महिला" in gen else gen.strip()

        # province and district name come from the result itself
        province = str(c.get("StateName")    or "").strip()
        district = str(c.get("DistrictName") or "").strip()
        const_no = str(c.get("SCConstID")    or const_id).strip()
        const_name = f"निर्वाचन क्षेत्र नं. {const_no}"

        records.append({
            "Province":        province,
            "District":        district,
            "Constituency":    const_name,
            "Candidate Name":  str(c.get("CandidateName")      or "").strip(),
            "Age":             str(c.get("Age")                 or "").strip(),
            "Gender":          gender,
            "Political Party": str(c.get("PoliticalPartyName")  or "").strip(),
            "Symbol":          str(c.get("SymbolName")          or "").strip(),
            "Votes Received":  votes,
            "Status":          str(c.get("Remarks")             or "").strip(),
        })

    records.sort(key=lambda r: r["Votes Received"], reverse=True)
    for i, r in enumerate(records):
        r["Rank"] = i + 1
    return records


def scrape(quick=False, debug=False):
    print("=" * 60)
    print("  Nepal Election 2082 — API Scraper")
    print("=" * 60 + "\n")

    session = make_session()

    print("\n[test] Checking API …", end=" ", flush=True)
    test = fetch_json(session, "JSONFiles/Election2082/HOR/FPTP/HOR-1-1.json")
    if test is None:
        sys.exit("\n✗ API not accessible. Check browser_request.txt.")
    print(f"OK  ({len(test)} candidates in district 1 / const 1)")

    if debug:
        print(f"\nSample keys: {list(test[0].keys()) if test else 'none'}")
        print(json.dumps(test[0], ensure_ascii=False, indent=2))
        return None

    # ── iterate all districts × constituencies ─────────────────────
    # Each district has at most ~10 constituencies; we stop at the first 404
    MAX_CONST = 3 if quick else 20
    district_ids = ALL_DISTRICT_IDS

    all_records = []
    total_found = 0

    print(f"\n[scrape] Iterating {len(district_ids)} districts × up to {MAX_CONST} constituencies …\n")

    for dist_id in district_ids:
        dist_records = []
        for const_id in range(1, MAX_CONST + 1):
            rows = fetch_constituency(session, dist_id, const_id)
            if not rows:
                break       # no more constituencies in this district
            dist_records.extend(rows)
            time.sleep(0.5)

        if dist_records:
            dist_name = dist_records[0]["District"]
            prov_name = dist_records[0]["Province"]
            n_consts  = len(set(r["Constituency"] for r in dist_records))
            print(f"  ✓ {prov_name} / {dist_name}: {n_consts} constituencies, "
                  f"{len(dist_records)} candidates")
            all_records.extend(dist_records)
            total_found += 1
        else:
            pass   # district ID not used (e.g. 98/99 = NA)
        time.sleep(0.3)

    print(f"\n[save] {len(all_records)} total candidates across {total_found} districts …")
    if not all_records:
        print("⚠  No data."); return None

    with open(OUT, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_records)
    print(f"  ✓ Saved → {OUT}")
    return OUT


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="Max 3 constituencies per district")
    ap.add_argument("--debug", action="store_true", help="Print one result and exit")
    args = ap.parse_args()
    result = scrape(quick=args.quick, debug=args.debug)
    if result:
        print("\n  Next: python build_dashboard.py")
