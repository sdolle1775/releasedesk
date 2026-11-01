import { vi } from 'vitest';
vi.stubGlobal('fetch',()=>{throw new Error('Unexpected network call: automated tests must use recorded GitHub responses.');});
