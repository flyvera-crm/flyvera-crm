// Reference data for the local flight-request reader (src/lib/flight-request-parser.ts): cities, airports
// and countries with their IATA codes, and airlines with their 2-character codes. Plain data, no network.
// Names are lower-case without accents. To add a place or airline, add a line here and a test case.
// A city code (LON, NYC, PAR…) covers every airport in that city.

/** City, airport and single-airport country names → IATA code. */
export const PLACES: Record<string, string> = {
  // ── United Arab Emirates ──
  dubai: "DXB", "dubai international": "DXB", "al maktoum": "DWC", "dubai world central": "DWC", "abu dhabi": "AUH",
  "zayed international": "AUH", sharjah: "SHJ", "ras al khaimah": "RKT", "al ain": "AAN", fujairah: "FJR",
  // ── Gulf, Levant, Iraq, Iran ──
  doha: "DOH", hamad: "DOH", qatar: "DOH", "kuwait city": "KWI", kuwait: "KWI", manama: "BAH", bahrain: "BAH",
  muscat: "MCT", salalah: "SLL", sohar: "OHS", riyadh: "RUH", "king khalid": "RUH", jeddah: "JED", jedda: "JED",
  "king abdulaziz": "JED", dammam: "DMM", medina: "MED", madinah: "MED", abha: "AHB", taif: "TIF", tabuk: "TUU",
  "al ula": "ULH", alula: "ULH", gassim: "ELQ", qassim: "ELQ", jazan: "GIZ", jizan: "GIZ", "ha'il": "HAS", yanbu: "YNB",
  amman: "AMM", "queen alia": "AMM", aqaba: "AQJ", beirut: "BEY", lebanon: "BEY", damascus: "DAM", baghdad: "BGW",
  erbil: "EBL", basra: "BSR", najaf: "NJF", sulaymaniyah: "ISU", tehran: "THR", "imam khomeini": "IKA", mashhad: "MHD",
  shiraz: "SYZ", isfahan: "IFN", "tel aviv": "TLV", "ben gurion": "TLV",
  // ── Egypt, Turkey, Cyprus ──
  cairo: "CAI", alexandria: "HBE", "sharm el sheikh": "SSH", hurghada: "HRG", luxor: "LXR", aswan: "ASW", "marsa alam": "RMF",
  istanbul: "IST", "istanbul airport": "IST", "sabiha gokcen": "SAW", ankara: "ESB", antalya: "AYT", izmir: "ADB",
  bodrum: "BJV", dalaman: "DLM", trabzon: "TZX", kayseri: "ASR", cappadocia: "NAV", nevsehir: "NAV", gaziantep: "GZT",
  konya: "KYA", larnaca: "LCA", paphos: "PFO",
  // ── South Asia ──
  delhi: "DEL", "new delhi": "DEL", "indira gandhi": "DEL", mumbai: "BOM", bombay: "BOM", "chhatrapati shivaji": "BOM",
  bangalore: "BLR", bengaluru: "BLR", kempegowda: "BLR", chennai: "MAA", madras: "MAA", kolkata: "CCU", calcutta: "CCU",
  kochi: "COK", cochin: "COK", trivandrum: "TRV", thiruvananthapuram: "TRV", kozhikode: "CCJ", calicut: "CCJ", kannur: "CNN",
  mangalore: "IXE", mangaluru: "IXE", ahmedabad: "AMD", pune: "PNQ", jaipur: "JAI", lucknow: "LKO", amritsar: "ATQ",
  chandigarh: "IXC", srinagar: "SXR", varanasi: "VNS", patna: "PAT", bhubaneswar: "BBI", guwahati: "GAU", nagpur: "NAG",
  indore: "IDR", coimbatore: "CJB", madurai: "IXM", trichy: "TRZ", tiruchirappalli: "TRZ", visakhapatnam: "VTZ", vizag: "VTZ",
  vijayawada: "VGA", bagdogra: "IXB", leh: "IXL", udaipur: "UDR", jodhpur: "JDH", raipur: "RPR", ranchi: "IXR",
  dehradun: "DED", surat: "STV", vadodara: "BDQ", karachi: "KHI", lahore: "LHE", "allama iqbal": "LHE",
  islamabad: "ISB", peshawar: "PEW", multan: "MUX", faisalabad: "LYP", sialkot: "SKT", quetta: "UET", skardu: "KDU",
  dhaka: "DAC", chittagong: "CGP", chattogram: "CGP", sylhet: "ZYL", "cox's bazar": "CXB", "coxs bazar": "CXB",
  kathmandu: "KTM", colombo: "CMB", "sri lanka": "CMB", bandaranaike: "CMB", maldives: "MLE", velana: "MLE", gan: "GAN",
  paro: "PBH", bhutan: "PBH", kabul: "KBL",
  // ── East Asia ──
  tokyo: "TYO", narita: "NRT", haneda: "HND", osaka: "OSA", kansai: "KIX", nagoya: "NGO", sapporo: "SPK", fukuoka: "FUK",
  okinawa: "OKA", seoul: "SEL", incheon: "ICN", gimpo: "GMP", busan: "PUS", jeju: "CJU", beijing: "BJS",
  "beijing capital": "PEK", daxing: "PKX", shanghai: "SHA", pudong: "PVG", hongqiao: "SHA", guangzhou: "CAN",
  shenzhen: "SZX", chengdu: "CTU", chongqing: "CKG", "xi'an": "XIY", xian: "XIY", hangzhou: "HGH", kunming: "KMG",
  xiamen: "XMN", wuhan: "WUH", nanjing: "NKG", qingdao: "TAO", sanya: "SYX", haikou: "HAK", "hong kong": "HKG",
  "chek lap kok": "HKG", macau: "MFM", macao: "MFM", taipei: "TPE", taoyuan: "TPE", kaohsiung: "KHH", ulaanbaatar: "UBN",
  // ── South-East Asia ──
  singapore: "SIN", changi: "SIN", "kuala lumpur": "KUL", klia: "KUL", penang: "PEN", langkawi: "LGK",
  "kota kinabalu": "BKI", kuching: "KCH", "johor bahru": "JHB", bangkok: "BKK", suvarnabhumi: "BKK", "don mueang": "DMK",
  phuket: "HKT", "chiang mai": "CNX", krabi: "KBV", "koh samui": "USM", samui: "USM", jakarta: "JKT",
  "soekarno hatta": "CGK", bali: "DPS", denpasar: "DPS", surabaya: "SUB", yogyakarta: "YIA", lombok: "LOP", medan: "KNO",
  manila: "MNL", "ninoy aquino": "MNL", cebu: "CEB", "clark airport": "CRK", davao: "DVO", boracay: "MPH", caticlan: "MPH",
  "ho chi minh city": "SGN", "ho chi minh": "SGN", saigon: "SGN", hanoi: "HAN", "da nang": "DAD", danang: "DAD",
  "phu quoc": "PQC", "nha trang": "CXR", "cam ranh": "CXR", "siem reap": "SAI", vientiane: "VTE", "luang prabang": "LPQ",
  yangon: "RGN", mandalay: "MDL", brunei: "BWN", "bandar seri begawan": "BWN", dili: "DIL",
  // ── Central Asia, Caucasus ──
  almaty: "ALA", astana: "NQZ", tashkent: "TAS", samarkand: "SKD", bukhara: "BHK", bishkek: "FRU", dushanbe: "DYU",
  ashgabat: "ASB", baku: "GYD", azerbaijan: "GYD", tbilisi: "TBS", batumi: "BUS", kutaisi: "KUT", yerevan: "EVN", armenia: "EVN",
  // ── United Kingdom, Ireland ──
  london: "LON", heathrow: "LHR", gatwick: "LGW", stansted: "STN", luton: "LTN", "london city": "LCY", southend: "SEN",
  manchester: "MAN", edinburgh: "EDI", glasgow: "GLA", aberdeen: "ABZ", bristol: "BRS", liverpool: "LPL", newcastle: "NCL",
  leeds: "LBA", "east midlands": "EMA", belfast: "BFS", cardiff: "CWL", dublin: "DUB", cork: "ORK", shannon: "SNN",
  // ── Western Europe ──
  paris: "PAR", "charles de gaulle": "CDG", orly: "ORY", beauvais: "BVA", lyon: "LYS", marseille: "MRS", toulouse: "TLS",
  bordeaux: "BOD", nantes: "NTE", strasbourg: "SXB", "nice airport": "NCE", "nice cote d'azur": "NCE", basel: "BSL",
  amsterdam: "AMS", schiphol: "AMS", rotterdam: "RTM", eindhoven: "EIN", brussels: "BRU", zaventem: "BRU", charleroi: "CRL",
  luxembourg: "LUX", frankfurt: "FRA", munich: "MUC", berlin: "BER", hamburg: "HAM", dusseldorf: "DUS", cologne: "CGN",
  stuttgart: "STR", hanover: "HAJ", hannover: "HAJ", nuremberg: "NUE", leipzig: "LEJ", dresden: "DRS", bremen: "BRE",
  zurich: "ZRH", geneva: "GVA", vienna: "VIE", salzburg: "SZG", innsbruck: "INN",
  // ── Southern Europe ──
  madrid: "MAD", barajas: "MAD", barcelona: "BCN", "el prat": "BCN", malaga: "AGP", palma: "PMI", mallorca: "PMI",
  majorca: "PMI", ibiza: "IBZ", alicante: "ALC", valencia: "VLC", seville: "SVQ", sevilla: "SVQ", bilbao: "BIO",
  tenerife: "TCI", "gran canaria": "LPA", "las palmas": "LPA", lanzarote: "ACE", fuerteventura: "FUE", lisbon: "LIS",
  porto: "OPO", faro: "FAO", madeira: "FNC", funchal: "FNC", "ponta delgada": "PDL", rome: "ROM", fiumicino: "FCO",
  ciampino: "CIA", milan: "MIL", malpensa: "MXP", linate: "LIN", bergamo: "BGY", venice: "VCE", naples: "NAP",
  florence: "FLR", bologna: "BLQ", turin: "TRN", torino: "TRN", pisa: "PSA", catania: "CTA", palermo: "PMO", bari: "BRI",
  cagliari: "CAG", olbia: "OLB", verona: "VRN", genoa: "GOA", athens: "ATH", thessaloniki: "SKG", heraklion: "HER",
  rhodes: "RHO", corfu: "CFU", chania: "CHQ", kos: "KGS", zakynthos: "ZTH", santorini: "JTR", mykonos: "JMK", malta: "MLA",
  valletta: "MLA",
  // ── Central, Northern and Eastern Europe ──
  copenhagen: "CPH", billund: "BLL", aarhus: "AAR", stockholm: "STO", arlanda: "ARN", gothenburg: "GOT", oslo: "OSL",
  bergen: "BGO", stavanger: "SVG", trondheim: "TRD", tromso: "TOS", helsinki: "HEL", finland: "HEL", reykjavik: "REK",
  keflavik: "KEF", iceland: "KEF", prague: "PRG", "czech republic": "PRG", czechia: "PRG", brno: "BRQ", bratislava: "BTS",
  budapest: "BUD", hungary: "BUD", warsaw: "WAW", krakow: "KRK", gdansk: "GDN", wroclaw: "WRO", katowice: "KTW",
  poznan: "POZ", bucharest: "BUH", otopeni: "OTP", "cluj napoca": "CLJ", cluj: "CLJ", timisoara: "TSR", sofia: "SOF",
  varna: "VAR", burgas: "BOJ", belgrade: "BEG", serbia: "BEG", zagreb: "ZAG", dubrovnik: "DBV", zadar: "ZAD", pula: "PUY",
  ljubljana: "LJU", slovenia: "LJU", sarajevo: "SJJ", podgorica: "TGD", tivat: "TIV", skopje: "SKP", pristina: "PRN",
  tirana: "TIA", albania: "TIA", riga: "RIX", latvia: "RIX", vilnius: "VNO", lithuania: "VNO", tallinn: "TLL", estonia: "TLL",
  minsk: "MSQ", kyiv: "IEV", kiev: "IEV", boryspil: "KBP", moscow: "MOW", sheremetyevo: "SVO", domodedovo: "DME",
  vnukovo: "VKO", "st petersburg": "LED", "saint petersburg": "LED", pulkovo: "LED", kazan: "KZN", sochi: "AER",
  yekaterinburg: "SVX", ekaterinburg: "SVX", novosibirsk: "OVB",
  // ── United States ──
  "new york": "NYC", jfk: "JFK", laguardia: "LGA", newark: "EWR", washington: "WAS", "washington dc": "WAS",
  dulles: "IAD", "reagan national": "DCA", boston: "BOS", chicago: "CHI", "o'hare": "ORD", ohare: "ORD",
  "los angeles": "LAX", "san francisco": "SFO", oakland: "OAK", sacramento: "SMF", "san diego": "SAN",
  "orange county": "SNA", burbank: "BUR", "long beach": "LGB", "palm springs": "PSP", seattle: "SEA", miami: "MIA",
  orlando: "MCO", "fort lauderdale": "FLL", tampa: "TPA", "fort myers": "RSW", "west palm beach": "PBI", jacksonville: "JAX",
  atlanta: "ATL", dallas: "DFW", houston: "HOU", austin: "AUS", "san antonio": "SAT", "el paso": "ELP", "las vegas": "LAS",
  denver: "DEN", phoenix: "PHX", tucson: "TUS", albuquerque: "ABQ", "salt lake city": "SLC", philadelphia: "PHL",
  pittsburgh: "PIT", detroit: "DTT", cleveland: "CLE", cincinnati: "CVG", indianapolis: "IND", minneapolis: "MSP",
  "kansas city": "MCI", "st louis": "STL", "saint louis": "STL", "oklahoma city": "OKC", memphis: "MEM", nashville: "BNA",
  louisville: "SDF", "new orleans": "MSY", charlotte: "CLT", raleigh: "RDU", "raleigh durham": "RDU", richmond: "RIC",
  norfolk: "ORF", baltimore: "BWI", hartford: "BDL", providence: "PVD", buffalo: "BUF", savannah: "SAV", charleston: "CHS",
  honolulu: "HNL", maui: "OGG", kahului: "OGG", kona: "KOA", anchorage: "ANC", "san juan": "SJU", "puerto rico": "SJU",
  // ── Canada, Mexico, Caribbean, Central America ──
  toronto: "YTO", montreal: "YMQ", vancouver: "YVR", calgary: "YYC", edmonton: "YEG",
  ottawa: "YOW", winnipeg: "YWG", halifax: "YHZ", "quebec city": "YQB", "mexico city": "MEX", cancun: "CUN",
  guadalajara: "GDL", monterrey: "MTY", "los cabos": "SJD", cabo: "SJD", "puerto vallarta": "PVR", tijuana: "TIJ",
  havana: "HAV", "punta cana": "PUJ", "santo domingo": "SDQ", "montego bay": "MBJ", nassau: "NAS", barbados: "BGI",
  aruba: "AUA", curacao: "CUR", "port of spain": "POS", trinidad: "POS", "panama city": "PTY", panama: "PTY",
  guatemala: "GUA", "guatemala city": "GUA", "san salvador": "SAL", managua: "MGA", "costa rica": "SJO",
  // ── South America ──
  "sao paulo": "SAO", guarulhos: "GRU", "rio de janeiro": "RIO", rio: "RIO", galeao: "GIG", brasilia: "BSB",
  salvador: "SSA", recife: "REC", fortaleza: "FOR", "belo horizonte": "CNF", "porto alegre": "POA", curitiba: "CWB",
  manaus: "MAO", "buenos aires": "BUE", ezeiza: "EZE", aeroparque: "AEP", mendoza: "MDZ", santiago: "SCL", chile: "SCL",
  lima: "LIM", peru: "LIM", cusco: "CUZ", cuzco: "CUZ", bogota: "BOG", medellin: "MDE", cartagena: "CTG", cali: "CLO",
  quito: "UIO", guayaquil: "GYE", caracas: "CCS", "la paz": "LPB", asuncion: "ASU", montevideo: "MVD", uruguay: "MVD",
  "punta del este": "PDP",
  // ── Africa ──
  nairobi: "NBO", mombasa: "MBA", "addis ababa": "ADD", bole: "ADD", ethiopia: "ADD", lagos: "LOS", abuja: "ABV",
  "port harcourt": "PHC", kano: "KAN", accra: "ACC", ghana: "ACC", johannesburg: "JNB", "cape town": "CPT", durban: "DUR",
  casablanca: "CMN", marrakech: "RAK", marrakesh: "RAK", fez: "FEZ", tangier: "TNG", agadir: "AGA", rabat: "RBA",
  tunis: "TUN", djerba: "DJE", monastir: "MIR", enfidha: "NBE", algiers: "ALG", oran: "ORN", benghazi: "BEN",
  "dar es salaam": "DAR", zanzibar: "ZNZ", kilimanjaro: "JRO", kigali: "KGL", rwanda: "KGL", entebbe: "EBB", kampala: "EBB",
  uganda: "EBB", khartoum: "KRT", juba: "JUB", djibouti: "JIB", asmara: "ASM", mogadishu: "MGQ", hargeisa: "HGA",
  harare: "HRE", "victoria falls": "VFA", lusaka: "LUN", lilongwe: "LLW", maputo: "MPM", windhoek: "WDH", namibia: "WDH",
  gaborone: "GBE", antananarivo: "TNR", mauritius: "MRU", "port louis": "MRU", seychelles: "SEZ", mahe: "SEZ",
  "reunion island": "RUN", "la reunion": "RUN", dakar: "DSS", senegal: "DSS", abidjan: "ABJ", bamako: "BKO", ouagadougou: "OUA", conakry: "CKY",
  freetown: "FNA", monrovia: "ROB", lome: "LFW", cotonou: "COO", douala: "DLA", yaounde: "NSI", libreville: "LBV",
  kinshasa: "FIH", brazzaville: "BZV", bujumbura: "BJM", nouakchott: "NKC", niamey: "NIM", ndjamena: "NDJ",
  // ── Oceania ──
  sydney: "SYD", melbourne: "MEL", brisbane: "BNE", perth: "PER", adelaide: "ADL", "gold coast": "OOL", cairns: "CNS",
  darwin: "DRW", hobart: "HBA", canberra: "CBR", auckland: "AKL", wellington: "WLG", christchurch: "CHC", queenstown: "ZQN",
  fiji: "NAN", nadi: "NAN", suva: "SUV", tahiti: "PPT", papeete: "PPT", noumea: "NOU", "port moresby": "POM", apia: "APW",
  samoa: "APW", "nuku'alofa": "TBU", tonga: "TBU", rarotonga: "RAR", guam: "GUM", saipan: "SPN",
};

/** Names that could mean more than one airport: the agent is asked which. */
export const AMBIGUOUS_PLACES: Record<string, string> = {
  birmingham: "Which Birmingham: BHX (UK) or BHM (Alabama)?",
  portland: "Which Portland: PDX (Oregon) or PWM (Maine)?",
  hyderabad: "Which Hyderabad: HYD (India) or HDD (Pakistan)?",
  "san jose": "Which San Jose: SJC (California) or SJO (Costa Rica)?",
  kingston: "Which Kingston: KIN (Jamaica) or YGK (Canada)?",
  columbus: "Which Columbus: CMH (Ohio) or CSG (Georgia)?",
  goa: "Which Goa airport: GOI (Dabolim) or GOX (Mopa)?",
  tripoli: "Which Tripoli: MJI (Libya)? Tripoli, Lebanon, is served by BEY (Beirut).",
  cordoba: "Which Córdoba: COR (Argentina) or ODB (Spain)?",
  victoria: "Which Victoria: YYJ (Canada), VFA (Victoria Falls) or SEZ (Seychelles)?",
  mecca: "Mecca has no airport: JED (Jeddah) or MED (Madinah)?",
  makkah: "Makkah has no airport: JED (Jeddah) or MED (Madinah)?",
};

/** Countries and regions with several airports: the agent is asked which, with the main ones listed. */
export const REGIONS: Record<string, string[]> = {
  "united arab emirates": ["DXB", "AUH", "SHJ"], uae: ["DXB", "AUH", "SHJ"],
  "saudi arabia": ["RUH", "JED", "DMM", "MED"], ksa: ["RUH", "JED", "DMM", "MED"], oman: ["MCT", "SLL"],
  egypt: ["CAI", "HRG", "SSH"], turkey: ["IST", "SAW", "AYT", "ESB"], turkiye: ["IST", "SAW", "AYT", "ESB"],
  iran: ["IKA", "MHD", "SYZ"], iraq: ["BGW", "EBL", "BSR", "NJF"], jordan: ["AMM", "AQJ"], cyprus: ["LCA", "PFO"],
  india: ["DEL", "BOM", "BLR", "MAA", "HYD", "CCU", "COK"], kerala: ["COK", "TRV", "CCJ", "CNN"],
  pakistan: ["KHI", "LHE", "ISB"], bangladesh: ["DAC", "CGP", "ZYL"], nepal: ["KTM"],
  "united kingdom": ["LHR", "LGW", "MAN", "BHX", "EDI"], uk: ["LHR", "LGW", "MAN", "BHX", "EDI"],
  england: ["LHR", "LGW", "MAN", "BHX"], scotland: ["EDI", "GLA", "ABZ"], ireland: ["DUB", "ORK", "SNN"],
  france: ["CDG", "ORY", "NCE", "LYS"], germany: ["FRA", "MUC", "BER", "DUS", "HAM"], italy: ["FCO", "MXP", "VCE", "NAP"],
  spain: ["MAD", "BCN", "AGP", "PMI"], portugal: ["LIS", "OPO", "FAO"], greece: ["ATH", "SKG", "HER"],
  switzerland: ["ZRH", "GVA", "BSL"], netherlands: ["AMS", "EIN", "RTM"], holland: ["AMS", "EIN", "RTM"],
  belgium: ["BRU", "CRL"], austria: ["VIE", "SZG"], croatia: ["ZAG", "SPU", "DBV"], poland: ["WAW", "KRK", "GDN"],
  sweden: ["ARN", "GOT"], norway: ["OSL", "BGO"], denmark: ["CPH", "BLL"], romania: ["OTP", "CLJ"],
  bulgaria: ["SOF", "VAR", "BOJ"], russia: ["SVO", "DME", "LED"], ukraine: ["KBP"], georgia: ["TBS", "BUS", "KUT", "ATL"],
  "united states": ["JFK", "LAX", "ORD", "MIA", "IAD", "SFO"], usa: ["JFK", "LAX", "ORD", "MIA", "IAD", "SFO"],
  america: ["JFK", "LAX", "ORD", "MIA", "IAD", "SFO"], florida: ["MIA", "MCO", "TPA", "FLL"],
  california: ["LAX", "SFO", "SAN", "SJC"], texas: ["DFW", "IAH", "AUS", "SAT"], hawaii: ["HNL", "OGG", "KOA"],
  canada: ["YYZ", "YVR", "YUL", "YYC"], mexico: ["MEX", "CUN", "GDL"], brazil: ["GRU", "GIG", "BSB"],
  argentina: ["EZE", "AEP"], colombia: ["BOG", "MDE", "CTG"], cuba: ["HAV", "VRA"], "dominican republic": ["PUJ", "SDQ"],
  jamaica: ["MBJ", "KIN"], bahamas: ["NAS"], ecuador: ["UIO", "GYE"],
  australia: ["SYD", "MEL", "BNE", "PER"], "new zealand": ["AKL", "CHC", "WLG"], china: ["PEK", "PVG", "CAN"],
  japan: ["HND", "NRT", "KIX"], "south korea": ["ICN", "GMP", "PUS"], korea: ["ICN", "GMP", "PUS"],
  taiwan: ["TPE", "KHH"], thailand: ["BKK", "DMK", "HKT", "CNX"], malaysia: ["KUL", "PEN", "BKI"],
  indonesia: ["CGK", "DPS", "SUB"], philippines: ["MNL", "CEB", "CRK"], vietnam: ["SGN", "HAN", "DAD"],
  cambodia: ["SAI"], laos: ["VTE", "LPQ"], myanmar: ["RGN", "MDL"], uzbekistan: ["TAS", "SKD"], kazakhstan: ["ALA", "NQZ"],
  kenya: ["NBO", "MBA"], nigeria: ["LOS", "ABV", "PHC"], "south africa": ["JNB", "CPT", "DUR"], morocco: ["CMN", "RAK", "AGA"],
  tanzania: ["DAR", "JRO", "ZNZ"], tunisia: ["TUN", "DJE", "NBE"], algeria: ["ALG", "ORN"], zimbabwe: ["HRE", "VFA"],
};

/** English words that are also 3-letter airport codes: read as an airport only if typed in capitals. */
export const CODE_WORDS = new Set([
  "man", "can", "sin", "ham", "per", "sea", "den", "mad", "add", "los", "par", "bog", "nan", "kin", "ala", "led", "beg", "vie",
  "bud", "mil", "nap", "was", "chi", "tun", "med", "dam", "mel", "tia", "the", "and", "for", "you", "all", "any", "our", "bus",
  "sun", "fun", "gan", "aer", "run", "cur", "pos", "sal", "rio", "jam", "bar", "big", "car", "cat", "fly", "hot", "key", "lap",
]);

/** Capitalised 3-letter words that are not airports (currencies, months, days, booking shorthand). */
export const NOT_PLACES = new Set([
  "USD", "AED", "EUR", "GBP", "INR", "PKR", "SAR", "QAR", "OMR", "KWD", "BHD", "JOD", "EGP", "TRY", "CAD", "AUD", "NZD", "SGD",
  "MYR", "THB", "PHP", "LKR", "BDT", "NPR", "CHF", "JPY", "CNY", "HKD", "ZAR", "KES", "NGN", "MAD", "IDR", "VND", "KRW", "RUB",
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN",
  "THE", "AND", "FOR", "YOU", "ARE", "BUT", "NOT", "ALL", "ANY", "CAN", "HAS", "OUR", "PAX", "ADT", "CHD", "INF", "RTN", "OWR",
  "ETA", "ETD", "TBC", "TBA", "PNR", "VIP", "BIZ", "ECO", "FLY", "PLS", "PLZ", "THX", "MAX", "MIN", "APX", "AMT", "USA",
  "UAE", "KSA", "GCC", "VIA", "DOB", "AGE", "YRS", "PER", "ONE", "TWO", "SIX", "TEN", "WAY", "OUT", "OFF", "NEW", "GET",
  "DAY", "OLD", "KID", "BOY", "MUM", "MOM", "DAD", "SON", "WHO", "HOW", "WHY", "YES", "MRS", "NOW", "ASK", "PAY", "BAG",
  "BAGS", "LBS", "KGS", "CNX", "REQ", "PSG", "SSR", "UMNR", "WCH", "ASAP", "NRF", "FLX", "MCT", "TKT", "EMD", "RBD", "ARR", "DEP",
]);

/** Airline names → 2-character code. "context" names only count after "prefer", "with", "on", "fly"… */
export const AIRLINES: { name: string; code: string; context?: true }[] = [
  // Gulf and Middle East
  { name: "emirates", code: "EK" }, { name: "etihad", code: "EY" }, { name: "flydubai", code: "FZ" }, { name: "fly dubai", code: "FZ" },
  { name: "qatar airways", code: "QR" }, { name: "qatar", code: "QR", context: true }, { name: "saudia", code: "SV" },
  { name: "saudi arabian airlines", code: "SV" }, { name: "saudi", code: "SV", context: true }, { name: "riyadh air", code: "RX" },
  { name: "flynas", code: "XY" }, { name: "flyadeal", code: "F3" }, { name: "air arabia", code: "G9" }, { name: "gulf air", code: "GF" },
  { name: "oman air", code: "WY" }, { name: "salamair", code: "OV" }, { name: "kuwait airways", code: "KU" },
  { name: "jazeera airways", code: "J9" }, { name: "royal jordanian", code: "RJ" }, { name: "middle east airlines", code: "ME" },
  { name: "iraqi airways", code: "IA" }, { name: "iran air", code: "IR" }, { name: "mahan air", code: "W5" },
  { name: "el al", code: "LY" }, { name: "egyptair", code: "MS" }, { name: "air cairo", code: "SM" }, { name: "nile air", code: "NP" },
  { name: "turkish airlines", code: "TK" }, { name: "turkish", code: "TK", context: true }, { name: "pegasus", code: "PC" },
  { name: "sunexpress", code: "XQ" }, { name: "ajet", code: "VF" }, { name: "anadolujet", code: "VF" },
  // Europe
  { name: "lufthansa", code: "LH" }, { name: "eurowings", code: "EW" }, { name: "condor", code: "DE" },
  { name: "discover airlines", code: "4Y" }, { name: "british airways", code: "BA" }, { name: "virgin atlantic", code: "VS" },
  { name: "aer lingus", code: "EI" }, { name: "loganair", code: "LM" }, { name: "jet2", code: "LS" }, { name: "easyjet", code: "U2" },
  { name: "ryanair", code: "FR" }, { name: "wizz air", code: "W6" }, { name: "wizz", code: "W6" }, { name: "air france", code: "AF" },
  { name: "transavia", code: "HV" }, { name: "corsair", code: "SS" }, { name: "french bee", code: "BF" }, { name: "klm", code: "KL" },
  { name: "brussels airlines", code: "SN" }, { name: "luxair", code: "LG" }, { name: "swiss", code: "LX", context: true },
  { name: "swiss international", code: "LX" }, { name: "edelweiss", code: "WK" }, { name: "austrian airlines", code: "OS" },
  { name: "austrian", code: "OS", context: true }, { name: "iberia express", code: "I2" }, { name: "iberia", code: "IB" },
  { name: "vueling", code: "VY" }, { name: "air europa", code: "UX" }, { name: "volotea", code: "V7" }, { name: "binter", code: "NT" },
  { name: "tap air portugal", code: "TP" }, { name: "tap portugal", code: "TP" }, { name: "ita airways", code: "AZ" },
  { name: "alitalia", code: "AZ" }, { name: "neos", code: "NO" }, { name: "aegean", code: "A3" }, { name: "olympic air", code: "OA" },
  { name: "sky express", code: "GQ" }, { name: "cyprus airways", code: "CY" }, { name: "sas", code: "SK", context: true },
  { name: "scandinavian airlines", code: "SK" }, { name: "norwegian air", code: "DY" }, { name: "finnair", code: "AY" },
  { name: "icelandair", code: "FI" }, { name: "norse atlantic", code: "N0" }, { name: "lot polish", code: "LO" },
  { name: "air baltic", code: "BT" }, { name: "airbaltic", code: "BT" }, { name: "smartwings", code: "QS" },
  { name: "croatia airlines", code: "OU" }, { name: "air serbia", code: "JU" }, { name: "tarom", code: "RO" },
  { name: "bulgaria air", code: "FB" }, { name: "aeroflot", code: "SU" }, { name: "s7 airlines", code: "S7" },
  { name: "belavia", code: "B2" }, { name: "georgian airways", code: "A9" }, { name: "azerbaijan airlines", code: "J2" },
  { name: "uzbekistan airways", code: "HY" }, { name: "air astana", code: "KC" }, { name: "scat", code: "DV" },
  { name: "somon air", code: "SZ" }, { name: "ariana afghan", code: "FG" }, { name: "kam air", code: "RQ" },
  // South Asia
  { name: "air india express", code: "IX" }, { name: "air india", code: "AI" }, { name: "indigo", code: "6E" },
  { name: "spicejet", code: "SG" }, { name: "akasa", code: "QP" }, { name: "alliance air", code: "9I" },
  { name: "pakistan international", code: "PK" }, { name: "pia", code: "PK" }, { name: "airblue", code: "PA" },
  { name: "airsial", code: "PF" }, { name: "air sial", code: "PF" }, { name: "serene air", code: "ER" }, { name: "fly jinnah", code: "9P" },
  { name: "srilankan", code: "UL" }, { name: "sri lankan airlines", code: "UL" }, { name: "biman", code: "BG" },
  { name: "us-bangla", code: "BS" }, { name: "us bangla", code: "BS" }, { name: "novoair", code: "VQ" },
  { name: "nepal airlines", code: "RA" }, { name: "buddha air", code: "U4" }, { name: "himalaya airlines", code: "H9" },
  { name: "druk air", code: "KB" }, { name: "drukair", code: "KB" },
  // East and South-East Asia
  { name: "singapore airlines", code: "SQ" }, { name: "scoot", code: "TR" }, { name: "cathay pacific", code: "CX" },
  { name: "cathay", code: "CX" }, { name: "hong kong airlines", code: "HX" }, { name: "malaysia airlines", code: "MH" },
  { name: "airasia x", code: "D7" }, { name: "thai airasia", code: "FD" }, { name: "airasia", code: "AK" },
  { name: "thai airways", code: "TG" }, { name: "bangkok airways", code: "PG" }, { name: "thai lion", code: "SL" },
  { name: "nok air", code: "DD" }, { name: "garuda", code: "GA" }, { name: "lion air", code: "JT" }, { name: "citilink", code: "QG" },
  { name: "philippine airlines", code: "PR" }, { name: "cebu pacific", code: "5J" }, { name: "vietnam airlines", code: "VN" },
  { name: "vietjet", code: "VJ" }, { name: "bamboo airways", code: "QH" }, { name: "royal brunei", code: "BI" },
  { name: "korean air", code: "KE" }, { name: "asiana", code: "OZ" }, { name: "jeju air", code: "7C" }, { name: "jin air", code: "LJ" },
  { name: "t'way", code: "TW" }, { name: "air busan", code: "BX" }, { name: "japan airlines", code: "JL" },
  { name: "all nippon", code: "NH" }, { name: "zipair", code: "ZG" }, { name: "peach aviation", code: "MM" },
  { name: "air china", code: "CA" }, { name: "china southern", code: "CZ" }, { name: "china eastern", code: "MU" },
  { name: "hainan airlines", code: "HU" }, { name: "xiamen airlines", code: "MF" }, { name: "sichuan airlines", code: "3U" },
  { name: "shenzhen airlines", code: "ZH" }, { name: "eva air", code: "BR" }, { name: "china airlines", code: "CI" },
  { name: "starlux", code: "JX" }, { name: "air macau", code: "NX" }, { name: "miat", code: "OM" },
  { name: "jetstar asia", code: "3K" }, { name: "jetstar", code: "JQ" },
  // Oceania
  { name: "qantas", code: "QF" }, { name: "virgin australia", code: "VA" }, { name: "rex airlines", code: "ZL" },
  { name: "air new zealand", code: "NZ" }, { name: "fiji airways", code: "FJ" }, { name: "air niugini", code: "PX" },
  { name: "air tahiti nui", code: "TN" }, { name: "aircalin", code: "SB" }, { name: "air vanuatu", code: "NF" },
  // Americas
  { name: "american airlines", code: "AA" }, { name: "delta", code: "DL" }, { name: "united airlines", code: "UA" },
  { name: "jetblue", code: "B6" }, { name: "southwest airlines", code: "WN" }, { name: "alaska airlines", code: "AS" },
  { name: "hawaiian airlines", code: "HA" }, { name: "frontier airlines", code: "F9" }, { name: "spirit airlines", code: "NK" },
  { name: "allegiant", code: "G4" }, { name: "sun country", code: "SY" }, { name: "air canada", code: "AC" },
  { name: "westjet", code: "WS" }, { name: "porter airlines", code: "PD" }, { name: "flair airlines", code: "F8" },
  { name: "sunwing", code: "WG" }, { name: "aeromexico", code: "AM" }, { name: "volaris", code: "Y4" },
  { name: "viva aerobus", code: "VB" }, { name: "copa airlines", code: "CM" }, { name: "avianca", code: "AV" },
  { name: "latam", code: "LA" }, { name: "gol", code: "G3" }, { name: "azul", code: "AD" },
  { name: "aerolineas argentinas", code: "AR" }, { name: "sky airline", code: "H2" }, { name: "jetsmart", code: "JA" },
  { name: "boliviana", code: "OB" }, { name: "caribbean airlines", code: "BW" }, { name: "bahamasair", code: "UP" },
  { name: "cayman airways", code: "KX" },
  // Africa
  { name: "ethiopian", code: "ET" }, { name: "kenya airways", code: "KQ" }, { name: "rwandair", code: "WB" },
  { name: "uganda airlines", code: "UR" }, { name: "air tanzania", code: "TC" }, { name: "precision air", code: "PW" },
  { name: "south african airways", code: "SA" }, { name: "airlink", code: "4Z" }, { name: "flysafair", code: "FA" },
  { name: "air botswana", code: "BP" }, { name: "air zimbabwe", code: "UM" }, { name: "royal air maroc", code: "AT" },
  { name: "tunisair", code: "TU" }, { name: "nouvelair", code: "BJ" }, { name: "air algerie", code: "AH" },
  { name: "air senegal", code: "HC" }, { name: "asky", code: "KP" }, { name: "air cote d'ivoire", code: "HF" },
  { name: "air peace", code: "P4" }, { name: "arik air", code: "W3" }, { name: "air mauritius", code: "MK" },
  { name: "air seychelles", code: "HM" }, { name: "air austral", code: "UU" }, { name: "madagascar airlines", code: "MD" },
];

/** 2-character codes that are also common words or abbreviations: only read after "prefer", "airline" etc. */
export const AMBIGUOUS_AIRLINE_CODES = new Set([
  "AM", "AS", "AT", "CA", "LA", "ME", "SA", "AI", "FI", "MS", "NZ", "UK", "US", "PM", "OK", "TR", "SN", "PK", "PR", "AA", "NO",
  "UP", "HA", "FA", "AD", "SM", "PS", "MM", "DE", "LO", "UR", "HM", "OR", "IN", "IT", "GO", "SO", "BE", "MY", "TO", "UM", "AR",
  "IR", "IA", "OS", "SS", "TU", "AH", "BI", "CI", "MD", "RO", "VA", "OA", "OM", "BR", "SK", "LS", "OB", "SY", "PD", "PA", "KQ",
]);

export const AIRLINE_CODES = new Set(AIRLINES.map((a) => a.code));

/** Every airport / city code the reader knows (others are accepted only in capitals, with a question). */
export const AIRPORT_CODES = new Set([
  ...Object.values(PLACES),
  ...Object.values(REGIONS).flat(),
  "LHR", "LGW", "STN", "LTN", "LCY", "SEN", "JFK", "LGA", "EWR", "ORD", "MDW", "IAD", "DCA", "BWI", "DWC", "CDG", "ORY", "FCO",
  "CIA", "MXP", "LIN", "BGY", "NRT", "HND", "KIX", "ITM", "ICN", "GMP", "PEK", "PKX", "PVG", "DMK", "CGK", "HLP", "SAW", "YYZ",
  "YUL", "YTZ", "GRU", "CGH", "VCP", "GIG", "SDU", "EZE", "AEP", "SVO", "DME", "VKO", "ARN", "BMA", "NYO", "OTP", "KBP", "IST",
  "BHX", "BHM", "PDX", "PWM", "HYD", "HDD", "SJC", "SJO", "KIN", "YGK", "CMH", "CSG", "GOI", "GOX", "MJI", "COR", "ODB", "YYJ",
  "NCE", "SPU", "IAH", "HOU", "MCO", "DFW", "DAL", "CTS", "TFS", "TFN", "BFS", "BHD", "CMN", "VRA", "ATL", "LIR", "SAI",
]);

export const CURRENCY_CODES = [
  "USD", "AED", "EUR", "GBP", "INR", "PKR", "SAR", "QAR", "OMR", "KWD", "BHD", "JOD", "EGP", "TRY", "CAD", "AUD", "NZD", "SGD",
  "MYR", "THB", "PHP", "LKR", "BDT", "NPR", "CHF", "JPY", "CNY", "HKD", "ZAR", "KES", "NGN", "IDR", "VND", "KRW",
];
