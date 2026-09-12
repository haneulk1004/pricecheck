import test from 'node:test';
import assert from 'node:assert/strict';
import fengari from 'fengari';
import { ADMIT_SCRIPT } from '../lib/price-research.js';
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
test('actual Lua: 5/IP, 300 global, cache precedence, KST rollover and 1000 reservations',()=>{
  const L=lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  const program = `
local store, expiries = {}, {}
local now = 2000000000
redis = {call = function(cmd, key, value)
  if cmd == 'TIME' then return {tostring(now), '0'} end
  if expiries[key] and expiries[key] <= now then store[key] = nil end
  if cmd == 'GET' then return store[key] end
  if cmd == 'INCR' then store[key] = tonumber(store[key] or '0') + 1; return store[key] end
  if cmd == 'EXPIREAT' then expiries[key] = value; return 1 end
  error('unexpected command')
end}
local function admit(cache, ip)
  KEYS = {cache, 'ip:' .. ip, 'global'}
  return (function() ${ADMIT_SCRIPT} end)()
end
local reset = (math.floor((now + 32400) / 86400) + 1) * 86400 - 32400
for i=1,5 do local a=admit('miss', 'one'); assert(a[1]=='ALLOW'); assert(a[2]==5-i); assert(a[3]==reset) end
assert(admit('miss','one')[1]=='IP_LIMIT')
for i=1,295 do assert(admit('miss','other' .. i)[1]=='ALLOW') end
assert(admit('miss','new')[1]=='GLOBAL_LIMIT')
assert(admit('miss','one')[1]=='IP_LIMIT')
local day = math.floor((now + 32400) / 86400)
assert(store['global:' .. day] == 300)
assert(store['ip:new:' .. day] == nil)
store['cached'] = 'valid result'
local cache = admit('cached','one'); assert(cache[1]=='CACHE' and cache[2]=='valid result')
now = reset - 1
assert(admit('miss','one')[2] == 1)
now = reset
assert(admit('miss','one')[1]=='ALLOW')
local admitted, denied = 0, 0
for i=1,1000 do
  local a=admit('miss','burst' .. i)
  if a[1]=='ALLOW' then admitted=admitted+1 else assert(a[1]=='GLOBAL_LIMIT'); denied=denied+1 end
end
assert(admitted==299 and denied==701)
`;
  const code=lauxlib.luaL_dostring(L,to_luastring(program));
  assert.equal(code,lua.LUA_OK,code===lua.LUA_OK?'':to_jsstring(lua.lua_tostring(L,-1)));
  lua.lua_close(L);
});
