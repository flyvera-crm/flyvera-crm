// Reference data for the local flight-request reader (src/lib/flight-request-parser.ts): city and airport
// names with their IATA codes, and airline names with their 2-character codes. Plain data, no network.
// To add a place or airline, add a line here (lower-case name, no accents) and a test case.

/** City / airport names → IATA code. City codes (LON, NYC, PAR…) cover every airport in that city. */
export const PLACES: Record<string, string> = {
  // United Arab Emirates
  dubai: "DXB", "abu dhabi": "AUH", sharjah: "SHJ", "ras al khaimah": "RKT", "al ain": "AAN", fujairah: "FJR",
  // Gulf, Middle East, Turkey
  doha: "DOH", qatar: "DOH", "kuwait city": "KWI", kuwait: "KWI", manama: "BAH", bahrain: "BAH", muscat: "MCT", salalah: "SLL",
  riyadh: "RUH", jeddah: "JED", jedda: "JED", dammam: "DMM", medina: "MED", madinah: "MED", abha: "AHB", taif: "TIF", tabuk: "TUU",
  amman: "AMM", beirut: "BEY", damascus: "DAM", baghdad: "BGW", erbil: "EBL", basra: "BSR", tehran: "THR", "tel aviv": "TLV",
  cairo: "CAI", alexandria: "HBE", "sharm el sheikh": "SSH", hurghada: "HRG", luxor: "LXR",
  istanbul: "IST", ankara: "ESB", antalya: "AYT", izmir: "ADB", bodrum: "BJV", dalaman: "DLM", trabzon: "TZX",
  // South Asia
  delhi: "DEL", "new delhi": "DEL", mumbai: "BOM", bombay: "BOM", bangalore: "BLR", bengaluru: "BLR", chennai: "MAA", madras: "MAA",
  kolkata: "CCU", calcutta: "CCU", kochi: "COK", cochin: "COK", trivandrum: "TRV", thiruvananthapuram: "TRV", kozhikode: "CCJ",
  calicut: "CCJ", kannur: "CNN", mangalore: "IXE", goa: "GOI", ahmedabad: "AMD", pune: "PNQ", jaipur: "JAI", lucknow: "LKO",
  amritsar: "ATQ", chandigarh: "IXC", kathmandu: "KTM", colombo: "CMB", maldives: "MLE", dhaka: "DAC", chittagong: "CGP",
  sylhet: "ZYL", karachi: "KHI", lahore: "LHE", islamabad: "ISB", peshawar: "PEW", multan: "MUX", faisalabad: "LYP",
  sialkot: "SKT", quetta: "UET", kabul: "KBL",
  // East and South-East Asia, Central Asia, Caucasus
  singapore: "SIN", "kuala lumpur": "KUL", bangkok: "BKK", phuket: "HKT", "hong kong": "HKG", tokyo: "TYO", osaka: "OSA",
  seoul: "SEL", beijing: "BJS", shanghai: "SHA", guangzhou: "CAN", shenzhen: "SZX", taipei: "TPE", manila: "MNL", cebu: "CEB",
  jakarta: "JKT", bali: "DPS", denpasar: "DPS", "ho chi minh city": "SGN", "ho chi minh": "SGN", saigon: "SGN", hanoi: "HAN",
  "da nang": "DAD", "phnom penh": "PNH", yangon: "RGN", almaty: "ALA", tashkent: "TAS", baku: "GYD", tbilisi: "TBS", yerevan: "EVN",
  // Europe
  london: "LON", manchester: "MAN", edinburgh: "EDI", glasgow: "GLA", dublin: "DUB", paris: "PAR", lyon: "LYS", marseille: "MRS",
  amsterdam: "AMS", brussels: "BRU", frankfurt: "FRA", munich: "MUC", berlin: "BER", hamburg: "HAM", dusseldorf: "DUS",
  cologne: "CGN", stuttgart: "STR", zurich: "ZRH", geneva: "GVA", vienna: "VIE", prague: "PRG", budapest: "BUD", warsaw: "WAW",
  krakow: "KRK", copenhagen: "CPH", stockholm: "STO", oslo: "OSL", helsinki: "HEL", reykjavik: "REK", madrid: "MAD",
  barcelona: "BCN", malaga: "AGP", lisbon: "LIS", porto: "OPO", rome: "ROM", milan: "MIL", venice: "VCE", naples: "NAP",
  florence: "FLR", athens: "ATH", santorini: "JTR", mykonos: "JMK", larnaca: "LCA", malta: "MLA", moscow: "MOW",
  "st petersburg": "LED", "saint petersburg": "LED", belgrade: "BEG", bucharest: "BUH", sofia: "SOF", zagreb: "ZAG",
  dubrovnik: "DBV", tirana: "TIA", kyiv: "IEV", kiev: "IEV",
  // Americas
  "new york": "NYC", newark: "EWR", washington: "WAS", "washington dc": "WAS", boston: "BOS", chicago: "CHI",
  "los angeles": "LAX", "san francisco": "SFO", "san diego": "SAN", seattle: "SEA", miami: "MIA", orlando: "ORL",
  "fort lauderdale": "FLL", tampa: "TPA", atlanta: "ATL", dallas: "DFW", houston: "HOU", austin: "AUS", "las vegas": "LAS",
  denver: "DEN", phoenix: "PHX", philadelphia: "PHL", detroit: "DTT", minneapolis: "MSP", charlotte: "CLT", nashville: "BNA",
  "new orleans": "MSY", baltimore: "BWI", "salt lake city": "SLC", honolulu: "HNL", toronto: "YTO", montreal: "YMQ",
  ottawa: "YOW", vancouver: "YVR", calgary: "YYC", "mexico city": "MEX", cancun: "CUN", havana: "HAV", "punta cana": "PUJ",
  "sao paulo": "SAO", "rio de janeiro": "RIO", "buenos aires": "BUE", lima: "LIM", bogota: "BOG", santiago: "SCL",
  // Africa
  nairobi: "NBO", "addis ababa": "ADD", lagos: "LOS", abuja: "ABV", accra: "ACC", johannesburg: "JNB", "cape town": "CPT",
  durban: "DUR", casablanca: "CAS", marrakech: "RAK", marrakesh: "RAK", tunis: "TUN", algiers: "ALG", "dar es salaam": "DAR",
  zanzibar: "ZNZ", kigali: "KGL", entebbe: "EBB", kampala: "EBB", khartoum: "KRT", mauritius: "MRU", seychelles: "SEZ",
  mogadishu: "MGQ",
  // Oceania
  sydney: "SYD", melbourne: "MEL", brisbane: "BNE", perth: "PER", adelaide: "ADL", auckland: "AKL", christchurch: "CHC",
  fiji: "NAN", nadi: "NAN",
};

/** Names that could mean more than one airport: the agent is asked which. */
export const AMBIGUOUS_PLACES: Record<string, string> = {
  birmingham: "Which Birmingham: BHX (UK) or BHM (Alabama)?",
  portland: "Which Portland: PDX (Oregon) or PWM (Maine)?",
  hyderabad: "Which Hyderabad: HYD (India) or HDD (Pakistan)?",
  "san jose": "Which San Jose: SJC (California) or SJO (Costa Rica)?",
  kingston: "Which Kingston: KIN (Jamaica) or YGK (Canada)?",
  mecca: "Mecca has no airport: JED (Jeddah) or MED (Madinah)?",
  makkah: "Makkah has no airport: JED (Jeddah) or MED (Madinah)?",
};

/** Countries with several airports: the agent is asked which city. */
export const COUNTRIES = [
  "united arab emirates", "uae", "saudi arabia", "india", "pakistan", "bangladesh", "sri lanka", "nepal", "oman", "egypt", "turkey",
  "iran", "iraq", "jordan", "lebanon", "united kingdom", "uk", "england", "scotland", "ireland", "france", "germany", "italy",
  "spain", "portugal", "greece", "switzerland", "netherlands", "russia", "united states", "usa", "america", "canada", "mexico",
  "brazil", "australia", "new zealand", "china", "japan", "south korea", "thailand", "malaysia", "indonesia", "philippines",
  "vietnam", "kenya", "nigeria", "south africa", "morocco", "tanzania",
];

/** English words that are also 3-letter codes: never read as a place unless typed in capitals. */
export const CODE_WORDS = new Set([
  "man", "can", "sin", "ham", "per", "sea", "den", "mad", "add", "los", "par", "bog", "nan", "kin", "ala", "led", "beg", "vie",
  "bud", "mil", "nap", "was", "chi", "tun", "med", "dam", "mel", "tia", "the", "and", "for", "you", "all", "any", "our",
]);

/** Capitalised 3-letter words that are not airports (currencies, months, days, booking shorthand). */
export const NOT_PLACES = new Set([
  "USD", "AED", "EUR", "GBP", "INR", "PKR", "SAR", "QAR", "OMR", "KWD", "BHD", "JOD", "EGP", "TRY", "CAD", "AUD", "NZD", "SGD",
  "MYR", "THB", "PHP", "LKR", "BDT", "NPR", "CHF", "JPY", "CNY", "HKD", "ZAR", "KES",
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN",
  "THE", "AND", "FOR", "YOU", "ARE", "BUT", "NOT", "ALL", "ANY", "CAN", "HAS", "OUR", "PAX", "ADT", "CHD", "INF", "RTN", "OWR",
  "ETA", "ETD", "TBC", "TBA", "PNR", "VIP", "BIZ", "ECO", "FLY", "PLS", "PLZ", "THX", "MAX", "MIN", "APX", "AMT", "USA",
  "UAE", "KSA", "GCC", "VIA", "DOB", "AGE", "YRS", "PER", "ONE", "TWO", "SIX", "TEN", "WAY", "OUT", "OFF", "NEW", "GET",
  "DAY", "OLD", "KID", "BOY", "MUM", "MOM", "DAD", "SON", "WHO", "HOW", "WHY", "YES", "MRS", "NOW", "ASK", "PAY",
]);

/** Airline names → 2-character code. "context" names only count after "prefer", "with", "on", "fly"… */
export const AIRLINES: { name: string; code: string; context?: true }[] = [
  { name: "emirates", code: "EK" }, { name: "etihad", code: "EY" }, { name: "flydubai", code: "FZ" }, { name: "fly dubai", code: "FZ" },
  { name: "qatar airways", code: "QR" }, { name: "qatar", code: "QR", context: true }, { name: "saudia", code: "SV" },
  { name: "saudi arabian airlines", code: "SV" }, { name: "saudi", code: "SV", context: true }, { name: "flynas", code: "XY" },
  { name: "flyadeal", code: "F3" }, { name: "air arabia", code: "G9" }, { name: "gulf air", code: "GF" }, { name: "oman air", code: "WY" },
  { name: "salamair", code: "OV" }, { name: "kuwait airways", code: "KU" }, { name: "jazeera airways", code: "J9" },
  { name: "royal jordanian", code: "RJ" }, { name: "egyptair", code: "MS" }, { name: "middle east airlines", code: "ME" },
  { name: "turkish airlines", code: "TK" }, { name: "turkish", code: "TK", context: true }, { name: "pegasus", code: "PC" },
  { name: "lufthansa", code: "LH" }, { name: "british airways", code: "BA" }, { name: "virgin atlantic", code: "VS" },
  { name: "air france", code: "AF" }, { name: "klm", code: "KL" }, { name: "swiss", code: "LX", context: true },
  { name: "austrian airlines", code: "OS" }, { name: "brussels airlines", code: "SN" }, { name: "iberia", code: "IB" },
  { name: "vueling", code: "VY" }, { name: "aer lingus", code: "EI" }, { name: "ryanair", code: "FR" }, { name: "easyjet", code: "U2" },
  { name: "wizz air", code: "W6" }, { name: "wizz", code: "W6" }, { name: "finnair", code: "AY" }, { name: "lot polish", code: "LO" },
  { name: "ita airways", code: "AZ" }, { name: "alitalia", code: "AZ" }, { name: "tap air portugal", code: "TP" },
  { name: "icelandair", code: "FI" }, { name: "norwegian air", code: "DY" }, { name: "condor", code: "DE" }, { name: "eurowings", code: "EW" },
  { name: "air india", code: "AI" }, { name: "indigo", code: "6E" }, { name: "spicejet", code: "SG" }, { name: "akasa", code: "QP" },
  { name: "pakistan international", code: "PK" }, { name: "pia", code: "PK" }, { name: "airblue", code: "PA" },
  { name: "srilankan", code: "UL" }, { name: "sri lankan airlines", code: "UL" }, { name: "biman", code: "BG" },
  { name: "us-bangla", code: "BS" }, { name: "singapore airlines", code: "SQ" }, { name: "scoot", code: "TR" },
  { name: "cathay pacific", code: "CX" }, { name: "cathay", code: "CX" }, { name: "malaysia airlines", code: "MH" },
  { name: "airasia", code: "AK" }, { name: "thai airways", code: "TG" }, { name: "garuda", code: "GA" },
  { name: "philippine airlines", code: "PR" }, { name: "cebu pacific", code: "5J" }, { name: "vietnam airlines", code: "VN" },
  { name: "korean air", code: "KE" }, { name: "asiana", code: "OZ" }, { name: "japan airlines", code: "JL" },
  { name: "all nippon", code: "NH" }, { name: "air china", code: "CA" }, { name: "china southern", code: "CZ" },
  { name: "china eastern", code: "MU" }, { name: "qantas", code: "QF" }, { name: "virgin australia", code: "VA" },
  { name: "air new zealand", code: "NZ" }, { name: "american airlines", code: "AA" }, { name: "delta", code: "DL" },
  { name: "united airlines", code: "UA" }, { name: "jetblue", code: "B6" }, { name: "southwest airlines", code: "WN" },
  { name: "alaska airlines", code: "AS" }, { name: "air canada", code: "AC" }, { name: "westjet", code: "WS" },
  { name: "aeromexico", code: "AM" }, { name: "avianca", code: "AV" }, { name: "latam", code: "LA" }, { name: "copa airlines", code: "CM" },
  { name: "ethiopian", code: "ET" }, { name: "kenya airways", code: "KQ" }, { name: "rwandair", code: "WB" },
  { name: "south african airways", code: "SA" }, { name: "royal air maroc", code: "AT" }, { name: "air mauritius", code: "MK" },
  { name: "air seychelles", code: "HM" }, { name: "air astana", code: "KC" }, { name: "uzbekistan airways", code: "HY" },
  { name: "azerbaijan airlines", code: "J2" },
];

/** 2-character codes that are also common words or abbreviations: only read after "prefer", "airline" etc. */
export const AMBIGUOUS_AIRLINE_CODES = new Set(["AM", "AS", "AT", "CA", "LA", "ME", "SA", "AI", "FI", "MS", "NZ", "UK", "US", "PM", "OK", "TR", "SN", "PK", "PR", "AA"]);

export const AIRLINE_CODES = new Set(AIRLINES.map((a) => a.code));

export const CURRENCY_CODES = [
  "USD", "AED", "EUR", "GBP", "INR", "PKR", "SAR", "QAR", "OMR", "KWD", "BHD", "JOD", "EGP", "TRY", "CAD", "AUD", "NZD", "SGD",
  "MYR", "THB", "PHP", "LKR", "BDT", "NPR", "CHF", "JPY", "CNY", "HKD", "ZAR", "KES",
];
