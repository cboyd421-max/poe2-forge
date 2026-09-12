-- Bounded same-base rare-crossbow search using the installed PoB2 affix pool.
-- No market lookup and no claim of a global optimum. All outputs are hypothetical.
return function(build, options, statKeys)
    local set = build.itemsTab.activeItemSet
    if set.useSecondWeaponSet then error('Switch to the primary weapon set in PoB2 before optimizing this crossbow') end
    local id = set['Weapon 1'] and set['Weapon 1'].selItemId
    local original = id and build.itemsTab.items[id]
    if not original or original.base.type ~= 'Crossbow' or original.rarity ~= 'RARE' then error('This first optimization pass supports an equipped rare crossbow') end
    if original.corrupted or original.mirrored or original.sanctified then error('Use an uncorrupted, unmirrored rare crossbow for a same-base crafting target') end
    local level, itemLevel = options.level, tonumber(original.itemLevel)
    if not itemLevel or itemLevel < 1 then error('The crossbow needs an explicit item level') end
    if (original.base.req.level or 0) > level then error('The current crossbow base requires a higher character level') end
    local calc, baseline = build.calcsTab.calcs.getMiscCalculator(build)
    if not baseline.CombinedDPS or baseline.CombinedDPS <= 0 then error('Select a damaging skill before optimizing DPS') end
    local function stats(output)
        local result = {}
        for _, key in ipairs(statKeys) do
            local n = output[key]
            if type(n) == 'number' and n == n and math.abs(n) < math.huge then result[key] = n end
        end
        return result
    end
    local function allowed(output, item)
        if (item.requirements.level or 0) > level then return false end
        for _, attr in ipairs({'Str','Dex','Int'}) do
            local required = output[attr .. 'RequirementsOnWeapon 1']
            if required and required > (output[attr] or 0) then return false end
            -- Do not worsen any pre-existing unmet attribute requirement elsewhere.
            local oldShortfall = math.max(0, (baseline['Req'..attr] or 0) - (baseline[attr] or 0))
            if math.max(0, (output['Req'..attr] or 0) - (output[attr] or 0)) > oldShortfall + 0.01 then return false end
        end
        if options.keepDefences then
            for _, key in ipairs({'Life','EnergyShield','TotalEHP','FireResist','ColdResist','LightningResist','ChaosResist'}) do
                if baseline[key] and (not output[key] or output[key] + 0.001 < baseline[key]) then return false end
            end
        end
        return true
    end
    local topByGroup = {}
    for modId, mod in pairs(original.affixes or {}) do
        if (mod.type == 'Prefix' or mod.type == 'Suffix') and type(mod.group) == 'string' and mod.level <= itemLevel and math.floor(mod.level * 0.8) <= level and original:GetModSpawnWeight(mod) > 0 and not mod.isEssenceOnly then
            local key = mod.type .. ':' .. mod.group
            local prev = topByGroup[key]
            if not prev or mod.level > prev.mod.level or (mod.level == prev.mod.level and modId < prev.id) then topByGroup[key] = {id=modId,mod=mod} end
        end
    end
    local pool = {Prefix={},Suffix={}}
    for _, entry in pairs(topByGroup) do table.insert(pool[entry.mod.type], entry) end
    for _, entries in pairs(pool) do table.sort(entries, function(a,b) return a.id < b.id end) end
    if #pool.Prefix == 0 or #pool.Suffix == 0 or #pool.Prefix + #pool.Suffix > 120 then error('The installed crossbow affix pool is unsupported') end
    local raw = original:BuildRaw()
    local evaluated, cache, candidates = 0, {}, {}
    local maxEvaluations = 260
    local function makeItem(selection)
        local item = new('Item', raw)
        item.id = id
        item.crafted = true
        item.title = 'Forge DPS target'
        item.uniqueID = nil
        item.prefixes, item.suffixes, item.affixLimit = {}, {}, 6
        item.explicitModLines = {}
        for _, entry in ipairs(selection) do
            local list = entry.mod.type == 'Prefix' and item.prefixes or item.suffixes
            table.insert(list, {modId=entry.id,range=1})
        end
        for _, list in ipairs({item.prefixes,item.suffixes}) do for i=#list+1,3 do list[i]={modId='None'} end end
        item:Craft()
        return item
    end
    local function evaluate(selection)
        local ids = {};for _, entry in ipairs(selection) do table.insert(ids,entry.id) end;table.sort(ids)
        local key = table.concat(ids,'|')
        if cache[key] then return cache[key] end
        if evaluated >= maxEvaluations then return nil end
        evaluated = evaluated + 1
        local item = makeItem(selection)
        local output = calc({repSlotName='Weapon 1',repItem=item},false)
        local score = output.CombinedDPS
        if type(score) ~= 'number' or score ~= score or math.abs(score) == math.huge then error('PoB2 returned an invalid DPS score') end
        local value = {score=score,stats=stats(output),item=item,eligible=allowed(output,item),key=key,selection=selection}
        cache[key] = value
        if value.eligible and score > baseline.CombinedDPS + 0.01 then candidates[key] = value end
        return value
    end
    -- Two deterministic greedy passes explore different interaction orders.
    -- Evaluate all eligible affix groups at each step, not fixed guessed weights.
    for _, order in ipairs({{'Prefix','Prefix','Prefix','Suffix','Suffix','Suffix'},{'Suffix','Suffix','Suffix','Prefix','Prefix','Prefix'}}) do
        local selection, used = {}, {}
        for _, kind in ipairs(order) do
            local best, bestEntry
            for _, entry in ipairs(pool[kind]) do
                if not used[entry.mod.group] then
                    local trial = {};for _, selected in ipairs(selection) do table.insert(trial,selected) end;table.insert(trial,entry)
                    local result = evaluate(trial)
                    if result and (not best or result.score > best.score) then best,bestEntry=result,entry end
                end
            end
            if not best then break end
            table.insert(selection,bestEntry);used[bestEntry.mod.group]=true
        end
    end
    local ranked = {};for _, candidate in pairs(candidates) do table.insert(ranked,candidate) end
    table.sort(ranked,function(a,b) return a.score==b.score and a.key<b.key or a.score>b.score end)
    local results = {}
    for i=1,math.min(3,#ranked) do
        local entry=ranked[i]
        -- Flatten crafting metadata so subsequent explicit Forge edits remain authoritative.
        local item=entry.item;item.crafted=false
        local affixes={};for _, selected in ipairs(entry.selection) do table.insert(affixes,{id=selected.id,type=selected.mod.type,group=selected.mod.group,level=selected.mod.level}) end
        table.insert(results,{itemText=item:BuildRaw(),stats=entry.stats,requiredLevel=item.requirements.level,affixes=affixes})
    end
    return {candidates=results,evaluated=evaluated,limitReached=evaluated>=maxEvaluations,baseName=original.baseName,itemLevel=itemLevel,level=level,keepDefences=options.keepDefences,affixGroups=#pool.Prefix+#pool.Suffix,method='Two greedy passes; highest eligible tier per affix group; maximum rolls; same base and item level'}
end
