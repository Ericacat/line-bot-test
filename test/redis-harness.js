// Execute the actual production Lua scripts with a Redis command test double.
// No external database is created or contacted by tests.
import fengari from 'fengari';
const { lua, lauxlib, lualib, to_luastring } = fengari;

function push(L, value) {
    if (Array.isArray(value)) {
        lua.lua_createtable(L, value.length, 0);
        value.forEach((item, index) => { push(L, item); lua.lua_rawseti(L, -2, index + 1); });
    } else if (value === null || value === undefined || value === false) lua.lua_pushboolean(L, false);
    else if (typeof value === 'number') lua.lua_pushnumber(L, value);
    else lua.lua_pushstring(L, to_luastring(String(value)));
}
function read(L, index) {
    if (lua.lua_istable(L, index)) {
        const output = [];
        const absolute = lua.lua_absindex(L, index);
        for (let i = 1; i <= lua.lua_rawlen(L, absolute); i++) {
            lua.lua_rawgeti(L, absolute, i); output.push(read(L, -1)); lua.lua_pop(L, 1);
        }
        return output;
    }
    if (lua.lua_isnumber(L, index)) return lua.lua_tonumber(L, index);
    if (lua.lua_isboolean(L, index)) return lua.lua_toboolean(L, index);
    return lua.lua_tojsstring(L, index);
}
export class RedisHarness {
    constructor({ data = new Map(), now = Date.now() } = {}) {
        this.data = data; this.now = now; this.calls = []; this.fail = false;
        this.fetch = async (_url, request) => {
            if (this.fail) throw new Error('Storage unavailable');
            const args = JSON.parse(request.body);
            this.calls.push(args);
            try { return Response.json({ result: this.command(args) }); }
            catch (error) { return Response.json({ error: error.message }); }
        };
    }
    get(key) {
        const entry = this.data.get(key);
        if (entry?.expiresAt <= this.now) { this.data.delete(key); return undefined; }
        return entry;
    }
    command([command, ...args]) {
        switch (command.toUpperCase()) {
            case 'TIME': return [String(Math.floor(this.now / 1000)), '0'];
            case 'EXISTS': return this.get(args[0]) ? 1 : 0;
            case 'GET': {
                const entry = this.get(args[0]);
                if (entry && entry.type !== 'string') throw new Error('WRONGTYPE');
                return entry?.value ?? null;
            }
            case 'SET': {
                const [key, value, ...flags] = args;
                if (flags.includes('NX') && this.get(key)) return null;
                const ttlIndex = flags.indexOf('EX');
                this.data.set(key, { type: 'string', value: String(value), expiresAt: ttlIndex === -1 ? Infinity : this.now + Number(flags[ttlIndex + 1]) * 1000 });
                return 'OK';
            }
            case 'HMGET': {
                const entry = this.get(args[0]);
                if (entry && entry.type !== 'hash') throw new Error('WRONGTYPE');
                return args.slice(1).map((field) => entry?.value[field] ?? false);
            }
            case 'HSET': {
                const [key, ...fields] = args;
                const entry = this.get(key) || { type: 'hash', value: {}, expiresAt: Infinity };
                if (entry.type !== 'hash') throw new Error('WRONGTYPE');
                for (let i = 0; i < fields.length; i += 2) entry.value[fields[i]] = String(fields[i + 1]);
                this.data.set(key, entry); return fields.length / 2;
            }
            case 'HINCRBY': {
                const [key, field, increment] = args;
                const entry = this.get(key);
                if (!entry || entry.type !== 'hash' || !/^-?\d+$/.test(entry.value[field])) throw new Error('Invalid counter');
                entry.value[field] = String(Number(entry.value[field]) + Number(increment));
                return Number(entry.value[field]);
            }
            case 'EVAL': {
                const [script, keyCount, ...parameters] = args;
                const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
                push(L, parameters.slice(0, Number(keyCount))); lua.lua_setglobal(L, to_luastring('KEYS'));
                push(L, parameters.slice(Number(keyCount))); lua.lua_setglobal(L, to_luastring('ARGV'));
                lua.lua_newtable(L);
                lua.lua_pushjsfunction(L, (state) => {
                    const operation = [];
                    for (let i = 1; i <= lua.lua_gettop(state); i++) operation.push(lua.lua_tojsstring(state, i));
                    try { push(state, this.command(operation)); return 1; }
                    catch (error) { return lauxlib.luaL_error(state, to_luastring(error.message)); }
                });
                lua.lua_setfield(L, -2, to_luastring('call')); lua.lua_setglobal(L, to_luastring('redis'));
                const status = lauxlib.luaL_dostring(L, to_luastring(script));
                if (status !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1));
                return read(L, -1);
            }
            default: throw new Error(`Unsupported command ${command}`);
        }
    }
}
