# PoB2 headless definitions

`SimpleGraphic.lua` is an unmodified copy of `_SimpleGraphic.def.lua` from Path of Building Community (PoE2), commit `ce566eac45ea8a86477f513c7ee65a1ebe60014e`:

https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/ce566eac45ea8a86477f513c7ee65a1ebe60014e/src/_SimpleGraphic.def.lua

The bootstrap follows that revision's official `HeadlessWrapper.lua`. Forge supplies a private temporary user path, disables updates/network/process hooks and file writes, and uses a fresh process for each calculation. The installed PoB2 engine and game data are used without modification or redistribution.

`optimize.lua` is Forge's bounded search implementation. It reads the installed normal affix pool and uses PoB2's `Item:Craft()` and `calcs.getMiscCalculator()` interfaces for item construction, requirement data and actual build calculations. The installed game data remains attributed to Grinding Gear Games; the search does not redistribute that catalog or fetch trade listings.

`poe2forge-trade.js` contains a small mapping of 17 crossbow modifier labels and official trade stat identifiers, checked against the installed PoB2 0.23.1 `Data/TradeSiteStats.lua`. This trade stat data is copyright Grinding Gear Games. Forge's matching/query code is original; it opens the official trade interface and makes no direct requests to trade data, search or fetch endpoints. The complete PoB2 trade catalog is not redistributed.

Copyright (c) 2016 David Gowor

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
