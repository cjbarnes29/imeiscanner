// Copy exactly the current web build. Keeping old hashed assets bloats APKs and can hide stale builds.
import { access, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source = new URL('../dist/', import.meta.url);
const target = new URL('../android/app/src/main/assets/', import.meta.url);
await access(new URL('index.html', source)); // Never remove assets unless a built page is available.
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
console.log(`Copied the current web build to ${fileURLToPath(target)}`);
