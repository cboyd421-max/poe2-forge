"""Run one calculation with the user's installed Windows PoB2 LuaJIT runtime.

No Python packages are required. One fresh Lua state/process per build prevents
cross-build cache contamination. This does not drive or change the desktop UI.
"""
import ctypes
import json
import os
from pathlib import Path
import sys
import tempfile
import xml.etree.ElementTree as ET


def run():
    if sys.platform != 'win32' or ctypes.sizeof(ctypes.c_void_p) != 8:
        raise RuntimeError('Automatic calculation needs 64-bit Windows Python and PoB2.')
    pob = Path(sys.argv[1]).resolve(strict=True)
    if (pob / 'first.run').exists():
        raise RuntimeError('Finish installing PoB2 before connecting its calculator.')
    request = json.loads(sys.stdin.buffer.read(17000000))
    xml = request['xml']
    if not isinstance(xml, str) or '<!DOCTYPE' in xml.upper() or '<!ENTITY' in xml.upper():
        raise ValueError('Unsupported build XML.')
    root = ET.fromstring(xml)
    if root.tag != 'PathOfBuilding2' or root.find('Build') is None:
        raise ValueError('A complete PoB2 build is required.')
    skill = request.get('skillGroup')
    if skill is not None and (type(skill) is not int or not 1 <= skill <= 200):
        raise ValueError('Invalid skill group.')
    dll_directory = os.add_dll_directory(str(pob))
    lua = ctypes.CDLL(str(pob / 'lua51.dll'))
    signatures = {
        'luaL_newstate': ([], ctypes.c_void_p),
        'luaL_openlibs': ([ctypes.c_void_p], None),
        'luaL_loadbuffer': ([ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t, ctypes.c_char_p], ctypes.c_int),
        'lua_pcall': ([ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int], ctypes.c_int),
        'lua_pushlstring': ([ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t], None),
        'lua_setfield': ([ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p], None),
        'lua_tolstring': ([ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_size_t)], ctypes.c_void_p),
        'lua_close': ([ctypes.c_void_p], None),
    }
    for name, (arguments, result) in signatures.items():
        fn = getattr(lua, name)
        fn.argtypes, fn.restype = arguments, result
    state = lua.luaL_newstate()
    if not state:
        raise RuntimeError('PoB2 runtime could not allocate a calculation state.')

    def global_string(name, value):
        encoded = value.encode('utf-8')
        lua.lua_pushlstring(state, encoded, len(encoded))
        lua.lua_setfield(state, -10002, name.encode('ascii'))

    try:
        lua.luaL_openlibs(state)
        with tempfile.TemporaryDirectory(prefix='forge-pob2-') as scratch:
            os.chdir(pob)
            global_string('_FORGE_POB', pob.as_posix())
            global_string('_FORGE_SCRATCH', Path(scratch).as_posix())
            global_string('_FORGE_HELPERS', Path(__file__).resolve().parent.as_posix())
            global_string('_FORGE_XML', xml)
            global_string('_FORGE_CLASS', root.find('Build').get('className', ''))
            global_string('_FORGE_ASCENDANCY', root.find('Build').get('ascendClassName', 'None'))
            global_string('_FORGE_SKILL', str(skill or ''))
            script = Path(__file__).with_name('calculate.lua').read_bytes()
            status = lua.luaL_loadbuffer(state, script, len(script), b'ForgeCalculator')
            if not status:
                status = lua.lua_pcall(state, 0, 1, 0)
            size = ctypes.c_size_t()
            pointer = lua.lua_tolstring(state, -1, ctypes.byref(size))
            result = ctypes.string_at(pointer, size.value).decode('utf-8', 'replace') if pointer else ''
            if status:
                raise RuntimeError(result[:1800] or 'PoB2 could not calculate this build.')
            output = json.loads(result)
            print(json.dumps(output, ensure_ascii=True, allow_nan=False))
    finally:
        lua.lua_close(state)
        dll_directory.close()


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        print(json.dumps({'error': str(error)[:1800]}, ensure_ascii=True))
        sys.exit(1)
