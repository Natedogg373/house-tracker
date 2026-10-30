# School assignment notes (researched 2026-10-30)

## Sources
- **Geocode:** US Census batch geocoder. All 15 matched exactly.
- **A. Attendance-zone polygons (point-in-polygon):** zipdatamaps.com per-campus GeoJSON (keyed by TEA campus ID). For Galway I also checked the Dallas ISD elementary, middle, and high boundary layers on ArcGIS (an SMU-hosted copy of the DISD zones). The vintage of both datasets is unknown.
- **B. Listing and MLS school fields:** Coldwell Banker, Compass (GreatSchools "Serves this home"), Knox, Ebby, ezHomeSearch, and DFW Urban Realty, found via web search.
- **District official tools:**
  - RISD School Finder (schoolfinder.risd.org) returned HTTP 500 for every request today, so it is **not verified**.
  - DISD's SchoolMint finder is JavaScript-only and wasn't queried directly. Its boundary data was used through the ArcGIS layer above.
- **Zillow:** curl and fetch got the page, but there was no school section (the page loads it client-side). Not a hard block. Galway's listing text says "designated school is ... Hexter Elementary".
- **Ratings:** GreatSchools search data (gon.search) on 2026-10-30. Compass's GS ratings for Woodbridge (2, 2, 4) match.
- **School lat/lng and address:** NCES EDGE 2024-25 public school locations.

## Per house
| House | District | Elem / Middle / High | Agreement |
|---|---|---|---|
| 9902 Galway Dr 75218 | Dallas ISD | Hexter / Robert T. Hill / Bryan Adams | A (zipdatamaps) + DISD ArcGIS layer + listing text (Hexter) agree. MS and HS come from boundary data only. |
| 8721 Flint Falls Dr 75243 | Richardson ISD | Skyview / Forest Meadow / Lake Highlands HS | A + listing (Skyview) agree. |
| 8026 Westover Dr 75231 | RISD | Moss Haven / Forest Meadow / LHHS | A only. Same block group and polygon as Moss Meadows and Seagrove. |
| 9006 Church Rd 75231 | RISD | Merriman Park / Forest Meadow / LHHS | A only. |
| 9517 Fallbrook Dr 75243 | RISD | Skyview / Forest Meadow / LHHS | A only. |
| 9028 Clearhurst Dr 75238 | RISD | White Rock / Lake Highlands Middle / LHHS | A + listings agree. Listings call LH a "Junior High (7-8)" and White Rock PK-6. |
| 8915 White Pine Ln 75238 | RISD | White Rock / Lake Highlands Middle / LHHS | A only. It's next door to Clearhurst in the same subdivision. |
| 9205 Moss Farm Ln 75243 | RISD | Moss Haven / Forest Meadow / LHHS | A only. It's across the street from Moss Haven. |
| 8031 Moss Meadows Dr 75231 | RISD | Moss Haven / Forest Meadow / LHHS | A only. |
| 9918 Chimney Hill Ln 75243 | RISD | Aikin / Forest Meadow / LHHS | A + listing (Aikin) agree. |
| 11901 Woodbridge Dr 75243 | RISD (Berkner feeder) | Audelia Creek (PK-6) / Liberty JH (7-8) / Berkner HS | A + Coldwell Banker, Compass, and Knox (MLS) all agree. |
| 7221 Pleasant View Dr 75231 | RISD | Merriman Park / Forest Meadow / LHHS | A only. |
| 9178 Glen Springs Dr 75243 | RISD | Skyview / Forest Meadow / LHHS | A only. |
| 9223 Seagrove Dr 75243 | RISD | Moss Haven / Forest Meadow / LHHS | A + listing agree. |
| 7130 Abrams Rd 75231 | RISD | Merriman Park / Forest Meadow / LHHS | A + listings agree. |

## Uncertainties
- No disagreements were found anywhere two sources were available.
- "A only" rows have just one boundary source. They are consistent with neighboring verified houses, but none were checked against RISD's own finder (it was down). Re-check when schoolfinder.risd.org is back.
- A second RISD high-school polygon (TEA id ...052, unknown campus) also covers Clearhurst and White Pine. It overlaps the LHHS zone, so it's ignored.
- Grade spans differ by source (PK-5 vs PK-6, Middle vs Junior High). The names used here follow RISD's own school list.
- No ratings are null.
- Side finding: a search result (RealtyHop) says 9028 Clearhurst sold 2026-10-15 for $605,000. Unverified, but it may fill the Graveyard sale price.
