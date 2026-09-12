-- Uses the official headless rendering definitions with the installed engine.
-- Only rendering/input hooks are stubbed; all build calculations are PoB2's.
package.path = './?.lua;./lua/?.lua;./lua/?/init.lua'
package.cpath = './?.dll'
arg = {}
dofile(_FORGE_HELPERS .. '/SimpleGraphic.lua')
__callbackTable__ = {}
function GetVirtualScreenSize() return 1920, 1080 end
function GetScriptPath() return _FORGE_POB end
function GetRuntimePath() return _FORGE_POB end
function GetWorkDir() return _FORGE_POB end
function GetUserPath() return _FORGE_SCRATCH end
function ConPrintf() end
function print() end
function runCallback(name, ...)
    if __callbackTable__[name] then return __callbackTable__[name](...)
    elseif __mainObject__ and __mainObject__[name] then return __mainObject__[name](__mainObject__, ...) end
end
local nativeRequire = require
function require(name)
    if name == 'lcurl.safe' or name == 'socket' or name == 'socket.http' then return nil end
    return nativeRequire(name)
end
-- This worker never writes settings, saved builds, update files, or source data.
local nativeOpen = io.open
function io.open(file, mode)
    mode = mode or 'r'
    if mode:find('[wa+]') then return nil, 'File writes are disabled in the Forge calculator' end
    return nativeOpen(file, mode)
end
function os.remove() return nil, 'File changes disabled' end
function os.rename() return nil, 'File changes disabled' end
function os.execute() return nil, 'Process launching disabled' end
function io.popen() return nil, 'Process launching disabled' end
function io.read() error('Unexpected interactive prompt in calculator') end
dofile('Launch.lua')
function launch:CheckForUpdate() end
runCallback('OnInit')
runCallback('OnFrame')
if launch.promptMsg then error(launch.promptMsg) end
launch.main:SetMode('BUILD', false, 'Forge calculation', _FORGE_XML)
runCallback('OnFrame')
if launch.promptMsg then error(launch.promptMsg) end
local build = launch.main.modes.BUILD
if build.spec.curClassName ~= _FORGE_CLASS or build.spec.curAscendClassName ~= _FORGE_ASCENDANCY then
    error('PoB2 could not load the requested character class and ascendancy')
end
local selected = tonumber(_FORGE_SKILL)
if selected then
    if not build.skillsTab.socketGroupList[selected] then error('Selected skill group does not exist in this build') end
    build.mainSocketGroup = selected
    build.buildFlag = true
    runCallback('OnFrame')
end
if launch.promptMsg then error(launch.promptMsg) end
local stats = {}
local keys = {'CombinedDPS','TotalDPS','FullDPS','Life','EnergyShield','Mana','Spirit','Armour','Evasion','TotalEHP','FireResist','ColdResist','LightningResist','ChaosResist','PhysicalMaximumHitTaken','FireMaximumHitTaken','ColdMaximumHitTaken','LightningMaximumHitTaken','ChaosMaximumHitTaken','BlockChance','EvadeChance','LifeRegen','LifeLeechGainRate'}
for _, key in ipairs(keys) do
    local value = build.calcsTab.mainOutput[key]
    if type(value) == 'number' and value == value and math.abs(value) < math.huge then stats[key] = value end
end
local function skillName(group)
    local display = group.displaySkillList and group.displaySkillList[group.mainActiveSkill or 1]
    local effect = display and display.activeEffect and display.activeEffect.grantedEffect
    local label = effect and effect.name or group.label or group.displayLabel or 'Skill group'
    return StripEscapes(label)
end
local skills = {}
for index, group in ipairs(build.skillsTab.socketGroupList) do
    if group.enabled ~= false and group.displaySkillList and #group.displaySkillList > 0 then
        table.insert(skills, {index=index, name=skillName(group)})
    end
end
local group = build.skillsTab.socketGroupList[build.mainSocketGroup]
if _FORGE_OPTIMIZE and _FORGE_OPTIMIZE ~= '' then
    local optimize = dofile(_FORGE_HELPERS .. '/optimize.lua')
    local result = optimize(build, require('dkjson').decode(_FORGE_OPTIMIZE), keys)
    result.stats = stats
    result.skill = group and skillName(group) or 'Default attack'
    result.skillGroup = build.mainSocketGroup
    result.version = launch.versionNumber
    return require('dkjson').encode(result)
end
return require('dkjson').encode({version=launch.versionNumber,stats=stats,skill=group and skillName(group) or 'Default attack',skillGroup=build.mainSocketGroup,skills=skills,level=build.characterLevel})
