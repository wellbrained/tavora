import { esc } from './presentation';
/** Linkify web addresses only; every non-link character remains original text. */
export function guideTextMarkup(text: string): string {
    const pattern=/https?:\/\/[^\s<>"']+/gu;
    let result='',position=0;
    for(const match of text.matchAll(pattern)) {
        let address=match[0];
        address=address.replace(/[.,;:!?]+$/u,'');
        for(const [open,close] of [['(',')'],['[',']'],['{','}']])
            while(address.endsWith(close!) && address.split(close!).length>address.split(open!).length)address=address.slice(0,-1);
        let valid=false;
        try{const url=new URL(address);valid=['http:','https:'].includes(url.protocol)&&!!url.hostname&&!url.username&&!url.password&&address.length<=8192;}catch{/* Remain plain text. */}
        result+=esc(text.slice(position,match.index));
        result+=valid?`<a class="guide-inline-link" href="${esc(address)}" data-reference="${esc(address)}">${esc(address)}</a>`:esc(address);
        position=match.index!+address.length;
    }
    return result+esc(text.slice(position));
}
