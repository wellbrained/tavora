import type { TavoraSDK, JsonValue } from '@tavora/sdk';
import { portable, type Build } from './model';
import { validate } from './validate.js';
import { t } from './i18n';
interface Header {
    kind: 'poe2-build';
    version: 1;
    chunks: string[];
    character?: Build['character'];
    guideImport?: Build['guideImport'];
}
const PREFIX = 'poe2-build-';
// Immutable chunks keep attachments outside the host's 4 MiB document limit.
// The small header is committed last with a revision check; readers see one complete import.
export class BuildRepository {
    constructor(private documents: TavoraSDK['documents']) { }
    async list() { return Promise.all((await this.documents.list()).filter(d=>d.id.startsWith(PREFIX)).map(async d=>{const h=await this.documents.get<Header>(d.id);return {...d,character:h?.data.character,guideImport:h?.data.guideImport};})); }
    async get(id: string, attempt = 0): Promise<Build | null> {
        const header = await this.documents.get<Header>(id);
        if (!header)
            return null;
        if (header.data.kind !== 'poe2-build' || header.data.version !== 1 || !Array.isArray(header.data.chunks) || header.data.chunks.length > 200 || header.data.chunks.some(key => typeof key !== 'string' || !key.startsWith('poe2-data-')))
            throw Error(t('error.recordFormat'));
        try {
            const chunks = await Promise.all(header.data.chunks.map(async (key) => { const doc = await this.documents.get<{
                text: string;
            }>(key); if (!doc || typeof doc.data.text !== 'string')
                throw Error(t('error.partMissing')); return doc.data.text; }));
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
            await this.documents.put({ id, title: build.title.slice(0, 200), ifRevision: prior?.revision ?? 0, data: { kind: 'poe2-build', version: 1, chunks, ...(build.character?{character:build.character}:{}),...(build.guideImport?{guideImport:build.guideImport}:{}) } as unknown as JsonValue });
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
