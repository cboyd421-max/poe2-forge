# Equipment artwork

Ship this directory alongside the HTML and reference JSON files, including on GitHub Pages. The icon paths in `poe2db-base-types.json` and `poe2db-uniques.json` are relative to the page.

Artwork is by Grinding Gear Games. Each JSON entry records its PoE2DB source page and original image URL. These files are the local copies used by the existing scraper and frontend, so the browser does not depend on third-party image hotlinking.

The catalogue is curated, rather than exhaustive. Add newly supported base types or uniques to `scrape-poe2db.js`, include their JSON entries and image files, and run `node tests/item-icons.cjs` before releasing.
