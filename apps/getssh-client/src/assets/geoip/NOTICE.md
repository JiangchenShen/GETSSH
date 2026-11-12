# IP country data

IP location data by [DB-IP](https://db-ip.com/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

`dbip-country-lite-2026-11.bin.gz` is derived from the [November 2026 IP to Country Lite CSV](https://download.db-ip.com/free/dbip-country-lite-2026-11.csv.gz). The derivative replaces CSV address ranges with consecutive country-code transitions, uses code zero for missing ranges, and compresses the transition table with gzip. `src/utils/ipCountry.ts` reads the resulting `GIP1` format.
