import type { TavoraSDK, JsonValue } from '@tavora/sdk';
import { portable, type Build } from './model';
import { validate } from './validate.js';
interface Header {
    kind: 'poe2-build';
    version: 1;
    chunks: string[];
}
const PREFIX = 'poe2-build-';
// Immutable chunks keep attachments outside the host's 4 MiB document limit.
// The small header is committed last with a revision check; readers see one complete import.
export class BuildRepository {
    constructor(private documents: TavoraSDK['documents']) { }
    async list() { return (await this.documents.list()).filter(d => d.id.startsWith(PREFIX)); }
    async get(id: string, attempt = 0): Promise<Build | null> {
        const header = await this.documents.get<Header>(id);
        if (!header)
            return null;
        if (header.data.kind !== 'poe2-build' || header.data.version !== 1 || !Array.isArray(header.data.chunks) || header.data.chunks.length > 200 || header.data.chunks.some(key => typeof key !== 'string' || !key.startsWith('poe2-data-')))
            throw Error('This saved build has an unsupported record format.');
        try {
            const chunks = await Promise.all(header.data.chunks.map(async (key) => { const doc = await this.documents.get<{
                text: string;
            }>(key); if (!doc || typeof doc.data.text !== 'string')
                throw Error('Part of this build is missing. Load the original build file again.'); return doc.data.text; }));
            return validate(portable(JSON.parse(chunks.join('')) as Build));
        }
        catch (error) {
            const latest = await this.documents.get<Header>(id);
            if (attempt < 2 && latest?.revision !== header.revision)
                return this.get(id, attempt + 1);
            throw error;
        }
    }
    async put(build: Build) {
        const id = PREFIX + build.fileId, prior = await this.documents.get<Header>(id), text = JSON.stringify(build), chunks: string[] = [];
        try {
            for (let offset = 0; offset < text.length; offset += 400000) {
                const key = 'poe2-data-' + crypto.randomUUID();
                await this.documents.put({ id: key, title: 'Build data', data: { text: text.slice(offset, offset + 400000) } });
                chunks.push(key);
            }
            await this.documents.put({ id, title: build.title.slice(0, 200), ifRevision: prior?.revision ?? 0, data: { kind: 'poe2-build', version: 1, chunks } as unknown as JsonValue });
        }
        catch (error) {
            await Promise.allSettled(chunks.map(key => this.documents.delete(key)));
            throw error;
        }
        // Readers holding the previous header retry against the new revision.
        if (prior)
            await Promise.allSettled(prior.data.chunks.map(key => this.documents.delete(key)));
        return id;
    }
}
