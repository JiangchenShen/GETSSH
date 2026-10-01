#!/usr/bin/env node
// Works around the macOS 27 Command Line Tools linker (ld-27037.1): when a dylib has an odd number
// of indirect symbols, the linker places the LC_SYMTAB string pool only 4-aligned and dyld refuses
// to load it ("mis-aligned LINKEDIT string pool"). CI runners use an older linker and are not
// affected; this only repairs local builds.
//
//   node scripts/macos-realign-linkedit.js <file.node> [...]
//
// For each 64-bit Mach-O file whose string pool is not 8-aligned: remove the code signature,
// insert zero bytes in front of the string pool, move every LINKEDIT offset at or after it, grow
// __LINKEDIT, then sign ad hoc again. Files that are already aligned are left untouched.
'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const MH_MAGIC_64 = 0xfeedfacf;
const LC_SEGMENT_64 = 0x19;
const LC_SYMTAB = 0x2;
const LC_DYSYMTAB = 0xb;
const LC_CODE_SIGNATURE = 0x1d;
// linkedit_data_command: { cmd, cmdsize, dataoff, datasize }
const LINKEDIT_DATA = new Set([0x1d, 0x1e, 0x26, 0x29, 0x2b, 0x2e, 0x80000033, 0x80000034]);
const LC_DYLD_INFO = 0x22;
const LC_DYLD_INFO_ONLY = 0x80000022;
const PAGE = 0x4000;

function commands(buf) {
  if (buf.readUInt32LE(0) !== MH_MAGIC_64) throw new Error('not a 64-bit little-endian Mach-O file');
  const ncmds = buf.readUInt32LE(16);
  const list = [];
  let offset = 32;
  for (let i = 0; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(offset);
    const size = buf.readUInt32LE(offset + 4);
    list.push({ cmd, offset, size });
    offset += size;
  }
  return list;
}

function find(buf, cmd) {
  return commands(buf).find(c => c.cmd === cmd);
}

function realign(file) {
  let buf = fs.readFileSync(file);
  const symtab = find(buf, LC_SYMTAB);
  if (!symtab) return `${file}: no LC_SYMTAB, skipped`;
  if (buf.readUInt32LE(symtab.offset + 16) % 8 === 0) return `${file}: aligned`;

  if (find(buf, LC_CODE_SIGNATURE)) {
    execFileSync('codesign', ['--remove-signature', file]);
    buf = fs.readFileSync(file);
  }
  const stroff = buf.readUInt32LE(symtab.offset + 16);
  const pad = (8 - (stroff % 8)) % 8;
  const bump = (at) => {
    const value = buf.readUInt32LE(at);
    if (value >= stroff && value !== 0) buf.writeUInt32LE(value + pad, at);
  };
  for (const c of commands(buf)) {
    if (c.cmd === LC_SYMTAB) {
      buf.writeUInt32LE(stroff + pad, c.offset + 16);
    } else if (c.cmd === LC_DYSYMTAB) {
      for (const field of [32, 40, 48, 56, 64, 72]) bump(c.offset + field); // tocoff, modtaboff, extrefsymoff, indirectsymoff, extreloff, locreloff
    } else if (c.cmd === LC_DYLD_INFO || c.cmd === LC_DYLD_INFO_ONLY) {
      for (const field of [8, 16, 24, 32, 40]) bump(c.offset + field);
    } else if (LINKEDIT_DATA.has(c.cmd)) {
      bump(c.offset + 8);
    } else if (c.cmd === LC_SEGMENT_64 && buf.toString('latin1', c.offset + 8, c.offset + 24).replace(/\0+$/, '') === '__LINKEDIT') {
      const filesize = Number(buf.readBigUInt64LE(c.offset + 48)) + pad;
      buf.writeBigUInt64LE(BigInt(filesize), c.offset + 48);
      const vmsize = Number(buf.readBigUInt64LE(c.offset + 32));
      if (filesize > vmsize) buf.writeBigUInt64LE(BigInt(Math.ceil(filesize / PAGE) * PAGE), c.offset + 32);
    }
  }
  buf = Buffer.concat([buf.subarray(0, stroff), Buffer.alloc(pad), buf.subarray(stroff)]);
  fs.writeFileSync(file, buf);
  execFileSync('codesign', ['-s', '-', '-f', file], { stdio: 'ignore' });
  return `${file}: string pool moved from 0x${stroff.toString(16)} by ${pad} bytes, re-signed`;
}

if (require.main === module) {
  if (process.platform !== 'darwin') process.exit(0);
  for (const file of process.argv.slice(2)) console.log(realign(file));
}

module.exports = { realign };
