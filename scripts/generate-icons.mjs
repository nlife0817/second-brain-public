import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const dir = 'public/icons';
const main = fs.readFileSync(path.join(dir, 'icon.svg'));
const maskable = fs.readFileSync(path.join(dir, 'icon-maskable.svg'));

await sharp(main, { density: 600 }).resize(192, 192).png().toFile(path.join(dir, 'icon-192.png'));
await sharp(main, { density: 600 }).resize(512, 512).png().toFile(path.join(dir, 'icon-512.png'));
await sharp(maskable, { density: 600 }).resize(512, 512).png().toFile(path.join(dir, 'icon-maskable-512.png'));

console.log('icons generated');
